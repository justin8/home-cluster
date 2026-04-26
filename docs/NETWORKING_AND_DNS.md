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
│                 │               │                   (Tailscale)                    │
│ • File Storage  │◄──Tailscale───│  ┌─────────────────────────────────────────────┐ │
│ • NFS Shares    │  (NFS only)   │  │                    MetalLB                  │ │
│ • Longhorn      │               │  │              IP Pool: 192.168.5.80-100      │ │
│   Backups       │               │  │                                             │ │
└─────────────────┘               │  └─────────────────────────────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────┐ ┌─────────────────────┐ │
                                  │  │ Private Ingress     │ │ Public Ingress      │ │
                                  │  │  (Tailscale only)   │ │  192.168.5.2        │ │
                                  │  │                     │ │                     │ │
                                  │  │    Traefik          │ │    Traefik          │ │
                                  │  │    (Private)        │ │    (Public)         │ │
                                  │  └─────────────────────┘ └─────────────────────┘ │
                                  │                                                  │
                                  │  ┌─────────────────────────────────────────────┐ │
                                  │  │                  DNS Server                 │ │
                                  │  │                over Tailscale               │ │
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

| IP Range            | Purpose                    | Configuration           | Notes                            |
| ------------------- | -------------------------- | ----------------------- | -------------------------------- |
| `192.168.5.1`       | Router/Gateway             | Network infrastructure  | Default gateway                  |
| `192.168.5.2`       | Wifi AP                    |                         | Network infrastructure           |
| `192.168.5.3`       | Public Ingress             | `network.publicIngress` | External-facing web traffic      |
| `192.168.5.5`       | NAS                        | `network.storageServer` | Network file storage server      |
| `192.168.5.6`       | Zigbee/thread co-ordinator |                         | Network Infrastructure           |
| `192.168.5.20`      | Talos VIP                  | `network.cluster`       | Kubernetes API server endpoint   |
| `192.168.5.11-20`   | Talos Nodes                | `talconfig.yaml`        | Reserved for control plane nodes |
| `192.168.5.80-100`  | MetalLB Pool               | `network.metallbRange`  | Load balancer IP allocation      |
| `192.168.5.100-254` | DHCP Pool                  | Router configuration    | Dynamic client allocation        |

### Static Reservations

- **`.5`**: NAS
- **`.10-.20`**: Talos cluster nodes (VIP + individual nodes)
- **`.80-.100`**: MetalLB dynamic IP pool for services

## Traffic Flow

### Public Traffic (Internet → Applications)

1. **Internet** → Router (WAN IP)
2. **Router** → Public Ingress (`192.168.5.2`)
3. **Traefik Public** → Application Pods
4. **Cloudflare DDNS** updates `home.dray.id.au` with the current WAN IP.
5. **External DNS (Cloudflare)** manages application CNAME records pointing to `home.dray.id.au`.

### Private Traffic (Tailscale → Applications)

1. **Tailscale client** → Private Ingress (via Tailscale network)
2. **Traefik Private** → Application Pods
3. **External DNS (PiHole)** manages internal DNS records pointing to the private ingress Tailscale IP.
4. Private services are only reachable from devices enrolled in the tailnet.

## DNS Architecture

### Multi-tier DNS System

The cluster uses a split-horizon DNS setup. The ingress controller configuration determines if an ingress is public or private based on the `ingressClassName`.

#### PiHole (Internal DNS)

- **Purpose**: DNS for internal clients (served over Tailscale)
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

**Internal Clients (Tailscale enrolled):**

- Use PiHole DNS (served over Tailscale) for both public and private domains.
- Private services resolve to the private ingress Tailscale IP (only reachable over the tailnet).
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
- **TLS**: Wildcard certificate (via Traefik default `TLSStore`)
- **Access**: Available from both internal and external networks

#### Private Ingress

- **ingressClassName**: `traefik-private`
- **Purpose**: Internal-only services, accessible over Tailscale only
- **DNS**: Managed by PiHole External DNS (resolves to the private ingress Tailscale IP)
- **TLS**: Wildcard certificate (via Traefik default `TLSStore`)
- **Access**: Only available from devices enrolled in the tailnet

### Ingress Configuration

Applications typically configure both public and private ingresses in their Helm templates. Note that `secretName` is omitted from the `tls` section to use the Traefik default `TLSStore`:

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
    # secretName is omitted to use the Traefik default TLSStore
---
{{- end }}
```

## MetalLB Configuration

MetalLB provides LoadBalancer services for the bare metal cluster:

- **IP Pool**: `192.168.5.80-192.168.5.100` (Pool name: `default`)
- **Mode**: Layer 2 (ARP-based)
- **Ingress IPs**:
  - `public-ingress` pool -> `192.168.5.2`
  - `private-ingress` pool -> assigned a Tailscale IP via the Tailscale Kubernetes operator

## Certificate Management

### Automatic TLS with cert-manager

- **Provider**: Let's Encrypt
- **Issuer**: `letsencrypt-prod` (ClusterIssuer)
- **DNS Challenge**: Cloudflare DNS-01 challenge
- **Wildcard Certificate**: Managed as a `Certificate` resource in the `cert-manager` namespace.
- **Secret Reflection**: The `default-tls` secret is automatically reflected to the Ingress Controller namespaces (`traefik-public`, `traefik-private`) using Emberstack Reflector.
- **Default TLS Store**: Traefik is configured with a default `TLSStore` (named `default`) in its own namespace pointing to the reflected `default-tls` secret. This allows Ingress and IngressRoute resources to use the wildcard certificate without specifying a `secretName` in every namespace.

## Network Security

### Firewall Rules

The router/firewall is configured to:

- Allow inbound traffic on ports 80/443 to `192.168.5.2` (public ingress).
- Block direct access to other cluster IPs from external networks.
- Cloudflare DDNS ensures the WAN IP is always correct in DNS.

### NFS Security

NFS traffic is restricted to the Tailscale network only. Network policies enforce that NFS connections are only permitted between the NAS and Talos nodes over their Tailscale IPs, preventing any unencrypted NFS traffic on the local LAN.

### Mail Proxy (Relay)

The cluster provides a centralized Postfix mail relay for outgoing notifications without exposing secrets to all services.

- **SMTP Host**: `smtp.mail-proxy.svc.cluster.local`
- **SMTP Port**: `587`
- **Authentication**: None (trusted in-cluster)
- **Encryption**: `STARTTLS` (optional)
- **Allowed Sender Domains**: Emails must be sent from an allowed domain (e.g., `@dray.id.au`).

## Tailscale

[Tailscale](https://tailscale.com) is a zero-config VPN built on WireGuard. It creates a private mesh network (a "tailnet") between enrolled devices, assigning each a stable IP in the `100.64.0.0/10` range. Devices can reach each other directly over this overlay network regardless of their physical location or NAT configuration, with Tailscale's coordination server handling key exchange and peer discovery.

### Talos Node Integration

Tailscale runs directly on each Talos node via the official [Siderolabs Tailscale extension](https://github.com/siderolabs/extensions/tree/main/network/tailscale). This means the nodes themselves are enrolled in the tailnet, enabling direct access to the cluster nodes over Tailscale from any enrolled device.

### NAS Integration

The NAS is also enrolled in the tailnet. All NFS traffic between the NAS and Talos nodes is routed exclusively over Tailscale (WireGuard-encrypted). Network policies enforce that only the NAS and Talos node Tailscale IPs may communicate over NFS, preventing any unencrypted NFS traffic on the local LAN.

### Private Ingress

The private Traefik ingress controller is exposed on the tailnet via the Tailscale Kubernetes operator. Private services are only reachable from enrolled devices — there is no local LAN IP for the private ingress.

### DNS Configuration

When connected to Tailscale, devices use Tailscale's built-in "MagicDNS" resolver (`100.100.100.100`) for all DNS resolution. MagicDNS is configured via Split DNS to forward all requests for the cluster domain (`*.dray.id.au`) to the Pi-hole service on the tailnet. This ensures that internal cluster services resolve correctly while all other traffic is handled by Tailscale's global DNS settings.

### Kubernetes Operator

The Tailscale Kubernetes operator (deployed in the `tailscale` namespace) allows Kubernetes `Service` and `Ingress` resources to be exposed directly on the tailnet without going through the public ingress controller. This is used to expose the private ingress controller, making private services accessible only to enrolled devices.

### Exit Node

A Tailscale exit node runs in the cluster, allowing enrolled devices to route their traffic through the cluster and access the local LAN (`192.168.5.0/24`). This enables access to LAN resources (such as the NAS, PiHole, and cluster nodes) from anywhere without needing a separate VPN.

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
   - Confirm Reflector is mirroring the `default-tls` secret to `traefik-public` and `traefik-private`.
   - Verify the `TLSStore` is correctly configured in the Traefik namespaces: `kubectl get tlsstores.traefik.io -A`.

### Diagnostic Commands

```bash
# Check MetalLB status
rtk kubectl get pods -n metallb-system

# Check ingress controllers
rtk kubectl get pods -n traefik-public
rtk kubectl get pods -n traefik-private

# Check TLS Store
rtk kubectl get tlsstores.traefik.io -A
rtk kubectl describe tlsstore default -n traefik-private
...

# Check DNS services
rtk kubectl get pods -n dns

# Check certificates
rtk kubectl get certificates -A
rtk kubectl describe certificate wildcard-cert -n cert-manager

# Check External DNS
rtk kubectl logs -n dns -l app.kubernetes.io/name=external-dns
```
