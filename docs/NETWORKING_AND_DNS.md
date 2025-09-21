# Networking and DNS Architecture

## Network Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                Internet                                         │
└─────────────────────────┬───────────────────────────────────────────────────────┘
                          │
                          │ External IP (real_external_ip)
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
│  192.168.5.5    │               │              (API: 192.168.5.10)                 │
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

| IP Range            | Purpose         | Configuration          | Notes                            |
| ------------------- | --------------- | ---------------------- | -------------------------------- |
| `192.168.5.1`       | Router/Gateway  | Network infrastructure | Default gateway                  |
| `192.168.5.2`       | Public Ingress  | `public_ingress_ip`    | External-facing web traffic      |
| `192.168.5.3`       | Private Ingress | `private_ingress_ip`   | Internal-only web traffic        |
| `192.168.5.5`       | NFS Storage     | `nfs_hostname`         | Network file storage server      |
| `192.168.5.10`      | Talos VIP       | `talconfig.yaml`       | Kubernetes API server endpoint   |
| `192.168.5.11-20`   | Talos Nodes     | `talconfig.yaml`       | Reserved for control plane nodes |
| `192.168.5.53`      | DNS Server      | `dns_server_ip`        | PiHole DNS service               |
| `192.168.5.80-100`  | MetalLB Pool    | `ip_address_pool`      | Load balancer IP allocation      |
| `192.168.5.100-254` | DHCP Pool       | Router configuration   | Dynamic client allocation        |

### Static Reservations

- **`.5`**: NFS storage server
- **`.10-.20`**: Talos cluster nodes (VIP + individual nodes)
- **`.80-.100`**: MetalLB dynamic IP pool for services

## Traffic Flow

### Public Traffic (Internet → Applications)

1. **Internet** → Router (`real_external_ip`)
2. **Router** → Public Ingress (`192.168.5.2`)
3. **Traefik Public** → Application Pods
4. **External DNS (Cloudflare)** manages public DNS records

### Private Traffic (Internal Network → Applications)

1. **Internal Network** → Private Ingress (`192.168.5.3`)
2. **Traefik Private** → Application Pods
3. **External DNS (PiHole)** manages internal DNS records

## DNS Architecture

### Multi-tier DNS System

The cluster uses a sophisticated DNS setup with multiple providers. Note that the Pulumi construct for an ingress will by default only create a private ingress, but when `public: true` is set, it will create both a public and private ingress. All local LAN access happens via the private ingress.

#### PiHole (Internal DNS)

- **IP**: `192.168.5.53`
- **Purpose**: Primary DNS for internal clients
- **Manages**: Only private ingress classes for internal resolution
- **Features**: Ad blocking, custom DNS records, internal domain resolution

#### External DNS (Cloudflare)

- **Purpose**: External DNS record management
- **Manages**: Only public ingress class for external resolution
- **Features**: Automatic DNS record creation/updates based on ingress resources

#### External DNS (PiHole Provider)

- **Purpose**: Internal DNS record management
- **Manages**: Private ingress classes and internal services
- **Features**: Automatic internal DNS record management

### DNS Resolution Flow

**Internal Clients:**

- Use PiHole DNS (`192.168.5.53`) for both public and private domains
- Get responses for both internal and external services
- Benefit from ad blocking and custom internal records

**External Clients:**

- Use Cloudflare DNS for public domains only
- Cannot access private ingress services
- Standard internet DNS resolution

## Ingress Strategy

### Dual Ingress Classes

#### Public Ingress

- **IP**: `192.168.5.2`
- **Purpose**: Internet-accessible services
- **DNS**: Managed by Cloudflare External DNS
- **TLS**: Automatic Let's Encrypt certificates via cert-manager
- **Access**: Available from both internal and external networks

#### Private Ingress

- **IP**: `192.168.5.3`
- **Purpose**: Internal-only services
- **DNS**: Managed by PiHole External DNS
- **TLS**: Automatic Let's Encrypt certificates via cert-manager
- **Access**: Only available from internal network

### Ingress Configuration

Applications can configure ingress exposure using the `TauApplication` class:

```typescript
// Private only (default)
this.createHttpIngress({
  appName: name,
  port: 80,
  labels: this.labels,
});

// Public with authentication
this.createHttpIngress({
  appName: name,
  port: 80,
  labels: this.labels,
  public: true,
  auth: true,
});

// Public without authentication
this.createHttpIngress({
  appName: name,
  port: 80,
  labels: this.labels,
  public: true,
  auth: false,
});
```

## MetalLB Configuration

MetalLB provides LoadBalancer services for the bare metal cluster:

- **IP Pool**: `192.168.5.80-192.168.5.100`
- **Mode**: Layer 2 (ARP-based)
- **Auto-assignment**: Enabled for the default pool
- **Speaker**: Configured to ignore exclude-from-external-load-balancers labels

### Reserved IPs within MetalLB Pool

While the pool is `192.168.5.80-100`, specific services have static assignments:

- Most services use dynamic allocation from the pool
- Critical services may have static IP assignments outside the pool

## Certificate Management

### Automatic TLS with cert-manager

- **Provider**: Let's Encrypt
- **DNS Challenge**: Cloudflare DNS-01 challenge
- **Wildcard Certificates**: Supported for `*.domain`
- **Automatic Renewal**: Handled by cert-manager
- **Integration**: Automatic certificate provisioning for all ingress resources

### Certificate Issuers

- **Production**: Let's Encrypt production environment
- **Staging**: Let's Encrypt staging for testing
- **DNS Validation**: Uses Cloudflare API for domain validation

## Network Security

### Firewall Rules

The router/firewall should be configured to:

- Allow inbound traffic to `192.168.5.2` (public ingress)
- Block direct access to other cluster IPs from external networks
- Allow internal network access to all cluster services

### Network Policies

Kubernetes NetworkPolicies can be used to:

- Isolate application traffic
- Control inter-pod communication
- Restrict access to sensitive services

## Troubleshooting

### Common Network Issues

1. **DNS Resolution Problems**
   - Check PiHole service status
   - Verify External DNS controller logs
   - Confirm Cloudflare API token permissions

2. **Ingress Not Accessible**
   - Verify MetalLB speaker pods are running
   - Check Traefik controller status
   - Confirm ingress resource configuration

3. **Certificate Issues**
   - Check cert-manager logs
   - Verify Cloudflare DNS API access
   - Confirm domain ownership

### Diagnostic Commands

```bash
# Check MetalLB status
kubectl get pods -n metallb-system

# Check ingress controllers
kubectl get pods -n traefik-public
kubectl get pods -n traefik-private

# Check DNS services
kubectl get pods -n pihole

# Check certificates
kubectl get certificates -A
kubectl describe certificate <cert-name>

# Check External DNS
kubectl logs -n external-dns deployment/external-dns-cloudflare
kubectl logs -n external-dns deployment/external-dns-pihole
```
