# Project Context: home-cluster

## Documentation & Knowledgebase

- **Directory:** All project documentation is maintained in the `docs/` directory.
- **Usage:** Treat the contents of `docs/` as a comprehensive knowledgebase. Before implementing new features or making significant architectural changes, research existing documentation to ensure alignment with established patterns (e.g., Talos configuration, networking, storage).

## ArgoCD Standards

- **Application Manifests:** Must hardcode `repoURL` and `targetRevision` in `kubernetes/root-app/templates/` to ensure reliability during bootstrap.
- **Namespaces:** Never define `Namespace` resources in `root-app/templates`. Use `managedNamespaceMetadata` within the `Application` resource's `syncPolicy` to manage namespace-level labels and annotations. Use `syncOptions: [CreateNamespace=true]` for automatic namespace creation.

## Project Steering

- **Directory:** Key project guidance and steering documents are located in `.kiro/steering/`.
- **Loading:** Always refer to the files in `.kiro/steering/` (e.g., `product.md`, `structure.md`, `tech.md`) to understand the high-level goals, technical constraints, and organizational structure of this cluster.
