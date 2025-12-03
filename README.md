# Home Kubernetes Cluster

This repository contains infrastructure as code for a home Kubernetes cluster running on Talos Linux.

## Overview

The infrastructure is managed using Pulumi via TypeScript, and Talos Linux with Talhelper providing:

- Kubernetes infrastructure management
- Core Kubernetes services
- Persistent storage options (NFS and Longhorn)
- Application deployment framework
- Ingress management
- Certificate management

## Initial Setup

A few components can't be configured automatically at the moment, they should all be documented below:

### Pulumi Variables

These should be set via `pulumi config set $name $value` and optionally with `--secret` to encrypt the values before storing them in the file.

- `ip_address_pool` - The main IP address pool for MetalLB to use, e.g: `192.168.5.80-192.168.5.100`
- `admin_email` - Email used for domain validation when generating TLS certs and other default administrative purposes
- Cloudflare:
  - `cloudflare_email` - What it says on the tin
  - `cloudflare_api_token` - An API token that can modify DNS; used for both TLS wildcard cert generation and public ingress DNS updates. Note this is an API **token** as opposed to an API **key** that is legacy.
- `domain` - Top-level domain that all services will be generated under.
- `storage_ip` - Used for all NFS mounts
- `public_ingress_ip` - A static IP (or a pool) to use for the public ingress
- `private_ingress_ip` - A static IP (or a pool) to use for the private ingress
- `cluster_ip` - The Kubernetes API server VIP
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

## Cluster Deployment

For cluster creation, initialization, and post-deployment setup instructions, see [docs/TALOS.md](docs/TALOS.md).

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

1. **SharedSecrets** - Cluster-wide secret management
   - Manages shared secrets across the cluster
   - Foundation for other services requiring credentials

2. **MetalLB** - Load balancer for bare metal Kubernetes
   - Provides IP addresses for LoadBalancer services
   - Used by ingress controllers and DNS services

3. **Cert-Manager** - Certificate management with Let's Encrypt
   - Automated certificate issuance and renewal
   - Integration with Cloudflare DNS for domain validation

4. **NFS-CSI** - NFS storage driver
   - Mounts external NFS shares
   - Used for shared file storage across nodes

5. **Longhorn** - Distributed block storage
   - High availability through volume replication
   - Snapshot and backup capabilities
   - Disaster recovery support

6. **IngressControllers** - Traefik ingress controllers
   - Separate public and private controllers
   - TLS termination with automatic certificate management

7. **DNS** - Multi-tier DNS system
   - **PiHole**: Internal DNS server (primary + secondary)
   - **External DNS**: Automatic DNS record management
     - PiHole provider for private ingress classes
     - Cloudflare provider for public ingress classes

8. **CNPG Operator** - CloudNativePG PostgreSQL operator
   - Manages PostgreSQL database instances
   - Automated backup and recovery
   - High availability PostgreSQL clusters

9. **Auth** - Authentication services
   - **PocketId**: OAuth2/OIDC identity provider
   - **TinyAuth**: Authentication proxy for services without native OAuth2 support

## Network Setup

For detailed networking and DNS architecture information, see [docs/NETWORKING_AND_DNS.md](docs/NETWORKING_AND_DNS.md).

### Key Network Components

- **MetalLB**: Load balancer providing IPs from `192.168.5.80-100` pool
- **DNS Services**: PiHole for internal DNS (`192.168.5.53`) + External DNS for automatic record management
- **Dual Ingress**: Separate public (`192.168.5.2`) and private (`192.168.5.3`) ingress controllers
- **Storage**: NFS server at `192.168.5.5` + Longhorn distributed storage
- **Zigbee Co-ordinator**: `192.168.5.6`

## Applications

Applications extend the `TauApplication` base class which provides:

- Domain management
- Ingress creation (public or private)
- Volume management through VolumeManager

### Ingress

The `TauApplication` class provides the `createHttpIngress()` method for exposing applications via HTTP/HTTPS. It also includes some sane defaults:

- Auth is enabled by default
- All ingresses are private by default
- The wrapper in `TauApplication` should automatically assignes the right labels, but you can specify them manually if required

```typescript
// Basic ingress (private only, with auth)
this.createHttpIngress({ appName: name, port: 80 }, { parent: this });

// Public ingress with authentication
this.createHttpIngress({ appName: name, port: 80, public: true }, { parent: this });

// Public ingress without authentication
this.createHttpIngress({ appName: name, port: 80, public: true, auth: false }, { parent: this });
```

**Options:**

- `appName`: Application name (used for service name)
- `port`: Service port to expose
- `labels`: Pod selector labels
- `public`: Create both public and private ingress (default: false)
- `auth`: Enable TinyAuth authentication middleware (default: true)
- `path`: URL path (default: "/")
- `pathType`: Path matching type (default: "Prefix")

**Behavior:**

- Always creates a private ingress accessible internally
- Auth is enabled by default and can be disabled with `auth: false`
- If `public: true`, also creates a public ingress accessible from internet
- Automatic TLS certificate provisioning via cert-manager
- DNS records automatically managed by External DNS (by monitoring ingress objects)

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
