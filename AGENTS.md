# Project Context: home-cluster

## Documentation & Knowledgebase

- **Directory:** All project documentation is maintained in the `docs/` directory. Refer to `docs/README.md` for the index.
- **Active Knowledgebase:** Treat the root markdown files in `docs/*.md` as the authoritative, active knowledgebase. Before implementing new features or making architectural changes, research existing documentation to ensure alignment with established patterns (Talos configuration, networking, storage).
- **Archive Directory (`docs/archive/`):** Completed migration plans, historical phase handovers, and deprecated architecture notes are preserved in `docs/archive/`. Do NOT load or read `docs/archive/` files into active context during standard operations; only consult them when the user explicitly requests historical migration context.

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

## Ingress Pattern (Pomerium)

The cluster uses **Pomerium** as the sole Ingress Controller and Identity-Aware Proxy. **Always use the `common.pomeriumIngress` template from the common chart.**

### Template Usage

```yaml
{{ include "common.pomeriumIngress" (dict
  "ctx" .
  "name" "my-app"
  "subdomain" "my-app"      # optional, defaults to name
  "port" 80                 # optional, defaults to 80
  "path" "/"                # optional, defaults to /
  "serviceName" "my-svc"    # optional, defaults to name
  "type" "private"          # optional: private (default) or public
  "allowedUsers" "authed"   # optional: authed (default), all, private, admin
  "responseHeaders" (dict "X-Custom-Header" "value") # optional
) }}
```

### Parameters

- **`type`**: `private` (default) directs internal DNS to the Tailnet IP (`network.privateIngress`) and adds a deny rule blocking non-Tailscale traffic. `public` points internal DNS to `network.pomeriumIngress`, enables Cloudflare DNS, and removes the IP deny rule.
- **`allowedUsers`**:
  - `authed` (default) — any authenticated user (`authenticated_user: true`)
  - `all` — unauthenticated access (`accept: true`)
  - `private` — users in `userGroups.private`
  - `admin` — users in `userGroups.admin`

All ingresses always include: `preserve_host_header`, `pass_identity_headers`, `allow_websockets`, and `timeout: 0s`.

## Security & Secrets

- **NEVER COMMIT PLAIN-TEXT SECRETS:** This includes API keys, passwords, tokens, and OIDC client secrets.
- **Verification:** Always double-check `git diff` before committing to ensure no sensitive data is staged.
- **SealedSecrets:** For permanent secrets, use `kubeseal` to create `SealedSecret` resources.
- **Runtime Injection:** For applications requiring complex JSON configuration (like Paperless-ngx), use runtime injection in the `Deployment` command to construct JSON from environment variables sourced from Kubernetes Secrets.

## Authentication & OIDC

- **Provider:** The cluster uses PocketID.
- **Client Management:** Use the `PocketIDOIDCClient` custom resource.
- **Credentials Secret:** The operator generates a secret named `{metadata.name}-oidc-credentials`.
- **Secret Keys:** ALWAYS use lowercase keys as defined in `docs/AUTH.md` (e.g., `client_id`, `client_secret`, `issuer_url`). Refer to `docs/AUTH.md` for the full list of available keys and configuration details.
- **Automated OIDC Syncing:** Many applications support OIDC only via internal configuration (database tables, JSON/XML files on PVCs) rather than native environment variable injection. To ensure disaster recovery, cluster restores, and secret rotations work seamlessly without manual intervention, ALWAYS automate the synchronization of credentials from `{metadata.name}-oidc-credentials` into the application's configuration store via an `initContainer` or startup script (see `docs/AUTH.md` for implemented patterns like Immich, Kavita, and Jellyfin).
- **OIDC & Pomerium Egress Network Policy:** PocketID is exposed via Pomerium (`https://pocketid.<domain>`). When in-cluster workloads connect to the Pomerium VIP (`192.168.5.4:443`), Cilium eBPF socket-level load balancing (`connect4`) translates the destination socket directly to Pomerium proxy pods on container port `8443`. Every workload with an OIDC integration MUST include egress rules allowing:
  1. `toEndpoints` matching `app.kubernetes.io/name: pomerium` in `namespace: pomerium` on ports `443` and `8443`.
  2. `toCIDRSet` matching `network.pomeriumIngress/32` and `network.privateIngress/32` on ports `443` and `8443`.
     Without both ports and endpoints, Cilium drops outbound OIDC discovery/token requests post-DNAT.

## Cluster Write Safety

**NEVER run write/mutating commands against the Kubernetes cluster without explicit user instruction.**

**NEVER perform manual, out-of-band modifications to cluster resources (e.g., `kubectl apply`, `kubectl patch`, `kubectl edit`) that bypass the established GitOps workflow or Talos configuration. All changes MUST be defined in code (Helm charts, `talconfig.yaml`, etc.) and applied through the designated automation (ArgoCD, `talhelper`).**

This includes (but is not limited to):

- `kubectl apply`, `kubectl create`, `kubectl delete`, `kubectl patch`, `kubectl edit`
- `kubectl rollout restart`
- Any `helm install`, `helm upgrade`, `helm uninstall`
- Any `talosctl` commands that modify node state

Read-only commands (`kubectl get`, `kubectl describe`, `kubectl logs`, `kubectl diff`) are fine.

## Talos Node Reset Safety

- **Partition Wipe Flags:** When resetting a Talos node, **ALWAYS** specify `--system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL` (along with `--reboot` and `--graceful=false`). This ensures only the `STATE` and `EPHEMERAL` partitions are wiped, leaving the boot partition intact so the node reboots cleanly into maintenance mode without requiring a USB boot drive.
- **Refuse Incomplete Resets:** **NEVER** run, propose, or execute a `talosctl reset` command without those explicit flags (`--system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL`). Refuse any Talos reset that wipes the boot partition or omits these flags.

## Configuration Durability & Disaster Recovery Safety

- **Parity Between Upgrades and Replacements:** **NEVER** rely on "existing nodes keep old behavior during upgrades" when new defaults would break fresh node provisions, node replacements, or full cluster disaster recovery.
- **Explicit Compatibility Configurations:** All configurations in `talconfig.yaml` and Helm charts MUST be explicitly defined to work identically during rolling upgrades AND when a node is replaced, wiped, or recreated from scratch.
- **Proactive Mitigation of Breaking Defaults:** When an upstream upgrade introduces new defaults that only apply to newly formatted disks/partitions (e.g., Talos 1.14 defaulting `EPHEMERAL` `/var` to `noexec`, breaking Longhorn v1 binary execution), the configuration MUST explicitly declare the required overrides (e.g., `VolumeConfig` with `mount.secure: false` for `EPHEMERAL`) in `talconfig.yaml` _before_ or _during_ the upgrade.
- **Raise Ambiguity Immediately:** Any backwards-incompatible change, behavioral divergence between existing and new nodes, or security-versus-compatibility trade-off MUST be raised directly to the user for explicit approval before making decisions or applying changes.

## Talos Upgrade Verification Safety

- **Dual Status Verification:** NEVER consider a Talos node upgrade complete based solely on `kubectl get nodes`. You MUST verify BOTH:
  1. **Talos Machine Status:** `rtk talosctl get machinestatus -n <node-ip>` must report `READY: true` and have no unmet conditions (or check the Talos dashboard).
  2. **Kubernetes Node Status:** `kubectl get nodes -o wide` must report `Ready` with the target OS version.
- **Sequential Rolling Upgrades:** Always upgrade nodes one at a time. Never proceed to upgrade subsequent nodes until the previous node passes both Talos and Kubernetes health checks and Longhorn volume replication is 100% healthy.

## CLI Tool Usage

- **Environment & direnv:** All CLI tools (`kubectl`, `talosctl`, `helm`, `talhelper`, `kubeseal`, `sops`, `yq`, `gh`, etc.) and environment variables (`KUBECONFIG`, `TALOSCONFIG`, `SOPS_AGE_KEY_FILE`) are managed via Nix through `direnv`. In subshells, scripts, or agent execution environments where direnv has not automatically exported into `$PATH`, always execute commands prefixed with `direnv exec .` (e.g., `direnv exec . rtk kubectl get pods`, `direnv exec . rtk talosctl get members`).
- **GitHub CLI (`gh`):** The GitHub CLI (`gh`) is available in the environment. When looking up information on GitHub (e.g., repository details, releases, tags, issues, pull requests, file contents, or GitHub API queries), use `gh` (e.g., `gh release view`, `gh repo view`, `gh api`) instead of `curl` wherever possible.
- **Token Efficiency:** For CLI tools supported by `rtk` (including `kubectl`, `talosctl`, `talhelper`, and `kubeseal`), always prefix the command with `rtk` (e.g., `direnv exec . rtk kubectl get pods`, `direnv exec . rtk talosctl get members`). This wrapper reduces token usage by optimizing output for the AI.
- **Exceptions:** Do **NOT** use `rtk` with unsupported tools like `helm` or `gh` commands. Use them directly (e.g., `direnv exec . helm search repo ...`, `direnv exec . gh release view`).

## Long-Running Tasks & Polling Discipline

- **No Tight Polling Loops:** NEVER poll in short, rapid loops (e.g., every 5–10 seconds) when monitoring asynchronous operations (Longhorn restores, container image pulls, pod rollouts, node reboots, database syncs).
- **Start and Wait:** Verify that the task has successfully initiated, estimate the expected duration based on workload size, and set a timer (`schedule`) for the realistic completion time before re-checking.
- **Exponential Backoff on Retries:** When a task requires re-checking or retrying, ALWAYS use exponential backoff (e.g. 1m -> 2m -> 4m -> 8m) rather than static or frequent intervals. Never spam status commands.
- **Blocking Wait Commands Over Loops:** Prefer executing blocking CLI commands or scripts that wait efficiently in the background and only terminate when the desired state is reached (or on timeout). Examples:
  - `kubectl wait --for=condition=Ready pod/<pod> --timeout=120s`
  - `kubectl rollout status ds/cilium --timeout=90s`
  - Shell `until`/`wait` scripts with internal sleep intervals rather than burning LLM round-trips.
