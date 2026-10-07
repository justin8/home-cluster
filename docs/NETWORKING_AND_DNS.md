# Networking and DNS Architecture

## Network Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                Internet                                         │
└─────────────────────────┬───────────────────────────────────────────────────────┘
                          │
                          │ External IP (Dynamic DNS: home.dray.id.au)
                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Home Router/Firewall                                         │
│                        192.168.5.1                                              │
└─────────────────────────┬───────────────────────────────────────────────────────┘
                          │
                          │ 192.168.5.x Network
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
┌─────────────────┐               ┌──────────────────────────────────────────────────┐
│  NAS / Storage  │               │              Kubernetes Cluster                  │
│  192.168.5.5    │               │              (API VIP: 192.168.5.20)             │
│  (Tailscale:    │               │            (Nodes: 192.168.5.11 - .13)           │
│  100.92.202.28) │               │                                                  │
│                 │◄──Tailscale───│  ┌─────────────────────────────────────────────┐ │
│ • File Storage  │  (NFS only)   │  │             Cilium CNI (eBPF)               │ │
│ • NFS Shares    │               │  │  • Kube-Proxy Replacement                   │ │
│ • Longhorn      │               │  │  • L2 Announcements (ARP/NDP)              │ │
│   Backups       │               │  │  • IPAM Pools: 192.168.5.80-100             │ │
└─────────────────┘               │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │                Multus CNI                   │ │
                                  │  │  • Meta-CNI plugin (cni.exclusive: false)   │ │
                                  │  │  • Secondary network interface attachment   │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │           Pomerium Ingress (IAP)            │ │
                                  │  │      LAN: 192.168.5.4 | Tailnet: .223.17    │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │                  DNS Server                 │ │
                                  │  │        PiHole: 192.168.5.53 & Tailscale     │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │                Applications                 │ │
                                  │  │  • Pods (10.244.0.0/16)                     │ │
                                  │  │  • Services (10.96.0.0/12)                  │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  └──────────────────────────────────────────────────┘
```

## IP Address Allocation

| IP Range / Target   | Purpose                     | Configuration Source      | Notes                                     |
| ------------------- | --------------------------- | ------------------------- | ----------------------------------------- |
| `192.168.5.1`       | Router / Gateway            | Router                    | Default gateway                           |
| `192.168.5.4`       | Pomerium Ingress (LAN)      | `network.pomeriumIngress` | Central IAP / Ingress controller VIP      |
| `192.168.5.5`       | Storage Server (LAN)        | Host network              | Network file storage server               |
| `192.168.5.6`       | Zigbee Coordinator (LAN)    | Hardware device           | Network coordinator (ESP32, port 7638)    |
| `192.168.5.7`       | Apple TV (LAN)              | DHCP / Static             | Living Room Apple TV                      |
| `192.168.5.8`       | Home Assistant (Multus LAN) | Multus NAD `lan`          | Secondary macvlan interface on `eth0`     |
| `192.168.5.20`      | Talos Control Plane VIP     | `talos/talconfig.yaml`    | Shared API VIP on `eth0` via KubePrism    |
| `192.168.5.11`      | Node: `talos-gcf-e16`       | `talos/talconfig.yaml`    | Bare-metal controlplane / worker node 1   |
| `192.168.5.12`      | Node: `talos-12k-2sd`       | `talos/talconfig.yaml`    | Bare-metal controlplane / worker node 2   |
| `192.168.5.13`      | Node: `talos-38m-ewh`       | `talos/talconfig.yaml`    | Bare-metal controlplane / worker node 3   |
| `192.168.5.53`      | PiHole DNS Service          | `network.dnsServer`       | PiHole DNS service (Cilium LB pool)       |
| `192.168.5.80-100`  | Cilium LoadBalancer IP Pool | `network.ciliumRange`     | Dynamic service IP allocation range       |
| `192.168.5.100-254` | DHCP Range                  | Router configuration      | Dynamic LAN client allocation             |
| `100.99.223.17`     | Pomerium Private Ingress    | `network.privateIngress`  | Tailscale proxy VIP for authenticated IAP |
| `100.92.202.28`     | NFS Storage Server          | `network.storageServer`   | Tailscale IP for media NFS storage        |
| `10.244.0.0/16`     | Cluster Pod CIDR            | `clusterPodNets`          | Overlay network managed by Cilium         |
| `10.96.0.0/12`      | Cluster Service CIDR        | `clusterSvcNets`          | Kubernetes Service virtual IPs            |

---

## Cilium CNI Architecture

The cluster uses **Cilium** as its sole primary CNI and eBPF dataplane, fully replacing `kube-proxy` and `metallb`.

### 1. eBPF Kube-Proxy Replacement

- Talos is configured with `KubeProxyConfig.enabled: false`.
- Cilium operates with `kubeProxyReplacement: true`, handling all Kubernetes Service load-balancing and routing directly inside the Linux kernel via eBPF programs attached to host network interfaces and cgroups.
- Communication between in-cluster components and the Kubernetes API server uses **KubePrism** (`127.0.0.1:7445`), avoiding circular dependencies before the Cilium daemon is fully initialized.

### 2. Cilium L2 Announcements (MetalLB Replacement)

Layer 2 address resolution (ARP for IPv4) for LoadBalancer Services is managed entirely by Cilium:

- Configured via `CiliumL2AnnouncementPolicy`:
  ```yaml
  apiVersion: cilium.io/v2alpha1
  kind: CiliumL2AnnouncementPolicy
  metadata:
    name: default-l2-policy
  spec:
    interfaces:
      - ^eth[0-9]+
      - ^en[a-z0-9]+
    loadBalancerIPs: true
  ```
- Dedicated and dynamic pools configured via `CiliumLoadBalancerIPPool`:
  - `pomerium-ingress`: `192.168.5.4/32`
  - `dns-server`: `192.168.5.53/32`
  - `default-pool`: `192.168.5.80` - `192.168.5.100`

### 3. Tailscale Compatibility (`socketLB.hostNamespaceOnly`)

- When Cilium attaches socket-level load-balancing eBPF programs across all host cgroups, it can intercept and rewrite Tailscale's encapsulated Wireguard packets between nodes.
- To prevent node-to-node routing lockups across the Tailnet, Cilium is configured with:
  ```yaml
  socketLB:
    hostNamespaceOnly: true
  ```
- This ensures only host-network processes and standard pod sockets are intercepted, allowing the Tailscale system extension daemon on Talos to route traffic unhindered.

---

## Zero-Trust Network Policies (CiliumNetworkPolicy)

The cluster enforces a strict **Zero-Trust Default-Deny** model across all applications and core services using Cilium eBPF network policies.

### 1. Architecture & Policy Standards

- **Explicit YAML in Each Chart:** All policies are defined as explicit `CiliumNetworkPolicy` resources located at `<chart>/templates/networkpolicy.yaml`. No opaque helper macros are used.
- **Cluster-Wide Baselines (`CiliumClusterwideNetworkPolicy`):** Universal baselines are deployed once in `core-services/cilium/templates/baseline-policies.yaml`:
  - `default-allow-coredns`: Allows UDP/TCP egress on port 53 to `kube-dns` in `kube-system` for all pods (`enableDefaultDeny: { egress: false }`).
  - `default-allow-host-probes`: Allows ingress from entity `host` (Kubelet readiness and liveness probes) for all pods (`enableDefaultDeny: { ingress: false }`).
- **Default-Deny Posture:** Any workload targeted by a `CiliumNetworkPolicy` automatically operates in default-deny for both ingress and egress. Only explicitly declared paths are permitted.

### 2. Multi-Tier Workload & Storage Rules

- **Pomerium Ingress Translation:** Policies grant ingress from `app.kubernetes.io/name: pomerium` in namespace `pomerium` to the application's actual listening container port (e.g. 8123 for Home Assistant, 2283 for Immich, 32400 for Plex).
- **NFS Volumes:** In-tree NFS volumes (`100.92.202.28:/mnt/pool/media`) and Longhorn volumes are mounted at the Talos host kernel / Kubelet level. Pod-level network policies do not intercept host NFS traffic and do not require egress rules on port 2049.
- **CloudNativePG Databases:** CNPG cluster pods require:
  - Port `5432`: Postgres client traffic and replication.
  - Port `8000`: Patroni / instance manager status and peer synchronization.
  - Port `443` (FQDN `s3.us-west-001.backblazeb2.com`): Nightly WAL archiving and backups to Backblaze B2.
  - Ports `6443` and `443` (entities `kube-apiserver`, `host`, `remote-node`): Instance manager Kubernetes API server communication for leader lease acquisition and cluster CR watches.
- **Metrics Scraping Policy:** Prometheus exporter ports (e.g., 9090, 9187) remain closed until a dedicated Prometheus monitoring stack is introduced with restricted pod selectors.

### 3. Monitoring & Diagnostics via Hubble

Real-time traffic flows and policy verdicts are observed via the Hubble CLI:

```bash
# Check dropped flows in a specific namespace
direnv exec . rtk kubectl -n kube-system exec ds/cilium -c cilium-agent -- \
  hubble observe --namespace <namespace> --verdict DROPPED --last 20

# Observe cluster-wide dropped packets
direnv exec . rtk kubectl -n kube-system exec ds/cilium -c cilium-agent -- \
  hubble observe --verdict DROPPED --last 50
```

---

## Multus CNI Architecture

**Multus CNI** is deployed alongside Cilium as a meta-CNI plugin.

### Coexistence with Cilium

- Standard Kubernetes setups run Cilium exclusively. To allow Multus to insert secondary network interfaces into pods, Cilium is configured with:
  ```yaml
  cni:
    exclusive: false
  ```
- Multus runs as a thin daemonset (`kube-multus-ds`) on all nodes, watching `/etc/cni/net.d/`.
- The default network for all pods remains **Cilium** (`eth0`, `10.244.0.0/16`).
- Applications requiring direct L2 LAN access, custom VLANs, or secondary routing interfaces use Kubernetes `NetworkAttachmentDefinition` CRDs to attach additional network interfaces (e.g. `net1`).

---

## DNS Architecture

The cluster uses a split-horizon DNS setup powered by two **ExternalDNS** instances.

### 1. PiHole (Internal DNS)

- **IP**: `192.168.5.53` (also enrolled in Tailscale)
- **Controller**: `external-dns-pihole`
- **Annotation Prefix**: `dns.internal/`
- **Behavior**: Automatically synchronizes all Ingress resources with `ingressClassName: pomerium`.
- **Resolution**: Resolves private services to the Pomerium Tailnet IP (`100.99.223.17`), and public services to the LAN Pomerium IP (`192.168.5.4`).

### 2. Cloudflare (Public DNS)

- **Controller**: `external-dns-cloudflare`
- **Annotation Prefix**: `dns.external/`
- **Annotation Filter**: `dns.external/enabled=true`
- **Behavior**: Only synchronizes Ingress resources explicitly tagged with `dns.external/enabled: "true"`.
- **Target**: Public DDNS hostname (`home.dray.id.au`).

---

## Ingress Architecture (Pomerium)

The cluster uses a **Unified Ingress Class** via **Pomerium** as the sole ingress controller and Identity-Aware Proxy (IAP).

### Standard Configuration Pattern

Always use the `common.pomeriumIngress` template from the common library chart:

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

- **`type: private` (Default):** Directs internal DNS to the Tailscale ingress IP (`network.privateIngress: 100.99.223.17`) and adds an IP deny rule blocking all non-Tailscale / non-pod traffic.
- **`type: public`:** Points internal DNS to `network.pomeriumIngress: 192.168.5.4`, enables Cloudflare DNS (`dns.external/enabled: "true"`), and removes the IP deny rule.
- **`allowedUsers`:**
  - `authed` (Default) — Any authenticated user via PocketID (`authenticated_user: true`).
  - `all` — Unauthenticated public access (`accept: true`).
  - `private` — Users belonging to `userGroups.private`.
  - `admin` — Users belonging to `userGroups.admin`.

---

## Tailscale Integration

1. **Talos Extension:** Each Talos node runs the `siderolabs/tailscale` extension service, authenticated via `TS_AUTHKEY` in `talconfig.yaml` with `--accept-routes=false --advertise-tags=tag:core-network`.
2. **MagicDNS:** Talos nodes use `100.100.100.100` as primary DNS resolver, allowing nodes to resolve storage hosts (such as `storage.chimera-exponential.ts.net`) directly over the tailnet.
3. **Pomerium Tailscale Proxy:** Pomerium exposes an internal proxy endpoint (`100.99.223.17`) directly on the Tailnet for authenticated remote access.
