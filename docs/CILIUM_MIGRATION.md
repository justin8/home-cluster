# Cilium Blue/Green Migration Plan & Tracker

This document tracks the step-by-step blue/green migration of the home cluster from Flannel + Kube-Proxy + MetalLB to **Cilium** (eBPF CNI, Kube-Proxy replacement, and native L2 Announcements).

---

## Strategy: Zero-Impact Staging & Fast Cutover

To minimize downtime and eliminate network risk:

1. **Initial Staging (Zero Impact to Live Cluster):**
   - A new test cluster is provisioned on temporary node(s) with Cilium, KubePrism, and ArgoCD.
   - **No reserved IP pools are created initially** (`ipPools.enabled: false`).
   - The live production cluster remains 100% online, serving all applications, Pomerium ingress (`192.168.5.4`), and PiHole DNS (`192.168.5.53`).
2. **Verification on Temp Cluster:**
   - We verify that Talos, Cilium eBPF routing, KubePrism, ArgoCD, Longhorn, Cert-Manager, and Hubble operate correctly.
3. **Live Cluster Freeze & Shutdown (Downtime Starts Here):**
   - Workloads are scaled to `0` on the live cluster (clean unmount).
   - Longhorn volume backups (NFS) and CNPG database backups (S3) are verified.
   - The old 3 nodes are gracefully shut down (`talosctl shutdown`).
4. **IP Pool Activation & Workload Restoration:**
   - On the new cluster, IP pools are enabled (`ipPools.enabled: true`), claiming `192.168.5.4` and `192.168.5.53` via Cilium L2 announcements.
   - Applications are re-enabled and restored from backups one by one.
5. **Hardware Reclaiming:**
   - Physical nodes are booted, wiped, and joined to the new cluster.
   - Temp node is decommissioned and `cilium` branch is merged to `main`.

---

## IP Address Allocation

| IP Range            | Purpose                    | Configuration             | Notes                                   |
| ------------------- | -------------------------- | ------------------------- | --------------------------------------- |
| `192.168.5.1`       | Router/Gateway             |                           | Default gateway                         |
| `192.168.5.2`       | Wifi AP                    |                           | Network infrastructure                  |
| `192.168.5.4`       | Pomerium Ingress           | `network.pomeriumIngress` | Central IAP and Ingress Controller      |
| `192.168.5.5`       | NAS                        | `network.storageServer`   | Network file storage server             |
| `192.168.5.6`       | Zigbee/thread co-ordinator |                           | Network Infrastructure                  |
| `192.168.5.20`      | Talos VIP                  | `network.cluster`         | Kubernetes API server endpoint          |
| `192.168.5.11-19`   | Talos Nodes                | `talconfig.yaml`          | Reserved for control plane nodes        |
| `192.168.5.53`      | DNS Server                 | `network.dnsServer`       | PiHole DNS service (Tailscale enrolled) |
| `192.168.5.80-100`  | Cilium IP Pool             | `network.metallbRange`    | Load balancer IP allocation             |
| `192.168.5.100-254` | DHCP Pool                  | Router configuration      | Dynamic client allocation               |

---

## Migration Progress & Action Checklist

### Phase 1: Repository & Manifest Setup (`cilium` branch)

- [x] Create and switch to `cilium` git branch.
- [x] Create Cilium Helm chart (`kubernetes/charts/core-services/cilium/`):
  - [x] Configure `kubeProxyReplacement: true`.
  - [x] Configure KubePrism target (`k8sServiceHost: localhost`, `k8sServicePort: 7445`).
  - [x] Configure Talos mount capabilities (`cgroup.autoMount.enabled: false`, drop `SYS_MODULE`).
  - [x] Configure `l2announcements.enabled: true` and Hubble UI/Relay.
  - [x] Add `ipPools.enabled: false` toggle to prevent IP announcement collisions during staging.
- [x] Create Cilium IP Pool & L2 Announcement template with conditional toggle.
- [x] Remove deprecated MetalLB chart and manifests (`kubernetes/charts/core-services/metallb/`).
- [x] Disable all applications in root-app (moved to `kubernetes/root-app/disabled-apps/` for staged re-enabling).
- [x] Update Pomerium and PiHole service annotations to use Cilium IPAM.
- [x] Update `scripts/bootstrap-cluster` to bootstrap Cilium CNI and wait for Node Readiness prior to installing ArgoCD.
- [x] Add Cilium to ArgoCD root app (`kubernetes/root-app/templates/core-services/cilium.yaml`) with sync-wave `-5`.
- [x] Update `targetRevision` in `root-app/templates/` to track `cilium` branch.
- [x] Generate new isolated cluster keys in `talos/talsecret.sops.yaml`.
- [x] Update `talos/talconfig.yaml` to desired state with `cni.name: none`, `proxy.disabled: true`, and `kubePrism.enabled: true`.

---

### Phase 2: Bootstrap & Validate Staging Cluster (Live Cluster Remains 100% Online)

#### Phase 2.1: Minimal Baseline (Cilium + ArgoCD + Test Container)

- [x] Apply Talos config to staging VM (`192.168.5.177`) with VIP `192.168.5.19`.
- [x] Run `talosctl bootstrap` and fetch staging `kubeconfig`.
- [x] Run `bootstrap-cluster` (bootstraps Cilium CNI without IP pools, waits for node Ready, then installs ArgoCD & Root App).
- [x] Verify Cilium DaemonSet, Operator, Hubble Relay, and Hubble UI are healthy.
- [ ] Spin up a test container on the staging cluster:
  - [ ] Verify pod-to-pod networking and CoreDNS lookup.
  - [ ] Verify internet egress via Cilium eBPF NAT.
  - [ ] Verify local API server access via KubePrism (`127.0.0.1:7445`).

#### Phase 2.2: Incremental Core Services Bring-Up (Deployment Wave Order)

- [ ] **Wave -4 (Secrets & Drivers):**
  - [ ] Re-enable `shared-secrets` (`kubernetes/root-app/disabled-core-services/shared-secrets.yaml` -> `templates/core-services/`).
  - [ ] Re-enable `nfd`, `nfs-csi`, `vpa`.
  - [ ] Verify Sealed Secrets controller unseals master keys and CSI NFS controller/node pods are healthy.
- [ ] **Wave -3 (Certificates):**
  - [ ] Re-enable `cert-manager`.
  - [ ] Verify cert-manager controller, webhook, and cainjector are healthy.
- [ ] **Wave -2 (Storage & Databases):**
  - [ ] Re-enable `longhorn`, `cnpg-operator`, `intel-gpu`.
  - [ ] Verify Longhorn manager, instance manager, CSI driver, and CNPG operator are healthy.
- [ ] **Wave -1 (Network Operator):**
  - [ ] Re-enable `tailscale-operator`.
  - [ ] Verify Tailscale operator pod starts and authenticates cleanly.
- [ ] **Wave 0 (Auth, Proxy & Ingress Controller):**
  - [ ] Re-enable `auth` (PocketID).
  - [ ] Re-enable `mail-proxy`.
  - [ ] Re-enable `pomerium`.
  - [ ] Verify PocketID generates OIDC client credentials and Pomerium starts cleanly.
- [ ] Confirm live production cluster has experienced zero disruption throughout staging validation.

---

### Phase 3: Live Cluster Freeze & Backup (Maintenance Window Starts)

- [ ] Scale all application deployments to `0` on the old cluster:
  ```bash
  direnv exec . rtk kubectl -n <namespace> scale deployment/<app> --replicas=0
  ```
- [ ] Trigger & verify Longhorn volume backups to NFS backup target (`/mnt/pool/apps` or `/mnt/pool/media`).
- [ ] Verify CloudNativePG database backups are synced to S3 (`s3://jdray-backup/cnpg`).
- [ ] Gracefully shut down all 3 nodes on the old cluster:
  ```bash
  direnv exec . rtk talosctl -n 192.168.5.11,192.168.5.12,192.168.5.13 shutdown --force
  ```

---

### Phase 4: Enable IP Pools & Restore Workloads

- [ ] Set `ipPools.enabled: true` in `kubernetes/charts/core-services/cilium/values.yaml`.
- [ ] Commit and sync Cilium application via ArgoCD to deploy `CiliumLoadBalancerIPPool` resources.
- [ ] Verify Pomerium (`192.168.5.4`) and PiHole (`192.168.5.53`) claim their production IPs via Cilium L2 announcements.
- [ ] Re-enable core DNS services (`kubernetes/root-app/disabled-core-services/dns.yaml` -> `templates/core-services/`).
- [ ] Re-enable and restore applications one by one (move from `kubernetes/root-app/disabled-apps/` to `templates/apps/`):
  - [ ] **CloudNativePG (Postgres)**: Restore DB clusters from S3.
  - [ ] **Audiobookshelf**: Restore Longhorn volume & verify.
  - [ ] **Immich**: Restore Longhorn volumes, verify DB & web UI.
  - [ ] **Kavita**: Restore Longhorn volume & verify.
  - [ ] **Plex**: Restore Longhorn volume & verify NFS mounts.
  - [ ] **Downloads Stack**: Restore config volumes & verify.
  - [ ] **Home Automation**: Restore config volume & verify MQTT/Zigbee.
  - [ ] **Syncthing**: Restore config volume & verify sync.
- [ ] Verify internal DNS (`192.168.5.53`), Pomerium IAP (`192.168.5.4`), and Tailscale connectivity.

---

### Phase 5: Hardware Reclaim (One Node at a Time)

_Power on each physical node, wipe partitions, and join to the new cluster. Longhorn automatically replicates volume data._

- [ ] **Migrate Node 3 (`192.168.5.13`)**:
  - [ ] Power on Node 3.
  - [ ] Reset & wipe STATE/EPHEMERAL:
    ```bash
    talosctl -n 192.168.5.13 reset --reboot --graceful=false --system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL
    ```
  - [ ] Apply new cluster config to Node 3 and join.
  - [ ] Verify Talos status (`READY: true`) and Kubernetes status (`Ready`).
  - [ ] Verify Longhorn recognizes disk and volume replication starts.
- [ ] **Migrate Node 2 (`192.168.5.12`)**:
  - [ ] Power on, wipe, apply new config, and join.
  - [ ] Wait for Longhorn volume replication to synchronize.
- [ ] **Migrate Node 1 (`192.168.5.11`)**:
  - [ ] Power on, wipe, apply new config, and join.
  - [ ] Wait for Longhorn volume replication to reach 100% healthy (3 replicas).

---

### Phase 6: Decommission Temp Node & Mainline Merge

- [ ] Configure VIP `192.168.5.20` on the 3 production nodes.
- [ ] Drain and remove the temporary bootstrap node:
  ```bash
  kubectl drain <temp-node> --ignore-daemonsets --delete-emptydir-data --force
  kubectl delete node <temp-node>
  ```
- [ ] Verify 3-node etcd cluster health:
  ```bash
  talosctl -n 192.168.5.11 etcd members
  ```
- [ ] Update `targetRevision` in `root-app/templates/` from `cilium` back to `main`.
- [ ] Update `docs/NETWORKING_AND_DNS.md` and `docs/TALOS.md` with Cilium and KubePrism details.
- [ ] Merge `cilium` branch into `main`.
- [ ] Verify ArgoCD on new cluster syncs cleanly from `main`.
