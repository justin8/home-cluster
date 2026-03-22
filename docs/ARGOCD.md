# Argo CD & GitOps

This document describes the Argo CD setup and the GitOps workflow for the `home-cluster`.

## Architecture

We use the **App of Apps** pattern to manage our cluster resources. Argo CD is configured to manage itself and other applications through a "root" application.

### Key Components

- **Argo CD**: The GitOps controller that synchronizes Kubernetes resources from this repository to the cluster.
- **Root Application**: Located at `kubernetes/root-app/`, this is the entry point that manages all other applications in the cluster.
- **Application Wrapper Charts**: Located in `kubernetes/charts/`, these are Helm charts that wrap existing upstream charts (as dependencies) to allow for cluster-specific overrides and extensions.

## Initial Bootstrap

The cluster is bootstrapped using the `scripts/install-argocd` script. This script:

1.  Installs the Argo CD Helm chart into the `argocd` namespace.
2.  Configures the SOPS age key as a Kubernetes secret for encrypted secrets.
3.  Applies the initial root application.

## Managing Applications

### Adding a New Application

A "unit of deployment" consists of two parts: the deployment definition in the `root-app` and the application configuration in `kubernetes/charts/`.

#### 1. Application Configuration (`kubernetes/charts/`)

Create a new directory in `kubernetes/charts/` (e.g., `kubernetes/charts/my-app/`). This is where the core logic and configuration for the application resides. Use the **Wrapper Pattern** described below to consume upstream charts and add custom resources.

#### 2. Deployment Definition (`kubernetes/root-app/templates/`)

Add a new manifest to `kubernetes/root-app/templates/` (e.g., `kubernetes/root-app/templates/my-app.yaml`). This file should define the high-level deployment metadata.
**Standards:**

- **Global Values**: Hardcode the `repoURL` and `targetRevision` in the source configuration to ensure Argo CD can always find its source, even during initial bootstrap.
- **Namespaces**: Do **NOT** create separate `Namespace` resources in `root-app/templates`.
- **Managed Metadata**: Use `syncOptions: [CreateNamespace=true]` and `managedNamespaceMetadata` to manage namespace labels.
- **Value Dependency**: Only include `global-values.yaml` in the `valueFiles` list if the application's underlying chart (in `kubernetes/charts/`) references `global` values.

Example of a deployment definition in `root-app`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
  annotations:
    argocd.argoproj.io/sync-wave: "99"
spec:
  project: default
  source:
    repoURL: https://github.com/justin8/home-cluster.git
    path: kubernetes/charts/my-app
    targetRevision: argocd2
    helm:
      # Optional: only if charts/my-app/templates/ references .Values.global
      valueFiles:
        - ../../global-values.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: my-app-ns
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
    managedNamespaceMetadata:
      labels:
        some-namespace-label/my-lable: foo
```

### Sync Waves

We use Argo CD sync waves to manage the deployment order of cluster components. This ensures that infrastructure dependencies (like MetalLB or Cert-Manager) are ready before the applications that depend on them are deployed.

The intended sync waves are:

| Wave   | Components                                              | Description                                                                                     |
| :----- | :------------------------------------------------------ | :---------------------------------------------------------------------------------------------- |
| **-4** | `argo-cd`                                               | Argo CD manages itself first to ensure the controller is up-to-date.                            |
| **-3** | `metallb`, `cert-manager`, `nfs-csi`, `reloader`, `nfd` | Foundational infrastructure: Networking, Certificates, Storage Drivers, and Hardware Discovery. |
| **-2** | `longhorn`, `ingress-controllers`, `intel-gpu`          | Distributed storage, Ingress management, and Intel GPU.                                         |

| **-1** | `auth`, `mail-proxy`, `cnpg-operator`, `dns` | Supporting services (Identity, Mail), Database operators, and DNS. |
| **0** | All other applications | Default wave for most user applications and workloads. |

> **Note**: Applications with no specified sync wave will automatically deploy in **wave 0**.

To set a sync wave for an application, add the following annotation to its `Application` manifest in `kubernetes/root-app/templates/`:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "99"
```

### Pruning vs. Finalizers (Safety Pattern)

We use a specific configuration to balance automation with safety:

1.  **`prune: true` in `root-app`**: This ensures that if you remove an application's YAML file from Git, the `Application` object is automatically removed from the Argo CD dashboard.
2.  **`root-app` Finalizer (OMITTED)**: By omitting the finalizer on the `root-app` itself, deleting it will NOT delete the child `Application` objects it manages. This is a safety measure for the cluster entry point.
3.  **Child App Finalizers (REQUIRED)**: All other applications should include `resources-finalizer.argocd.argoproj.io`. This ensures that when an app is removed from Git (and pruned by `root-app`), its managed resources (Pods, Services, etc.) are correctly cleaned up from the cluster.

### Recovery and Adoption

If the `root-app` is accidentally deleted, it can be safely re-applied using `scripts/install-argocd` or `kubectl apply -f kubernetes/root-app/templates/root-app.yaml`.

Because child applications were orphaned (due to the lack of a finalizer), the new `root-app` will **automatically adopt** the existing objects based on their name and namespace. No duplicate resources will be created, and the sync state will be restored immediately.

### Extending Existing Charts (Wrapper Pattern)

We follow a "wrapper chart" pattern to manage applications. Instead of deploying raw upstream charts, we create a local chart that includes the upstream chart as a dependency in `Chart.yaml`. This allows us to:

1.  **Configure values**: Override defaults in the upstream chart in `values.yaml`.
2.  **Add extra resources**: Add custom Kubernetes templates (e.g., `NetworkPolicy`, `Ingress`, `ServiceAccount`) in the `templates/` directory.

#### Example: Argo CD Wrapper

The `kubernetes/charts/argo-cd` directory is a perfect example:

**`Chart.yaml`**:

```yaml
dependencies:
  - name: argo-cd
    version: 5.46.8
    repository: https://argoproj.github.io/argo-helm
```

**`values.yaml`**:
Overrides for the `argo-cd` dependency are placed under the dependency name's key:

```yaml
argo-cd:
  dex:
    enabled: false
  # ... other overrides
```

> **Note**: While Argo CD automatically handles fetching dependencies during deployment (via `helm dependency build`), you may want to run `helm dependency update` locally if you need to validate templates or run local dry-runs. The fetched charts are ignored by git via `kubernetes/.gitignore` to keep the repository clean.

#### Adding Extra Resources

To add extra resources that are not part of the upstream chart, simply create a `templates/` directory within the wrapper chart and add your YAML manifests there. These resources will be rendered and deployed along with the chart's dependencies.

```bash
kubernetes/charts/my-app/
├── Chart.yaml       # Defines dependency
├── values.yaml      # Configuration overrides
└── templates/
    └── extra-res.yaml # Custom Kubernetes resource
```

## Global Configuration

Cluster-wide constants and shared values are maintained in `kubernetes/global-values.yaml`.

To use these values in your application:

1.  **In Helm Templates**: Reference them via `.Values.global` (e.g., `{{ .Values.global.domain }}`).
2.  **In Argo CD Application**: Include the global values file in the `valueFiles` list of the application source:

```yaml
helm:
  # Files are merged in order.
  # The chart's own values.yaml is always loaded first by default.
  valueFiles:
    - ../../global-values.yaml
    # You can add more override files here if needed
```

### Typical Workflow

1.  **`kubernetes/charts/my-app/values.yaml`**: Contains app-specific configuration (e.g., image tags, replica counts).
2.  **`kubernetes/global-values.yaml`**: Contains cluster-wide settings (e.g., `domain: dray.id.au`).
3.  **Result**: Your templates can access both `{{ .Values.image.tag }}` and `{{ .Values.global.domain }}` seamlessly.
