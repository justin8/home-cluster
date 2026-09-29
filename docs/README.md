# Home Cluster Documentation

Welcome to the knowledgebase for the `home-cluster` repository.

## Active Documentation Index

The root of `docs/` contains active, authoritative guides reflecting the current desired state of the production cluster.

| Document                                                                                          | Scope                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [**NETWORKING_AND_DNS.md**](file:///Users/justindray/src/home-cluster/docs/NETWORKING_AND_DNS.md) | Cilium CNI (eBPF dataplane, L2 announcements, IPAM), Multus CNI, Pomerium Ingress/IAP, Tailscale, Pi-hole split-horizon DNS. |
| [**TALOS.md**](file:///Users/justindray/src/home-cluster/docs/TALOS.md)                           | Talos Linux node provisioning, `talconfig.yaml`, `talhelper`, node wiping/reset safety, and rolling upgrade verification.    |
| [**ARGOCD.md**](file:///Users/justindray/src/home-cluster/docs/ARGOCD.md)                         | GitOps standards, App of Apps pattern (`root-app`), sync policies, and application manifest checklists.                      |
| [**AUTH.md**](file:///Users/justindray/src/home-cluster/docs/AUTH.md)                             | PocketID OIDC authentication, `PocketIDOIDCClient` custom resource pattern, and client credential rotation.                  |
| [**LONGHORN.md**](file:///Users/justindray/src/home-cluster/docs/LONGHORN.md)                     | Longhorn distributed block storage, the 3-resource volume pattern, and volume disaster recovery.                             |
| [**POSTGRES_USAGE.md**](file:///Users/justindray/src/home-cluster/docs/POSTGRES_USAGE.md)         | CloudNativePG (CNPG) database clusters, Backblaze B2 physical Barman backups, and WAL archive rules.                         |
| [**SEALED_SECRETS.md**](file:///Users/justindray/src/home-cluster/docs/SEALED_SECRETS.md)         | SealedSecrets controller usage, encryption scopes, and master key backup/recovery via SOPS.                                  |
| [**IMMICH.md**](file:///Users/justindray/src/home-cluster/docs/IMMICH.md)                         | Immich photo management database backup, restore, and maintenance procedures.                                                |

---

## Archive Directory (`docs/archive/`)

The [`docs/archive/`](file:///Users/justindray/src/home-cluster/docs/archive) folder is reserved for **historical documentation, completed migration plans, and transition handovers**.

- **Purpose:** Preserves historical context, migration design decisions, and execution logs for posterity without cluttering active documentation.
- **Agent Context Policy:** AI agents and automations should **not** load or consult files in `docs/archive/` as active operational guidelines. Only consult them when explicitly researching past migration history.

### Archived Files

- [`CILIUM_MIGRATION.md`](file:///Users/justindray/src/home-cluster/docs/archive/CILIUM_MIGRATION.md) — Completed zero-impact staging migration from Flannel/MetalLB to Cilium CNI and eBPF.
- [`MIGRATION_HANDOVER.md`](file:///Users/justindray/src/home-cluster/docs/archive/MIGRATION_HANDOVER.md) — Multi-wave service restoration and migration checklist completed during cluster re-platforming.
