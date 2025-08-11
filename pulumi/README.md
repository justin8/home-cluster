# Home Kubernetes Cluster

This repository contains Pulumi infrastructure as code for a home Kubernetes cluster running on Talos Linux.

## Overview

The infrastructure is managed using Pulumi and TypeScript, providing:

- Core Kubernetes services
- Persistent storage options (NFS and Longhorn)
- Application deployment framework
- Ingress management
- Certificate management

## Initial Setup

A few components can't be configured automatically at the moment, they should all be documented below:

### Variables

These should be set via `pulumi config set $name $value` and optionally with `--secret` to encrypt the values before storing them in the file.

- `ip_address_pool` - The main IP address pool for MetalLB to use, e.g: `192.168.4.80-192.168.4.100`
- `cert_manager_email` - Email used for domain validation when generating TLS certs
- Cloudflare:
  - `cloudflare_email` - What it says on the tin
  - `cloudflare_api_token` - An API token that can modify DNS; used for both TLS wildcard cert generation and public ingress DNS updates. Note this is an API **token** as opposed to an API **key** that is legacy.
- `domain` - Top-level domain that all services will be generated under.
- `nfs_hostname` - Used for all NFS mounts
- `public_ingress_ip` - A static IP (or a pool) to use for the public ingress
- `private_ingress_ip` - A static IP (or a pool) to use for the private ingress
- `dns_server_ip` - A static IP (or a pool) to use for the DNS server
- `longhorn_nfs_backup_path` - A path on the NFS server to use for longhorn backups
- `timezone_offset` - Used to generate cron jobs at acceptable times - Talos only supports UTC natively
- `real_external_ip` - The external IP (e.g. router IP) that will be used for external DNS updates instead of the public ingress's IP

### NFS

The NFS server must be accessible to all nodes in the cluster, with any specified shares accessible.

### Auth

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Authentication Flow                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    User     │    │ Pocket ID   │    │  Tinyauth   │    │   Service   │
│  (Browser)  │    │ (Identity   │    │ (Auth Proxy)│    │ (Protected  │
│             │    │  Provider)  │    │             │    │ Application)│
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │                  │
       │ 1. Access        │                  │                  │
       │ Protected        │                  │                  │
       │ Service          │                  │                  │
       ├────────────────────────────────────►│                  │
       │                  │                  │                  │
       │ 2. Redirect to   │                  │                  │
       │ Pocket ID        │                  │                  │
       │◄────────────────────────────────────┤                  │
       │                  │                  │                  │
       │ 3. OAuth2        │                  │                  │
       │ Authorization    │                  │                  │
       ├─────────────────►│                  │                  │
       │                  │                  │                  │
       │ 4. Login &       │                  │                  │
       │ Consent          │                  │                  │
       │◄─────────────────┤                  │                  │
       ├─────────────────►│                  │                  │
       │                  │                  │                  │
       │ 5. Authorization │                  │                  │
       │ Code             │                  │                  │
       │◄─────────────────┤                  │                  │
       │                  │                  │                  │
       │ 6. Return to     │                  │                  │
       │ Tinyauth with    │                  │                  │
       │ Auth Code        │                  │                  │
       ├────────────────────────────────────►│                  │
       │                  │                  │                  │
       │                  │ 7. Exchange      │                  │
       │                  │ Code for Token   │                  │
       │                  │◄─────────────────┤                  │
       │                  │                  │                  │
       │                  │ 8. Access Token  │                  │
       │                  │ & User Info      │                  │
       │                  ├─────────────────►│                  │
       │                  │                  │                  │
       │ 9. Set Session   │                  │                  │
       │ Cookie & Proxy   │                  │                  │
       │ to Service       │                  │                  │
       │◄────────────────────────────────────┤                  │
       │                  │                  │                  │
       │ 10. Subsequent   │                  │ 11. Forward      │
       │ Requests with    │                  │ Authenticated    │
       │ Session Cookie   │                  │ Requests         │
       ├────────────────────────────────────►├─────────────────►│
       │                  │                  │                  │
       │ 12. Service      │                  │ 13. Service      │
       │ Response         │                  │ Response         │
       │◄────────────────────────────────────┤◄─────────────────┤
       │                  │                  │                  │

┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Components                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│ Pocket ID (Identity Provider):                                                  │
│ • Manages user accounts and authentication                                      │
│ • Provides OAuth2/OIDC endpoints                                                │
│ • Requires manual OAuth client setup for each service                           │
│ • Issues access tokens and ID tokens                                            │
│                                                                                 │
│ Tinyauth (Authentication Proxy):                                                │
│ • Acts as OAuth2 client to Pocket ID                                            │
│ • Protects services that don't have native OAuth2 support                       │
│ • Handles OAuth2 flow and session management                                    │
│ • Proxies authenticated requests to backend services                            │
│ • Requires its own OAuth client configuration in Pocket ID                      │
│                                                                                 │
│ Protected Services:                                                             │
│ • Applications that need authentication but don't support OAuth2                │
│ • Receive requests with user context from Tinyauth                              │
│ • Can trust that all incoming requests are authenticated                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Pocket ID is used to manage all users, and also requires manual setup of OAuth clients. On a clean cluster, navigate to `https://pocketid.${domain}/setup` to do the first-time setup and create an admin user.

Tinyauth is used as an auth proxy in front of most services that don't support native OAuth2. It also needs it's own OAuth client setup in Pocket ID to be able to support this. Initial setup instructions can be found [here](https://tinyauth.app/docs/guides/pocket-id), however for our purposes the only settings that wil need to be udpated are:

- `pulumi config set --path tinyauth_oauth_client_id $client_id`
- `pulumi config set --secret --path tinyauth_oauth_client_secret $client_secret`

## Project Layout

```
/pulumi
├── index.ts                     # Main Pulumi entry point
├── src/
│   ├── applications/            # Application definitions
│   │   └── demo-app/            # Example application
│   ├── constructs/              # Reusable infrastructure components
│   │   ├── index.ts             # Exports of constructs
│   │   ├── tauApplication.ts    # Base application class
│   │   └── volumeManager.ts     # Volume management utilities
│   ├── core-services/           # Core cluster services
│   │   ├── cert-manager/        # Certificate management
│   │   ├── ingress-controllers/ # Traefik ingress controllers
│   │   ├── longhorn/            # Longhorn storage
│   │   ├── metallb/             # Load balancer for bare metal
│   │   └── nfs-csi/             # NFS storage driver
│   ├── constants.ts             # Shared constants
│   └── utils/                   # Utility functions
└── Pulumi.home-cluster.yaml     # Stack configuration
```

## Core Services

The infrastructure includes the following core services:

1. **MetalLB** - Load balancer for bare metal Kubernetes
   - Provides IP addresses for LoadBalancer services
   - Used by ingress controllers

2. **Cert-Manager** - Certificate management with Let's Encrypt
   - Automated certificate issuance and renewal
   - Integration with Cloudflare DNS for domain validation

3. **NFS-CSI** - NFS storage driver
   - Mounts external NFS shares
   - Used for shared file storage

4. **Longhorn** - Distributed block storage
   - High availability through volume replication
   - Snapshot and backup capabilities
   - Disaster recovery support

5. **Ingress Controllers** - Traefik ingress controllers
   - Separate public and private controllers
   - TLS termination with automatic certificate management

## Network Setup

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                Internet                                         │
└─────────────────────────┬───────────────────────────────────────────────────────┘
                          │
                          │ External IP (real_external_ip)
                          │
┌─────────────────────────▼───────────────────────────────────────────────────────┐
│                    Home Router/Firewall                                         │
└─────────────────────────┬───────────────────────────────────────────────────────┘
                          │
                          │ 192.168.x.x Network
                          │
┌─────────────────────────▼───────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                                           │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        MetalLB                                          │    │
│  │                   IP Pool: 192.168.4.80-100                             │    │
│  │                                                                         │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │    │
│  │  │   DNS Server    │  │ Public Ingress  │  │ Private Ingress │          │    │
│  │  │  192.168.4.53   │  │  192.168.4.70   │  │  192.168.4.71   │          │    │
│  │  │                 │  │                 │  │                 │          │    │
│  │  │   PiHole        │  │  Traefik        │  │  Traefik        │          │    │
│  │  │   Primary +     │  │  (Public)       │  │  (Private)      │          │    │
│  │  │   Secondary     │  │                 │  │                 │          │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      DNS Resolution                                     │    │
│  │                                                                         │    │
│  │  ┌─────────────────┐              ┌─────────────────┐                   │    │
│  │  │  External DNS   │              │  External DNS   │                   │    │
│  │  │  (PiHole)       │              │  (Cloudflare)   │                   │    │
│  │  │                 │              │                 │                   │    │
│  │  │ Manages:        │              │ Manages:        │                   │    │
│  │  │ • Private       │              │ • Public        │                   │    │
│  │  │   Ingress       │              │   Ingress       │                   │    │
│  │  │ • Internal DNS  │              │ • External DNS  │                   │    │
│  │  └─────────────────┘              └─────────────────┘                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                       Storage Layer                                     │    │
│  │                                                                         │    │
│  │  ┌─────────────────┐              ┌─────────────────┐                   │    │
│  │  │   NFS Storage   │              │ Longhorn Storage│                   │    │
│  │  │                 │              │                 │                   │    │
│  │  │ • External NFS  │              │ • Distributed   │                   │    │
│  │  │   Server        │              │   Block Storage │                   │    │
│  │  │ • Shared Files  │              │ • Replication   │                   │    │
│  │  │ • Cross-node    │              │ • Snapshots     │                   │    │
│  │  │   Access        │              │ • Backups       │                   │    │
│  │  └─────────────────┘              └─────────────────┘                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      Applications                                       │    │
│  │                                                                         │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │    │
│  │  │   Demo App      │  │  PostgreSQL     │  │   Other Apps    │          │    │
│  │  │                 │  │   Databases     │  │                 │          │    │
│  │  │ • NFS Volumes   │  │                 │  │ • Custom Apps   │          │    │
│  │  │ • HTTP Ingress  │  │ • CNPG Operator │  │ • Auto-loaded   │          │    │
│  │  │ • TLS Certs     │  │ • Longhorn      │  │ • TauApplication│          │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Traffic Flow

**Public Traffic (Internet → Applications):**

1. Internet → Router (`real_external_ip`)
2. Router → Public Ingress (`public_ingress_ip`)
3. Traefik Public → Application Pods
4. External DNS (Cloudflare) manages public DNS records

**Private Traffic (Internal Network → Applications):**

1. Internal Network → Private Ingress (`private_ingress_ip`)
2. Traefik Private → Application Pods
3. External DNS (PiHole) manages internal DNS records

**DNS Resolution:**

- **Internal clients**: Use PiHole DNS (`dns_server_ip`) for both public and private domains
- **External clients**: Use Cloudflare DNS for public domains only
- **PiHole**: Handles both public and private ingress classes for internal resolution
- **Cloudflare**: Handles only public ingress class for external resolution

### IP Address Allocation

| Service         | Variable             | IP Address       | Purpose                            |
| --------------- | -------------------- | ---------------- | ---------------------------------- |
| MetalLB Pool    | `ip_address_pool`    | 192.168.4.80-100 | Load balancer IP pool              |
| DNS Server      | `dns_server_ip`      | 192.168.4.53     | PiHole DNS service                 |
| Public Ingress  | `public_ingress_ip`  | 192.168.4.70     | External-facing web traffic        |
| Private Ingress | `private_ingress_ip` | 192.168.4.71     | Internal-only web traffic          |
| External IP     | `real_external_ip`   | (encrypted)      | Router's public IP for DNS records |

## Applications

Applications extend the `TauApplication` base class which provides:

- Domain management
- Ingress creation (public or private)
- Volume management through VolumeManager

## Storage Options

The cluster uses both NFS and Longhorn for different use cases:

- **NFS**: Used for shared file access across multiple nodes/pods when network file storage is appropriate
- **Longhorn**: Used for persistent block storage with replication when data needs high availability

## Usage Examples

### Creating a Basic Application

See [src/applications/demo-app/index.ts](src/applications/demo-app/index.ts) for a more complete example.

```typescript
export class MyApp extends TauApplication {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(name, opts);

    // Define volumes
    const dataMount = this.volumeManager.createVolume("/data/my-app", {
      size: "10Gi",
      backupEnabled: true,
    });

    // Create deployment
    new k8s.apps.v1.Deployment(
      name,
      {
        spec: {
          selector: { matchLabels: this.labels },
          template: {
            metadata: { labels: this.labels },
            spec: {
              containers: [
                {
                  name: name,
                  image: "my-image:latest",
                  volumeMounts: [dataMount],
                },
              ],
              volumes: this.volumeManager.getVolumes([dataMount]),
            },
          },
        },
      },
      { parent: this }
    );

    // Create ingress
    this.createIngress({ port: 80 });
  }
}
```

## Common Commands

```bash
# Preview infrastructure changes
pulumi preview

# Deploy infrastructure changes
pulumi up

# Destroy infrastructure
pulumi destroy

# View stack outputs
pulumi stack output
```

## Running on Control Plane Only Clusters

This infrastructure is designed to work on small clusters with only control plane nodes. The following components are configured to run on control plane nodes:

### Longhorn

Longhorn is configured with the following settings for control plane nodes:

1. **Tolerations** for all components (UI, manager, driver) to allow scheduling on control plane nodes
2. **Node Down Pod Deletion Policy**: set to "do-nothing" for better resilience
3. **Multiple taint tolerations** for both `node-role.kubernetes.io/control-plane` and `node-role.kubernetes.io/master` taints

Additional considerations for control plane only clusters:

- Replica count is set to match the number of control plane nodes (typically 2-3)
- Resource settings are conservative to avoid overloading control plane nodes
