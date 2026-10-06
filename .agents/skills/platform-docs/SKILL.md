---
name: platform-docs
description: >-
  Provides comprehensive knowledge, procedures, and official documentation
  for core platform technologies used in home-cluster (Talos Linux, Longhorn distributed
  storage, and related platform infrastructure). Use whenever tasks require looking up
  upstream documentation across versions, inspecting machine configs, upgrading Talos/Longhorn,
  configuring storage volumes, backups, recurring jobs, or troubleshooting node lifecycle.
---

# Cluster Platform Documentation & Knowledge Base Skill

This skill provides access to local mirrors of official upstream documentation for core platform technologies powering the cluster—principally **Talos Linux** ([docs.siderolabs.com](https://docs.siderolabs.com)) and **Longhorn** ([longhorn.io/docs](https://longhorn.io/docs/))—along with established cluster patterns, configuration paradigms, and safety runbooks.

The documentation fetcher automatically pulls the full documentation tree without hardcoded versions and dynamically discovers and queries the latest documentation releases.

---

## 1. Knowledge Base Navigation

Upstream documentation is mirrored locally under `references/` (auto-cloned on first run via `lookup.sh` or `update-docs.sh` using fast sparse checkouts):

- **Talos Linux**: `references/talos/public/talos/` (automatically resolves to the latest version, e.g. `v1.14+`, or allows querying any version)
- **Longhorn**: `references/longhorn/content/docs/` (automatically resolves to the latest version, e.g. `1.13+` / `1.14+`) & `references/longhorn/content/kb/`

### Key Reference Files: Talos Linux

| Category                       | Path Pattern (`<version>` defaults to latest)                                                                             |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| **CLI Reference (`talosctl`)** | `references/talos/public/talos/<version>/reference/cli.mdx`                                                               |
| **Machine Config Reference**   | `references/talos/public/talos/<version>/reference/configuration/`                                                        |
| **Storage & Disks**            | `references/talos/public/talos/<version>/configure-your-talos-cluster/storage-and-disk-management/`                       |
| **Disk Encryption**            | `references/talos/public/talos/<version>/configure-your-talos-cluster/storage-and-disk-management/disk-encryption.mdx`    |
| **Machine Reset & Lifecycle**  | `references/talos/public/talos/<version>/configure-your-talos-cluster/lifecycle-management/resetting-a-machine.mdx`       |
| **System Extensions**          | `references/talos/public/talos/<version>/build-and-extend-talos/custom-images-and-development/system-extensions.mdx`      |
| **Disaster Recovery (etcd)**   | `references/talos/public/talos/<version>/build-and-extend-talos/cluster-operations-and-maintenance/disaster-recovery.mdx` |
| **Networking & KubeSpan**      | `references/talos/public/talos/<version>/networking/`                                                                     |
| **Security & Hardening**       | `references/talos/public/talos/<version>/security/`                                                                       |
| **Troubleshooting**            | `references/talos/public/talos/<version>/troubleshooting/`                                                                |

### Key Reference Files: Longhorn

| Category                                | Path Pattern (`<version>` defaults to latest)                                                              |
| :-------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| **Nodes and Volumes**                   | `references/longhorn/content/docs/<version>/nodes-and-volumes/`                                            |
| **Snapshots and Backups**               | `references/longhorn/content/docs/<version>/snapshots-and-backups/`                                        |
| **Scheduling Backups / Recurring Jobs** | `references/longhorn/content/docs/<version>/snapshots-and-backups/scheduling-backups-and-snapshots.md`     |
| **Backup & Restore**                    | `references/longhorn/content/docs/<version>/snapshots-and-backups/backup-and-restore/`                     |
| **Disaster Recovery Volume**            | `references/longhorn/content/docs/<version>/advanced-resources/data-integrity/disaster-recovery-volume.md` |
| **High Availability & Engine**          | `references/longhorn/content/docs/<version>/high-availability/`                                            |
| **Maintenance & Node Drain**            | `references/longhorn/content/docs/<version>/maintenance/`                                                  |
| **Best Practices**                      | `references/longhorn/content/docs/<version>/best-practices.md`                                             |
| **Knowledge Base & Fixes**              | `references/longhorn/content/kb/`                                                                          |
| **Troubleshooting**                     | `references/longhorn/content/docs/<version>/troubleshoot/`                                                 |

### Searching the Knowledge Base

Search across both or scope directly to either system. You can pass versions in any natural format (`talos 1.14.2`, `talos@1.14.2`, `--version 1.14.2`, `longhorn 1.13`), or omit the version to automatically use the active cluster version configured in this repository (`talosVersion` from `talos/talconfig.yaml` and `longhorn` version from `Chart.yaml`):

```bash
# 1. Search using active cluster versions (automatic default):
.agents/skills/platform-docs/scripts/lookup.sh "fstrim"
.agents/skills/platform-docs/scripts/lookup.sh talos "ephemeral"
.agents/skills/platform-docs/scripts/lookup.sh longhorn "recurring-job"

# 2. Search specific versions (automatically normalized):
# Talos normalizes patch/minor (e.g. 1.14.2, v1.14.0 -> v1.14):
.agents/skills/platform-docs/scripts/lookup.sh talos 1.14.2 "ephemeral"
.agents/skills/platform-docs/scripts/lookup.sh talos 1.15 "extension"
.agents/skills/platform-docs/scripts/lookup.sh talos --version 1.12 "reset"

# Longhorn normalizes minor to latest patch (e.g. 1.13 -> 1.13.1, or exact 1.13.0, or archives):
.agents/skills/platform-docs/scripts/lookup.sh longhorn 1.13 "recurring-job-group"
.agents/skills/platform-docs/scripts/lookup.sh longhorn 1.13.0 "snapshot"
.agents/skills/platform-docs/scripts/lookup.sh longhorn 1.14 "spdk"

# 3. Token-efficient file listing (-l) or adjusted limits (-n / -a):
.agents/skills/platform-docs/scripts/lookup.sh talos 1.14 -l "ephemeral"      # List matching files only
.agents/skills/platform-docs/scripts/lookup.sh longhorn -n 3 "backup"        # Top 3 files
.agents/skills/platform-docs/scripts/lookup.sh talos -a "secureboot"         # Show all matches

# 4. Search across ALL versions (including archived docs and knowledge base):
.agents/skills/platform-docs/scripts/lookup.sh talos -v all "wipe"
.agents/skills/platform-docs/scripts/lookup.sh longhorn -v all "support-bundle"

# 5. Search specific subpaths within a version:
.agents/skills/platform-docs/scripts/lookup.sh talos 1.14 "extensions" build-and-extend-talos
.agents/skills/platform-docs/scripts/lookup.sh longhorn 1.13 "disaster-recovery" advanced-resources
```

### Version Structure & Normalization Rules

| Technology      | Upstream Doc Layout                                   | Normalization Behavior                                                                                                                               | On-Demand Fetch                                                                                                         |
| :-------------- | :---------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Talos Linux** | `public/talos/v<major>.<minor>/`                      | Strips `v`, extracts `major.minor`, maps `1.14.2` / `v1.14.0` -> `v1.14`.                                                                            | If a version is missing (e.g. `v1.15`), automatically clones from `siderolabs/talos` branches (`release-1.x` / `main`). |
| **Longhorn**    | `content/docs/<major>.<minor>.<patch>/` & `archives/` | If minor provided (`1.13`), resolves to latest available patch (`1.13.1`). If exact patch provided (`1.13.0`), uses exact dir or checks `archives/`. | Pulls full docs and `content/kb/` via sparse checkout.                                                                  |

### Keeping Knowledge Base Up to Date

The update script uses Git sparse checkouts to keep the mirrors lightweight without downloading full source code trees or blobs:

```bash
# Update all platform documentation mirrors:
.agents/skills/platform-docs/scripts/update-docs.sh all

# Update a specific platform technology (and optionally pre-fetch a version):
.agents/skills/platform-docs/scripts/update-docs.sh talos
.agents/skills/platform-docs/scripts/update-docs.sh talos 1.15
.agents/skills/platform-docs/scripts/update-docs.sh longhorn
```

---

## 2. Configuration Paradigms & Cluster Conventions

### Talos Linux

- **API-Driven & Immutable OS**: Talos has **no SSH**, no `/etc` or `/var` runtime text edits, and no package manager. All system configuration is declared in `talos/talconfig.yaml` and compiled/applied via `talhelper`.
- **Environment & Execution**: Always prefix commands with `direnv exec .` and use `rtk` where supported:
  ```bash
  direnv exec . rtk talosctl get members
  direnv exec . rtk talosctl get machinestatus -n <node-ip>
  ```
- **Talos 1.14+ Ephemeral Mount Security (`noexec`)**:
  Starting in Talos 1.14, newly formatted `EPHEMERAL` partitions default to `noexec`. Because Longhorn v1 engines execute helper binaries under `/var/lib/longhorn`, `talconfig.yaml` explicitly configures:
  ```yaml
  systemDisk:
    ephemeral:
      mount:
        secure: false
  ```
  Never remove or omit this override on new nodes or disk wipes.

### Longhorn Storage

- **The Explicit Three-Resource Pattern**:
  For single-instance applications, Longhorn volumes are defined statically using the explicit 3-resource pattern (`Volume` CR in `longhorn-system`, `PersistentVolume`, and `PersistentVolumeClaim`).
  Always use the Helm helper template from `common`:
  ```yaml
  {{- include "common.longhornVolume" (dict "ctx" . "name" "app-data-v2" "sizeGi" .Values.volumeSizeGi) -}}
  ```
  Labels applied automatically include:
  - `recurring-job-group.longhorn.io/fstrim-enabled: enabled`
  - `recurring-job-group.longhorn.io/backups-enabled: enabled` (unless `"backups" "disabled"` is passed)
- **Managed Databases Exception**:
  CloudNativePG and dynamically scaled workloads do **not** use the static 3-resource pattern. They use standard dynamic PVCs with `storageClassName: longhorn` or `storageClassName: longhorn-v2`.
- **Backup Target**:
  Cluster backups target NFS over Tailscale: `nfs://storage.chimera-exponential.ts.net:/mnt/pool/backups/longhorn`.

---

## 3. Workflows & Safety Runbooks

### Safe Talos Node Reset

When resetting a Talos node, **ALWAYS** specify `--system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL`:

```bash
direnv exec . rtk talosctl reset -n <node-ip> \
  --system-labels-to-wipe STATE \
  --system-labels-to-wipe EPHEMERAL \
  --reboot \
  --graceful=false
```

> [!CAUTION]
> **Refuse Incomplete Resets**: Running a bare `talosctl reset` wipes the entire disk including the boot partition, breaking maintenance mode reboot and requiring physical USB boot drive intervention. NEVER run or propose a reset without `--system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL`.

### Safe Sequential Rolling Node Upgrades

1. **Check Prerequisites**:
   - Verify Longhorn volume replication is 100% healthy: `kubectl get volumes.longhorn.io -n longhorn-system -o custom-columns=NAME:.metadata.name,ROBUSTNESS:.status.robustness` (must report `healthy`).
2. **Upgrade One Node at a Time**:
   ```bash
   direnv exec . rtk talosctl upgrade -n <node-ip> --image <installer-image>
   ```
3. **Dual Status Verification**:
   Verify **both** Talos machine status and Kubernetes node readiness before proceeding to any subsequent node:
   - Talos: `direnv exec . rtk talosctl get machinestatus -n <node-ip>` reports `READY: true`.
   - Kubernetes: `direnv exec . rtk kubectl get node <node-name> -o wide` reports `Ready` with the new version.
4. **Volume Resync Verification**:
   Confirm all degraded Longhorn replicas finish rebuilding before initiating the next node upgrade.

### Cluster Write Safety Policy

- **NEVER** run mutating commands against the Kubernetes cluster without explicit user instruction.
- **NEVER** perform out-of-band modifications (`kubectl apply`, `kubectl edit`) that bypass GitOps. Define changes in Helm charts or `talconfig.yaml` and sync through ArgoCD and `talhelper`.
