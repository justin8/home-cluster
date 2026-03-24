# Project Context: home-cluster

## Documentation & Knowledgebase

- **Directory:** All project documentation is maintained in the `docs/` directory.
- **Usage:** Treat the contents of `docs/` as a comprehensive knowledgebase. Before implementing new features or making significant architectural changes, research existing documentation to ensure alignment with established patterns (e.g., Talos configuration, networking, storage).

## ArgoCD Standards

- **Application Manifests:** Must hardcode `repoURL` and `targetRevision` in `kubernetes/root-app/templates/` to ensure reliability during bootstrap.
- **Namespaces:** Never define `Namespace` resources in `root-app/templates`. Use `managedNamespaceMetadata` within the `Application` resource's `syncPolicy` to manage namespace-level labels and annotations. Use `syncOptions: [CreateNamespace=true]` for automatic namespace creation.

## Sealed Secrets Standards

- **NEVER COMMIT UNSEALED SECRETS:** Raw `Secret` resources, `.env` files, or any cleartext credentials MUST NEVER be committed to the repository.
- **Encryption:** All sensitive data MUST be stored as `SealedSecret` resources encrypted with the cluster's public key.
- **Secrets vs ConfigMaps:** Only store genuinely secret values (passwords, tokens, private keys) in SealedSecrets. Non-sensitive configuration (URLs, feature flags, usernames, email addresses) MUST go in a plain `ConfigMap`.
- **Tools:** Use `kubeseal` for creating and managing sealed secrets via the `sealed-secrets-controller` in the `kube-system` namespace.
- **Scopes:** Prefer **strict** scope (default) for secrets tied to a specific application and namespace. Use **cluster-wide** scope only for shared secrets.
- **Procedures:** Refer to `docs/SEALED_SECRETS.md` for detailed instructions on creating, backing up, and restoring sealed secrets.

## Volume Pattern

Always use the explicit three-resource pattern for Longhorn volumes. Never use dynamic provisioning (PVC-only with storageClassName).

Every volume requires:

1. `longhorn.io/v1beta2 Volume` in `longhorn-system` — with recurring job group labels
2. `PersistentVolume` (cluster-scoped) — CSI binding to the Longhorn volume
3. `PersistentVolumeClaim` in the app namespace — references PV by `volumeName`

Recurring job groups go as **labels on the Longhorn Volume**, not annotations on the PVC:

```yaml
labels:
  recurring-job-group.longhorn.io/backups-enabled: enabled
  recurring-job-group.longhorn.io/fstrim-enabled: enabled
```

Volume size is configured in `values.yaml` as Mi or Gi depending on the application's needs. Use Mi for volumes under 1Gi, Gi otherwise. The Longhorn `Volume` spec requires bytes — convert using `mul .Values.volumeSizeMi 1024 | mul 1024` (Mi) or `mul .Values.volumeSizeGi 1024 | mul 1024 | mul 1024` (Gi). The PV and PVC use the value directly with the appropriate suffix:

```yaml
# values.yaml (Mi example — for volumes under 1Gi)
volumeSizeMi: 100
```

```yaml
# values.yaml (Gi example — for volumes 1Gi and above)
volumeSizeGi: 5
```

```yaml
# volume.yaml (Longhorn Volume spec)
spec:
  size: {{ mul .Values.volumeSizeMi 1024 | mul 1024 | quote }}   # Mi
  # or
  size: {{ mul .Values.volumeSizeGi 1024 | mul 1024 | mul 1024 | quote }}  # Gi

# PV and PVC
  storage: {{ .Values.volumeSizeMi }}Mi   # or {{ .Values.volumeSizeGi }}Gi
```

See `kubernetes/charts/mail-proxy/templates/volume.yaml` as the reference implementation. Always name the file `volume.yaml`.

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
