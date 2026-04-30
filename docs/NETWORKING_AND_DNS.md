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

| IP Range            | Purpose                    | Configuration             | Notes                              |
| ------------------- | -------------------------- | ------------------------- | ---------------------------------- |
| `192.168.5.1`       | Router/Gateway             | `network.routerIp`        | Default gateway                    |
| `192.168.5.2`       | Wifi AP                    |                           | Network infrastructure             |
| `192.168.5.3`       | Public Ingress (Legacy)    | `network.publicIngress`   | Traefik Public IP                  |
| `192.168.5.4`       | Pomerium Ingress           | `network.pomeriumIngress` | Central IAP and Ingress Controller |
| `192.168.5.5`       | NAS                        | `network.storageServer`   | Network file storage server        |
| `192.168.5.6`       | Zigbee/thread co-ordinator |                           | Network Infrastructure             |
| `192.168.5.20`      | Talos VIP                  | `network.cluster`         | Kubernetes API server endpoint     |
| `192.168.5.11-20`   | Talos Nodes                | `talconfig.yaml`          | Reserved for control plane nodes   |
| `192.168.5.80-100`  | MetalLB Pool               | `network.metallbRange`    | Load balancer IP allocation        |
| `192.168.5.100-254` | DHCP Pool                  | Router configuration      | Dynamic client allocation          |

### Static Reservations

- **`.1`**: Router
- **`.4`**: Pomerium (Primary Ingress)
- **`.5`**: NAS
- **`.10-.20`**: Talos cluster nodes (VIP + individual nodes)
- **`.80-.100`**: MetalLB dynamic IP pool for services

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

The cluster has migrated to a **Unified Ingress Class** using Pomerium.

### Pomerium Ingress

- **IP**: `192.168.5.4`
- **ingressClassName**: `pomerium`
- **TLS**: Wildcard certificate (replicated from `cert-manager`).
- **Policy**: Identity-Aware access control using OIDC (PocketID).

### Standard Configuration Pattern

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    # Required for Cloudflare Sync
    dns.external/enabled: "true"
    dns.external/target: home.{{ .Values.domain }}
    # Authentication
    ingress.pomerium.io/allow_any_authenticated_user: "true"
spec:
  ingressClassName: pomerium
  rules:
    - host: my-app.{{ .Values.domain }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port: { number: 80 }
```

## MetalLB Configuration

MetalLB provides LoadBalancer services:

- **Pool: `pomerium-ingress`**: `192.168.5.4` (Dedicated IP for IAP).
- **Pool: `default`**: `192.168.5.80-100` (Dynamic assignment).

## Certificate Management

### Automatic TLS with cert-manager

- **Wildcard Certificate**: Managed in `cert-manager` namespace.
- **Secret Reflection**: The `default-tls` secret is reflected to the `pomerium` namespace using Emberstack Reflector.
- **Pomerium Integration**: The `Pomerium` global resource is configured to use the reflected `default-tls` secret for all routes.

## Network Security

### Hairpin Protection

Access from the router IP (`192.168.5.1`) is typically denied in Pomerium policies to prevent routing loops and ensure services remain private when accessed via external paths that traverse the gateway.

## Tailscale

MagicDNS is configured via Split DNS to forward `*.dray.id.au` requests to the Pi-hole service. This ensures Tailscale clients resolve services to the internal Pomerium IP.
