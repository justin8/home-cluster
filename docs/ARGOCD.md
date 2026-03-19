# Argo CD GitOps

This project uses Argo CD for GitOps-based management of Kubernetes resources.

## Architecture

The cluster is managed using the "App of Apps" pattern (or ApplicationSets). Argo CD is responsible for synchronizing the state of the cluster with the configuration defined in this repository.

## Directory Structure

- `kubernetes/bootstrap/`: Initial resources needed to get Argo CD running.
- `kubernetes/apps/`: Argo CD Application definitions.
- `kubernetes/charts/`: Local Helm charts (built from scratch) or wrappers for external charts. Use these when you need templating or access to `global.yaml`.
- `kubernetes/manifests/`: Plain Kubernetes manifests or Kustomize overlays. Use these for static resources that don't require templating.
- `kubernetes/configs/`: Cluster-wide configurations (ConfigMaps, Secrets).

## How it works

1. **Talos Initialization**: The cluster is first bootstrapped using Talos.
2. **Argo CD Installation**: Argo CD is installed manually or via a script into the `argocd` namespace.
3. **Root Application**: A "root" application is created that points to `kubernetes/apps/`, which in turn manages all other applications in the cluster.

## New Cluster Setup

To set up a new cluster with Argo CD using the "App of Apps" pattern:

1.  **Prepare the Cluster**: Ensure your Kubernetes cluster is running (e.g., via Talos) and you have `kubectl` access.
2.  **Run the Install Script**:
    ```bash
    ./scripts/install-argocd
    ```
    This script will:
    - Install Argo CD into the `argocd` namespace.
    - Wait for the components to be ready.
    - Apply the **Root Application** from `kubernetes/bootstrap/root.yaml`.
3.  **Verify the Bootstrap**:
    - Argo CD will pick up the Root Application.
    - The Root Application will then render the `kubernetes/apps/` Helm chart.
    - This will create all the other `Application` resources (like MetalLB) defined in `kubernetes/apps/templates/`.
4.  **Access the UI**:
    ```bash
    kubectl port-forward svc/argocd-server -n argocd 8080:443
    ```
    Login at `https://localhost:8080` using the username `admin`. You can get the initial password with:
    ```bash
    kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
    ```

## Adding a new Application

To add a new application to the cluster:

1. **Choose a format**:
   - **Helm**: Create a chart in `kubernetes/charts/` (either a wrapper or a local one).
   - **Manifests**: Create a folder of YAMLs in `kubernetes/manifests/`.
2. Add an Argo CD `Application` manifest in `kubernetes/apps/`.

## Conceptual Mapping: Applications vs. Charts

| Concept         | Directory            | Description                                                                 | analogy          |
| :-------------- | :------------------- | :-------------------------------------------------------------------------- | :--------------- |
| **Chart**       | `kubernetes/charts/` | The collection of Kubernetes manifests (Deployments, Services, etc.).       | The **Program**  |
| **Application** | `kubernetes/apps/`   | An Argo CD resource that links a Git path (often a Chart) to a destination. | The **Shortcut** |

In our "App of Apps" setup:

1. The **Root Application** points to the `kubernetes/apps/` directory.
2. Each **Application** in that directory points to its corresponding **Chart** (or folder of manifests).

## Helm Chart Structure

In this repository, we use "wrapper charts" to manage external applications. Each application in `kubernetes/charts/` follows the standard Helm structure:

- **`Chart.yaml`**: Contains metadata about the chart (name, version) and, most importantly, the **dependencies**. This is where we specify the upstream Helm chart (e.g., the official MetalLB chart).
- **`values.yaml`**: Defines the default configuration for the chart. We use this to set application-specific defaults that don't change across environments.
- **`templates/`**: Contains custom Kubernetes manifests or "glue" resources. We use this for:
  - Custom Resources (CRDs) that aren't included in the base chart (e.g., MetalLB's `IPAddressPool`).
  - Template logic that allows us to inject global values into the configuration.

### Handling Dependencies (Sync Waves)

When a chart creates Custom Resources (CRs) that depend on CRDs installed by the same chart (or a dependency), we use **Sync Waves**.

Argo CD uses annotations to determine the order of operations:

- **Wave 0 (Default)**: The base application and its CRDs are installed.
- **Wave 1+**: Custom configurations (like MetalLB IP pools) are applied after the base application is ready.

Example annotation:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "1"
```

This wrapper pattern allows us to cleanly separate the official application code from our cluster-specific configurations and extensions.

## Glossary of Common Terms

- **Application**: The core Argo CD resource. It links a source (Git repository/path) to a destination (Kubernetes cluster/namespace).
- **Project**: A logical grouping of Applications, used for organizing and providing environment-level constraints (e.g., which clusters or namespaces an app can deploy to).
- **Sync**: The process of reconciling the **Actual State** (live in the cluster) with the **Desired State** (defined in Git).
- **Refresh**: Comparing the latest code in Git with the current live state without performing a Sync.
- **Prune**: The action of deleting resources from the cluster that are no longer present in the Git repository.
- **Self-Heal**: A feature where Argo CD automatically triggers a Sync if it detects that the live state has drifted from the Git state.
- **App of Apps**: A design pattern where one "root" Argo CD Application manages multiple other Application resources, allowing you to manage the entire cluster through a single entry point.
- **Health Status**: Argo CD's assessment of whether the resources in an application are functioning correctly (e.g., `Healthy`, `Progressing`, `Degraded`).

## Transition from Pulumi

We are currently transitioning from a Pulumi-based setup to Argo CD.
Legacy Pulumi code can be found in the `pulumi/` directory.
New configurations should be added to the `kubernetes/` directory.

### Migrated Services

- [x] MetalLB
