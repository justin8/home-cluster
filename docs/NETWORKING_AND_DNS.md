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
│  NFS Storage    │               │              Kubernetes Cluster                  │
│  192.168.5.5    │               │              (API: 192.168.5.20)                 │
│                 │               │            (Nodes: 192.168.5.11-20)              │
│                 │               │                                                  │
│ • File Storage  │◄──────────────│  ┌─────────────────────────────────────────────┐ │
│ • NFS Shares    │               │  │                    MetalLB                  │ │
│ • Longhorn      │               │  │              IP Pool: 192.168.5.80-100      │ │
│   Backups       │               │  │                                             │ │
└─────────────────┘               │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────┐ ┌─────────────────────┐ │
                                  │  │ Private Ingress     │ │ Public Ingress      │ │
                                  │  │  192.168.5.3        │ │  192.168.5.2        │ │
                                  │  │                     │ │                     │ │
                                  │  │    Traefik          │ │    Traefik          │ │
                                  │  │    (Private)        │ │    (Public)         │ │
                                  │  └─────────────────────┘ └─────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │                  DNS Server                 │ │
                                  │  │                 192.168.5.53                │ │
                                  │  │                                             │ │
                                  │  │            PiHole Primary + Secondary       │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │                Applications & Workloads     │ │
                                  │  │                                             │ │
                                  │  │  • Pods        • Services    • Deployments  │ │
                                  │  │  • ConfigMaps  • Secrets     • StatefulSets │ │
                                  │  └─────────────────────────────────────────────┘ │
                                  └──────────────────────────────────────────────────┘
```

## IP Address Allocation

| IP Range            | Purpose                    | Configuration            | Notes                            |
| ------------------- | -------------------------- | ------------------------ | -------------------------------- |
| `192.168.5.1`       | Router/Gateway             | Network infrastructure   | Default gateway                  |
| `192.168.5.2`       | Public Ingress             | `network.publicIngress`  | External-facing web traffic      |
| `192.168.5.3`       | Private Ingress            | `network.privateIngress` | Internal-only web traffic        |
| `192.168.5.4`       | Wifi AP                    |                          | Network infrastructure           |
| `192.168.5.5`       | NFS Storage                | `network.storage`        | Network file storage server      |
| `192.168.5.6`       | Zigbee/thread co-ordinator |                          | Network Infrastructure           |
| `192.168.5.20`      | Talos VIP                  | `network.cluster`        | Kubernetes API server endpoint   |
| `192.168.5.11-20`   | Talos Nodes                | `talconfig.yaml`         | Reserved for control plane nodes |
| `192.168.5.53`      | DNS Server                 | `network.dnsServer`      | PiHole DNS service               |
| `192.168.5.80-100`  | MetalLB Pool               | `network.metallbRange`   | Load balancer IP allocation      |
| `192.168.5.100-254` | DHCP Pool                  | Router configuration     | Dynamic client allocation        |

### Static Reservations

- **`.5`**: NFS storage server
- **`.10-.20`**: Talos cluster nodes (VIP + individual nodes)
- **`.80-.100`**: MetalLB dynamic IP pool for services

## Traffic Flow

### Public Traffic (Internet → Applications)

1. **Internet** → Router (WAN IP)
2. **Router** → Public Ingress (`192.168.5.2`)
3. **Traefik Public** → Application Pods
4. **Cloudflare DDNS** updates `home.dray.id.au` with the current WAN IP.
5. **External DNS (Cloudflare)** manages application CNAME records pointing to `home.dray.id.au`.

### Private Traffic (Internal Network → Applications)

1. **Internal Network** → Private Ingress (`192.168.5.3`)
2. **Traefik Private** → Application Pods
3. **External DNS (PiHole)** manages internal DNS records pointing directly to the private ingress IP.

## DNS Architecture

### Multi-tier DNS System

The cluster uses a split-horizon DNS setup. The ingress controller configuration determines if an ingress is public or private based on the `ingressClassName`.

#### PiHole (Internal DNS)

- **IP**: `192.168.5.53`
- **Purpose**: Primary DNS for internal clients
- **Manages**: Internal resolution for all cluster services
- **Features**: Ad blocking, custom DNS records, internal domain resolution

#### External DNS (Cloudflare)

- **Purpose**: External DNS record management (Cloudflare)
- **Manages**: Public ingress classes for external resolution
- **Targeting**: Public ingresses use the annotation `external-dns.alpha.kubernetes.io/target: home.dray.id.au` to ensure correct external routing.

#### External DNS (PiHole)

- **Purpose**: Internal DNS record management (PiHole)
- **Manages**: Private ingress classes and internal services
- **Features**: Automatic internal DNS record management

### DNS Resolution Flow

**Internal Clients:**

- Use PiHole DNS (`192.168.5.53`) for both public and private domains.
- Private services resolve to `192.168.5.3`.
- Public services resolve to `192.168.5.2` (via internal PiHole records) or the WAN IP (if falling back to upstream).

**External Clients:**

- Use Cloudflare DNS.
- Only public services are resolvable.
- Resolve to the current WAN IP via a CNAME to `home.dray.id.au`.

## Ingress Strategy

### Dual Ingress Classes

#### Public Ingress

- **IP**: `192.168.5.2`
- **ingressClassName**: `traefik-public`
- **Purpose**: Internet-accessible services
- **DNS**: Managed by Cloudflare External DNS (CNAME to `home.dray.id.au`)
- **TLS**: Wildcard certificate (`default-tls` secret)
- **Access**: Available from both internal and external networks

#### Private Ingress

- **IP**: `192.168.5.3`
- **ingressClassName**: `traefik-private`
- **Purpose**: Internal-only services
- **DNS**: Managed by PiHole External DNS
- **TLS**: Wildcard certificate (`default-tls` secret)
- **Access**: Only available from internal network

### Ingress Configuration

Applications typically configure both public and private ingresses in their Helm templates:

```yaml
# Example pattern for dual ingress
{{- range list "traefik-public" "traefik-private" }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app{{ if eq . "traefik-public" }}-public{{ end }}
  namespace: {{ $.Release.Namespace }}
  annotations:
    # Public ingress MUST point to the home DDNS record for external DNS to work
    {{- if eq . "traefik-public" }}
    external-dns.alpha.kubernetes.io/target: home.{{ $.Values.domain }}
    {{- end }}
    # Authentication middleware
    traefik.ingress.kubernetes.io/router.middlewares: {{ . }}-tinyauth@kubernetescrd
spec:
  ingressClassName: {{ . }}
  rules:
  - host: my-app.{{ $.Values.domain }}
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app
            port:
              number: 80
  tls:
  - hosts:
    - my-app.{{ $.Values.domain }}
    secretName: default-tls
---
{{- end }}
```

## MetalLB Configuration

MetalLB provides LoadBalancer services for the bare metal cluster:

- **IP Pool**: `192.168.5.80-192.168.5.100` (Pool name: `default`)
- **Mode**: Layer 2 (ARP-based)
- **Ingress IPs**:
  - `public-ingress` pool -> `192.168.5.2`
  - `private-ingress` pool -> `192.168.5.3`

## Certificate Management

### Automatic TLS with cert-manager

- **Provider**: Let's Encrypt
- **Issuer**: `letsencrypt-prod` (ClusterIssuer)
- **DNS Challenge**: Cloudflare DNS-01 challenge
- **Wildcard Certificate**: Managed as a `Certificate` resource in the `cert-manager` namespace.
- **Secret Reflection**: The `default-tls` secret is automatically reflected to other namespaces (like `traefik-public`, `traefik-private`, `argocd`, etc.) using Emberstack Reflector.

## Network Security

### Firewall Rules

The router/firewall is configured to:

- Allow inbound traffic on ports 80/443 to `192.168.5.2` (public ingress).
- Block direct access to other cluster IPs from external networks.
- Cloudflare DDNS ensures the WAN IP is always correct in DNS.

### Network Policies

Kubernetes NetworkPolicies can be used to:

- Isolate application traffic.
- Control inter-pod communication.
- Restrict access to sensitive services.

## Troubleshooting

### Common Network Issues

1. **DNS Resolution Problems**
   - Check PiHole service status and logs.
   - Verify `external-dns-pihole` and `external-dns-cloudflare` logs.
   - Confirm Cloudflare API token permissions in the `cloudflare-api-token` secret.

2. **Ingress Not Accessible**
   - Verify MetalLB speaker pods are running in `metallb-system`.
   - Check Traefik controller status in `traefik-public` and `traefik-private` namespaces.
   - Confirm ingress resource annotations and `ingressClassName`.

3. **Certificate Issues**
   - Check `cert-manager` logs.
   - Verify `wildcard-cert` status: `kubectl get certificate -n cert-manager`.
   - Confirm Reflector is mirroring the `default-tls` secret to the target namespace.

### Diagnostic Commands

```bash
# Check MetalLB status
rtk kubectl get pods -n metallb-system

# Check ingress controllers
rtk kubectl get pods -n traefik-public
rtk kubectl get pods -n traefik-private

# Check DNS services
rtk kubectl get pods -n dns

# Check certificates
rtk kubectl get certificates -A
rtk kubectl describe certificate wildcard-cert -n cert-manager

# Check External DNS
rtk kubectl logs -n dns -l app.kubernetes.io/name=external-dns
```
