# Project Context: home-cluster

## Documentation & Knowledgebase

- **Directory:** All project documentation is maintained in the `docs/` directory.
- **Usage:** Treat the contents of `docs/` as a comprehensive knowledgebase. Before implementing new features or making significant architectural changes, research existing documentation to ensure alignment with established patterns (e.g., Talos configuration, networking, storage).

## Helm Chart Versions

When adding a new Helm chart dependency to a `Chart.yaml`, always look up the current stable version before writing the file. Use:

```bash
helm repo add <repo-name> <repo-url>
helm repo update
helm search repo <repo-name>/<chart-name>
```

Pin the dependency to the latest stable version found. Never guess or use placeholder versions.

## ArgoCD Standards

- **Application Manifests:** Must follow this strict checklist for `kubernetes/root-app/templates/`:
  1. **`metadata.namespace`**: Always use `argocd`.
  2. **`repoURL`**: Always use `https://github.com/justin8/home-cluster.git`.
  3. **`targetRevision`**: Always use `main`.
  4. **`valueFiles`**: Must use `../../../global-values.yaml` (exactly 3 levels of up-traversal) to reach the root-level global values from an app chart path.
  5. **`port`**: When using `common.ingress`, ensure the `port` matches the Service port (it defaults to 80).

- **Namespaces:** Never define `Namespace` resources in `root-app/templates`. Use `managedNamespaceMetadata` within the `Application` resource's `syncPolicy` to manage namespace-level labels and annotations. Use `syncOptions: [CreateNamespace=true]` for automatic namespace creation.

## Sealed Secrets Standards

- **NEVER COMMIT UNSEALED SECRETS:** Raw `Secret` resources, `.env` files, or any cleartext credentials MUST NEVER be committed to the repository.
- **Encryption:** All sensitive data MUST be stored as `SealedSecret` resources encrypted with the cluster's public key.
- **Secrets vs ConfigMaps:** Only store genuinely secret values (passwords, tokens, private keys) in SealedSecrets. Non-sensitive configuration (URLs, feature flags, usernames, email addresses) MUST go in a plain `ConfigMap`.
- **Tools:** Use `kubeseal` for creating and managing sealed secrets via the `sealed-secrets-controller` in the `kube-system` namespace. **`kubeseal` is pre-configured to communicate with the cluster; do NOT attempt to manually retrieve or provide the public key/certificate. Do NOT specify custom endpoints or namespaces for the kubeseal command itself; let it use its defaults.**
- **Scopes:** Prefer **strict** scope (default) for secrets tied to a specific application and namespace. Use **cluster-wide** scope only for shared secrets.
- **Procedures:** Refer to `docs/SEALED_SECRETS.md` for detailed instructions on creating, backing up, and restoring sealed secrets.

## Volume Pattern

Always use the explicit three-resource pattern for Longhorn volumes for applications that support only a single instance. This pattern provides stable, human-readable volume names and simplifies manual management.

**Exceptions:** Do NOT use this pattern for managed databases (e.g., CloudNativePG) or services that require dynamic provisioning for horizontal scaling/failover. These services should use dynamic provisioning (PVC-only with `storageClassName: longhorn`).

### Longhorn Volumes (Config/Data)

Every manual volume requires:
...
Volume size is typically configured in `values.yaml` as `volumeSizeGi`.

### NFS Storage (Media)

The cluster uses a shared NFS storage server for media.

- **Storage Server IP**: `100.92.202.28` (available via `.Values.network.storageServer`)
- **Base Export Path**: `/mnt/pool/media`
- **Verified Media Paths**:
  - **Books**: `/mnt/pool/media/books`
  - **Audiobooks**: `/mnt/pool/media/audiobooks`
  - **Podcasts**: `/mnt/pool/media/podcasts`
  - **Downloads**: `/mnt/pool/media/downloads`
  - **General Media**: `/mnt/pool/media`

**Mounting Pattern**:
Prefer mounting the specific subdirectory directly (e.g., `path: /mnt/pool/media/books`) when possible. If mounting a generic media volume, use the base path with a `subPath` in the `volumeMounts` to isolate directories.

Example:

```yaml
volumes:
  - name: media
    nfs:
      server: { { .Values.network.storageServer } }
      path: /mnt/pool/media/books
```

## Ingress Pattern

For consistency, use the `common.ingress` template (in `kubernetes/charts/common/templates/_ingress.tpl`) to define ingress resources.

It supports:

- `ctx`: The helm context (`.`)
- `type`: `traefik-private` (default) or `traefik-public`
- `name`: Service name (defaults to `Chart.Name`)
- `subdomain`: DNS subdomain (defaults to `name`)
- `port`: Service port (defaults to 80)
- `auth`: Boolean, enables TinyAuth middleware (defaults to `false`)
- `annotations`: Optional dictionary of extra annotations

```yaml
{ { - include "common.ingress" (dict "ctx" . "subdomain" "my-app" "auth" true) - } }
```

For public services, also include the public ingress:

```yaml
{{- include "common.ingress" (dict "ctx" . "subdomain" "my-app") -}}
{{- include "common.ingress" (dict "ctx" . "subdomain" "my-app" "type" "traefik-public") -}}
```

## Authentication & OIDC

- **Provider:** The cluster uses PocketID.
- **Client Management:** Use the `PocketIDOIDCClient` custom resource.
- **Credentials Secret:** The operator generates a secret named `{metadata.name}-oidc-credentials`.
- **Secret Keys:** ALWAYS use lowercase keys as defined in `docs/AUTH.md` (e.g., `client_id`, `client_secret`, `issuer_url`). Refer to `docs/AUTH.md` for the full list of available keys and configuration details.

## Project Steering

- **Directory:** Key project guidance and steering documents are located in `.kiro/steering/`.
- **Loading:** Always refer to the files in `.kiro/steering/` (e.g., `product.md`, `structure.md`, `tech.md`) to understand the high-level goals, technical constraints, and organizational structure of this cluster.

## Cluster Write Safety

**NEVER run write/mutating commands against the Kubernetes cluster without explicit user instruction.**

This includes (but is not limited to):

- `kubectl apply`, `kubectl create`, `kubectl delete`, `kubectl patch`, `kubectl edit`
- `kubectl rollout restart`
- Any `helm install`, `helm upgrade`, `helm uninstall`
- Any `talosctl` commands that modify node state

Read-only commands (`kubectl get`, `kubectl describe`, `kubectl logs`, `kubectl diff`) are fine.

Always show the user the command and explain what it will do — let them run it.

## CLI Tool Usage

- **Token Efficiency:** For project-specific CLI tools like `talosctl` and `kubeseal`, always prefix the command with `rtk` (e.g., `rtk talosctl get members`). This wrapper reduces token usage by optimizing output for the AI.
- **Exceptions:** Do **NOT** use `rtk` with `kubectl` or `helm` commands. Use them directly (e.g., `kubectl get pods`).
