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
│  NAS            │               │              Kubernetes Cluster                  │
│  192.168.5.5    │               │              (API: 192.168.5.20)                 │
│  (Tailscale)    │               │            (Nodes: 192.168.5.11-20)              │
│                 │               │                                                  │
│ • File Storage  │◄──Tailscale───│  ┌─────────────────────────────────────────────┐ │
│ • NFS Shares    │  (NFS only)   │  │                    MetalLB                  │ │
│ • Longhorn      │               │  │              IP Pool: 192.168.5.80-100      │ │
│   Backups       │               │  │                                             │ │
└─────────────────┘               │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │           Pomerium Ingress (IAP)            │ │
                                  │  │                192.168.5.4                  │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │                  DNS Server                 │ │
                                  │  │       192.168.5.53 and over Tailscale       │ │
                                  │  │                    PiHole                   │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │             Tailscale Exit Node             │ │
                                  │  │        (LAN access for tailnet devices)     │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │                Applications & Workloads     │ │
                                  │  │  • Pods        • Services    • Deployments  │ │
                                  │  │  • ConfigMaps  • Secrets     • StatefulSets │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  └──────────────────────────────────────────────────┘
```

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
| `192.168.5.80-100`  | MetalLB Pool               | `network.metallbRange`    | Load balancer IP allocation             |
| `192.168.5.100-254` | DHCP Pool                  | Router configuration      | Dynamic client allocation               |

## Traffic Flow

### Unified Traffic Path (Internet/Internal → Pomerium)

1. **Traffic** hits Pomerium (`192.168.5.4`).
2. **Pomerium** evaluates OIDC identity and policies.
3. **Authorized Traffic** is proxied to Application Pods.

- **Cloudflare DDNS** updates `home.dray.id.au` with the current WAN IP.
- **External DNS** instances manage split-horizon resolution (see below).

## DNS Architecture

The cluster uses a split-horizon DNS setup powered by two **ExternalDNS** instances.

### Multi-tier DNS System

#### PiHole (Internal DNS)

- **IP**: `192.168.5.53` (also enrolled in Tailscale)
- **Purpose**: DNS for internal clients and Tailscale clients.
- **Controller**: `external-dns-pihole`.
- **Annotation Prefix**: `dns.internal/`.
- **Logic**: Automatically syncs **all** Ingress resources with `ingressClassName: pomerium`.
- **Resolution**: Points services to the internal Pomerium IP (`192.168.5.4`).

#### Cloudflare (Public DNS)

- **Purpose**: External DNS for internet access.
- **Controller**: `external-dns-cloudflare`.
- **Annotation Prefix**: `dns.external/`.
- **Annotation Filter**: `dns.external/enabled=true`.
- **Logic**: Only syncs Ingress resources explicitly tagged with `dns.external/enabled: "true"`.
- **Resolution**: Uses the target specified in `dns.external/target` (typically `home.dray.id.au`).

## Ingress Strategy

The cluster uses a **Unified Ingress Class** via Pomerium as the sole ingress controller and Identity-Aware Proxy.

### Pomerium Ingress

- **IP**: `192.168.5.4`
- **ingressClassName**: `pomerium`
- **TLS**: Wildcard certificate (replicated from `cert-manager`).
- **Policy**: Identity-Aware access control using OIDC (PocketID).

### Standard Configuration Pattern

Always use the `common.pomeriumIngress` template from the common chart:

```yaml
{{ include "common.pomeriumIngress" (dict
  "ctx" .
  "name" "my-app"
  "port" 80
  "type" "private"       # private (default) or public
  "allowedUsers" "authed" # authed (default), all, private, admin
  "responseHeaders" (dict "X-Custom-Header" "value") # optional
) }}
```

- `type: private` — denies traffic not from LAN or Tailscale ranges.
- `type: public` — enables Cloudflare DNS (`dns.external/enabled: "true"`) and removes the deny rule.
- `allowedUsers: authed` — any authenticated user; `all` — unauthenticated; `private`/`admin` — specific user groups from `userGroups` in global values.

## MetalLB Configuration

MetalLB provides LoadBalancer services:

- **Pool: `pomerium-ingress`**: `192.168.5.4` (Dedicated IP for IAP).
- **Pool: `dns-server`**: `192.168.5.53` (PiHole).
- **Pool: `default`**: `192.168.5.80-100` (Dynamic assignment).

## Certificate Management

### Automatic TLS with cert-manager

- **Wildcard Certificate**: Managed in `cert-manager` namespace.
- **Secret Reflection**: The `default-tls` secret is reflected to the `pomerium` namespace using Emberstack Reflector.
- **Pomerium Integration**: The `Pomerium` global resource is configured to use the reflected `default-tls` secret for all routes.

## Network Security

Private ingresses deny traffic not originating from the LAN (`network.lanIpRange`) or Tailscale (`network.tailscaleIpRange`) ranges, preventing access via the public internet path.

## Tailscale

MagicDNS is configured via Split DNS to forward `*.dray.id.au` requests to the Pi-hole service. This ensures Tailscale clients resolve services to the internal Pomerium IP.

Talos nodes are configured to use `100.100.100.100` as their first DNS resolver. This is Tailscale's built-in "MagicDNS" resolver, which automatically resolves hostnames of other devices and services on the tailnet. Falling back to PiHole (`192.168.5.53`) handles all other internal and external resolution.
