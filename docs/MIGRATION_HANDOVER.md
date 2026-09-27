# Cilium & Multus Migration Handover Guide

This document provides a comprehensive handover for resuming and completing the blue/green migration of the home cluster to **Cilium eBPF CNI**, **Multus CNI**, **KubePrism**, and native **L2 Announcements**.

---

## 1. Executive Summary & Cluster Topography

### Strategy

A **zero-impact blue/green staging migration** is in progress. The live production cluster remains untouched and fully serving traffic, while the new network stack, storage, certificates, and operators are validated on a dedicated staging node.

### Current Cluster Topography

| Environment         | Node IPs                                       | Floating VIP   | Role & Status                                                                     |
| :------------------ | :--------------------------------------------- | :------------- | :-------------------------------------------------------------------------------- |
| **Live Production** | `192.168.5.11`, `192.168.5.12`, `192.168.5.13` | `192.168.5.20` | **100% Online** (Serving Pomerium `192.168.5.4`, PiHole `192.168.5.53`, all apps) |
| **Staging Cluster** | `192.168.5.177` (VM: `talos-6l2-igz`)          | `192.168.5.19` | **Active Staging** (Cilium, Multus, ArgoCD, Longhorn, Cert-Manager, Tailscale)    |
| **Shared Storage**  | `100.92.202.28` / `192.168.5.5`                | —              | TrueNAS NFS server (`/mnt/pool/media`, `/mnt/pool/apps`)                          |

### Key Safety Constraints

1. **Zero Production Disruption**: `ipPools.enabled` in Cilium values MUST remain `false` and `dns.yaml` MUST remain in `disabled-core-services/` until Phase 4 cutover.
2. **Cluster Write Safety**: Never run mutating out-of-band commands (`kubectl apply`, `patch`, `edit`, `rollout restart`) without explicit user instruction. All configurations are GitOps-managed via ArgoCD and `talhelper`.
3. **Talos Wipe Safety**: When resetting/joining physical nodes in Phase 5, **always** use `--system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL` (preserving the boot partition).
4. **Tooling & direnv**: All CLI tools are managed via Nix. Prefix subshell commands with `direnv exec .` and use `rtk` for supported tools (`direnv exec . rtk kubectl ...`).

---

## 2. Git & Manifest Status

- **Active Branch**: `cilium` (tracking `origin/cilium`).
- **Core Services Location**: `kubernetes/root-app/templates/core-services/`
- **Disabled Core Services**: `kubernetes/root-app/disabled-core-services/dns.yaml`
- **Disabled Applications**: `kubernetes/root-app/disabled-apps/` (all 11 app manifests staged for restoration after cutover).

---

## 3. Wave-by-Wave Status on Staging Cluster

| Wave        | Applications / Services          | Status      | Details / Health                                                                                        |
| :---------- | :------------------------------- | :---------- | :------------------------------------------------------------------------------------------------------ |
| **Wave -5** | `cilium`                         | **Healthy** | Kube-proxy replacement, KubePrism (`localhost:7445`), `cni.exclusive: false`, Hubble UI/Relay active    |
| **Wave -5** | `multus`                         | **Healthy** | Thick daemonset (`v4.3.1-thick`), `NetworkAttachmentDefinition` CRD; multi-homed pod verified           |
| **Wave -4** | `shared-secrets`                 | **Healthy** | Sealed Secrets controller, Reflector, Reloader all unsealed and running                                 |
| **Wave -4** | `nfd`, `nfs-csi`, `vpa`          | **Healthy** | Node feature discovery, CSI NFS controller/nodes, VPA admission/recommender running                     |
| **Wave -3** | `cert-manager`                   | **Healthy** | Controller, Webhook, Cainjector running (1/1); `letsencrypt-prod` ClusterIssuer & `wildcard-cert` Ready |
| **Wave -2** | `longhorn`                       | **Healthy** | Longhorn v1.8+ CSI plugins, instance managers, engine image, manager (2/2), UI running                  |
| **Wave -2** | `cnpg-operator`                  | **Healthy** | CloudNativePG operator running (1/1)                                                                    |
| **Wave -2** | `intel-gpu`                      | **Healthy** | Intel device plugin controller running (1/1)                                                            |
| **Wave -1** | `tailscale-operator`             | **Healthy** | Operator pod running (1/1) with `tag:k8s-operator`, `home-exit-node` connector active                   |
| **Wave 0**  | `auth`, `mail-proxy`, `pomerium` | **Staged**  | Manifests placed in `templates/core-services/`                                                          |

---

## 4. How to Bootstrap the Environment

To interact with the staging cluster from a fresh terminal or new agent environment:

```bash
# 1. Enter the repository and allow direnv
cd ~/src/home-cluster
direnv allow

# 2. Verify git branch
git status # Ensure on branch 'cilium'

# 3. Verify connection to staging cluster
direnv exec . rtk kubectl get nodes -o wide
# Should show talos-6l2-igz (192.168.5.177) Ready with Talos v1.14.1

# 4. Verify ArgoCD applications
direnv exec . rtk kubectl get applications -n argocd
```

---

## 5. Step-by-Step Instructions to Complete Migration

### Step 1: Verify Wave 0 (Auth, Mail-Proxy, Pomerium)

1. Verify `auth` (PocketID), `mail-proxy`, and `pomerium` sync in ArgoCD:
   ```bash
   direnv exec . rtk kubectl get applications -n argocd
   direnv exec . kubectl get pods -n auth -n mail-proxy -n pomerium
   ```
2. Verify PocketID generates its OIDC client credentials secret (`pocketid-oidc-credentials`).
3. Verify Pomerium ingress controller starts up cleanly (it will not bind to the production VIP until Phase 4).

---

### Step 2: Phase 3 — Live Cluster Freeze & Backup (Maintenance Window Starts)

> [!WARNING]
> Downtime begins here. Proceed only during the approved maintenance window.

1. Scale workloads to `0` on the old live cluster (`192.168.5.11-13`):
   ```bash
   # Switch kubeconfig context if necessary to live cluster
   kubectl scale deployment --all -n <namespace> --replicas=0
   ```
2. Confirm all Longhorn volume backups are synced to NFS (`/mnt/pool/backups/longhorn`).
3. Confirm CloudNativePG database backups are synced to Backblaze B2 (`s3://jdray-backup/cnpg`).
4. Gracefully shut down the old 3 nodes:
   ```bash
   direnv exec . rtk talosctl -n 192.168.5.11,192.168.5.12,192.168.5.13 shutdown --force
   ```

---

### Step 3: Phase 4 — Enable IP Pools & Restore Workloads

1. Enable Cilium IP pools in `kubernetes/charts/core-services/cilium/values.yaml`:
   ```yaml
   ipPools:
     enabled: true
   ```
2. Re-enable DNS services by moving `dns.yaml`:
   ```bash
   git mv kubernetes/root-app/disabled-core-services/dns.yaml kubernetes/root-app/templates/core-services/dns.yaml
   git commit -m "feat(deploy): activate IP pools and re-enable core DNS"
   git push origin cilium
   ```
3. Verify Pomerium (`192.168.5.4`) and PiHole (`192.168.5.53`) claim their IPs via Cilium L2 announcements:
   ```bash
   direnv exec . rtk kubectl get svc -A -l io.cilium/lb-ipam-ips
   ```
4. Restore application manifests one by one (moving from `kubernetes/root-app/disabled-apps/` to `kubernetes/root-app/templates/apps/`):
   - `cnpg` databases (Postgres)
   - `audiobookshelf`
   - `immich`
   - `kavita`
   - `plex`
   - `downloads`
   - `home-automation`
   - `syncthing`

---

### Step 4: Phase 5 — Hardware Reclaim (One Node at a Time)

1. Power on **Node 3** (`192.168.5.13`).
2. Reset node with partition wipe flags:
   ```bash
   direnv exec . rtk talosctl -n 192.168.5.13 reset --reboot --graceful=false --system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL
   ```
3. Apply updated Talos config from `clusterconfig/home-cluster-controlplane.yaml` to `192.168.5.13` and join.
4. Verify dual status:
   ```bash
   direnv exec . rtk talosctl -n 192.168.5.13 get machinestatus
   direnv exec . rtk kubectl get nodes -o wide
   ```
5. Verify Longhorn recognizes the node disk and volume replication begins.
6. Repeat sequentially for **Node 2** (`192.168.5.12`) and **Node 1** (`192.168.5.11`).

---

### Step 5: Phase 6 — Decommission Temp Node & Merge to Main

1. Update `talos/talconfig.yaml` to assign VIP `192.168.5.20` across the 3 physical control plane nodes.
2. Drain and delete the temporary staging VM (`192.168.5.177`).
3. Update `targetRevision` in `kubernetes/root-app/templates/` from `cilium` back to `main`.
4. Merge `cilium` branch into `main` and verify clean sync.

---

## 6. Critical Reference Files

- [CILIUM_MIGRATION.md](file:///Users/justindray/src/home-cluster/docs/CILIUM_MIGRATION.md): Detailed migration tracker and checklist.
- [talconfig.yaml](file:///Users/justindray/src/home-cluster/talos/talconfig.yaml): Talos node and cluster configuration.
- [cilium values.yaml](file:///Users/justindray/src/home-cluster/kubernetes/charts/core-services/cilium/values.yaml): Cilium CNI configuration.
- [multus chart](file:///Users/justindray/src/home-cluster/kubernetes/charts/core-services/multus/): Multus CNI daemonset and CRDs.
- [global-values.yaml](file:///Users/justindray/src/home-cluster/kubernetes/global-values.yaml): Cluster-wide IP and domain values.
