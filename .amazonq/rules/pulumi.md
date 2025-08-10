# Pulumi Infrastructure Documentation

This file provides guidance when working with the Pulumi infrastructure code in this repository.

## Environment Setup

### Prerequisites

- All taken care of by the active nix shell configured by this repository

### Common Commands

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

## Project Structure

```
pulumi/
├── src/
│   ├── core-services/          # Foundational cluster services
│   │   ├── auth/               # Authentication services
│   │   ├── cert-manager/       # TLS certificate management
│   │   ├── cnpg-operator/      # CloudNativePG PostgreSQL operator
│   │   ├── dns/                # DNS services (PiHole + External DNS)
│   │   ├── ingress-controllers/# Traefik ingress controllers
│   │   ├── longhorn/           # Distributed storage system
│   │   ├── metallb/            # Load balancer for bare metal
│   │   ├── nfs-csi/            # NFS storage driver
│   │   └── shared-secrets/     # Cluster-wide secrets
│   ├── applications/           # User applications
│   │   ├── demo-app/           # Example application
│   │   └── postgres-example/   # PostgreSQL usage example
│   ├── constructs/             # Reusable infrastructure components
│   │   ├── tauApplication.ts   # Base application class
│   │   ├── volumeManager.ts    # Storage management
│   │   └── postgresInstance.ts # PostgreSQL database instances
│   └── utils/                  # Utility functions
│       ├── database.ts         # Database helpers
│       ├── networking.ts       # Network utilities
│       └── index.ts            # Common utilities
├── index.ts                    # Main entry point
└── Pulumi.home-cluster.yaml    # Stack configuration
```

## Architecture Overview

The infrastructure is organized into three main layers:

### 1. Core Services

Foundational services that provide cluster capabilities:

- **MetalLB**: Load balancer for bare metal Kubernetes clusters
- **Cert-Manager**: Automated TLS certificate management with Let's Encrypt and Cloudflare DNS
- **Longhorn**: Distributed block storage with backup capabilities
- **NFS-CSI**: NFS storage driver for shared volumes
- **Ingress Controllers**: Traefik-based ingress (public and private)
- **DNS Services**: PiHole for internal DNS + External DNS for automatic record management
- **CNPG Operator**: CloudNativePG for PostgreSQL database management
- **Shared Secrets**: Cluster-wide secret management

### 2. Applications

User-facing services deployed on the cluster:

- **Demo App**: Example application demonstrating NFS volume usage
- **PostgresExample**: Example showing PostgreSQL database integration

### 3. Constructs

Reusable infrastructure components:

- **TauApplication**: Base class for applications with automatic ingress and domain management. It includes some wrappers to automatically pass through important context, wrapper functions on TauApplication should be preferred over directly calling e.g. VolumeManager or creating a database.
- **VolumeManager**: Handles both NFS and Longhorn volume creation and mounting. This should always be used when adding volumes to an application
- **PostgresInstance**: Managed PostgreSQL database instances using CNPG

## Key Design Patterns

### Dependency Management

Strict dependency chain ensures proper deployment order:

```
SharedSecrets → MetalLB → IngressControllers → Longhorn → [DNS, CNPGOperator] → Applications
                     ↘
                   CertManager, NFS-CSI
```

### Dynamic Application Loading

Applications are automatically discovered and loaded from the `src/applications/` directory:

- Each application folder contains an `index.ts` with a class matching the PascalCase folder name
- Applications automatically receive core service dependencies
- Supports hot-pluggable application architecture

### Storage Strategy

Dual storage approach:

- **NFS**: For shared, persistent data that needs cross-node access
- **Longhorn**: For high-performance, replicated block storage with backup capabilities

### DNS Architecture

Multi-tier DNS system:

- **Internal DNS (PiHole)**: Handles both public and private ingress classes for internal resolution
- **External DNS (Cloudflare)**: Handles only public ingress class for external resolution
- **Automatic Record Management**: External DNS automatically creates/updates DNS records based on ingress resources

### Ingress Strategy

Dual ingress classes:

- **Public**: Exposed to internet via Cloudflare DNS
- **Private**: Internal-only access via PiHole DNS

## Configuration

Configuration is stored in `Pulumi.home-cluster.yaml` and includes:

- **Network Configuration**: IP address pools, ingress IPs, NFS server hostname
- **Domain Management**: Primary domain, Cloudflare credentials
- **Service Configuration**: Certificate manager email, DNS server IP
- **Security**: Various API tokens and credentials (encrypted)

## Development Guidelines

### Adding New Applications

1. Create a new directory under `src/applications/`
2. Extend the `TauApplication` base class
3. Define storage requirements using `volumeManager`
4. Create Kubernetes resources (deployments, services)
5. Use `this.createHttpIngress()` for web exposure
6. For databases, use the `PostgresInstance` construct

### Adding Core Services

1. Create a new directory under `src/core-services/`
2. Define a Pulumi `ComponentResource` class
3. Export the service from `src/core-services/index.ts`
4. Add to the dependency chain in `index.ts`
5. Update this documentation

### Storage Management

- **NFS Volumes**: Use `volumeManager.addNFSMount(path)` for shared storage
- **Longhorn Volumes**: Use `volumeManager.addLonghornVolume(mountPath, options)` for block storage
- **Database Storage**: Automatically handled by `PostgresInstance` with Longhorn backend

### Database Integration

- Use `PostgresInstance` construct for managed PostgreSQL databases
- Automatic connection secret generation
- Built-in backup configuration with Longhorn
- Environment variable injection via `getAllEnvironmentVariables()`

### Security Considerations

- All secrets managed through Kubernetes secrets
- TLS certificates automatically provisioned and renewed
- Database credentials auto-generated with secure passwords
- Network isolation between public and private services

### Backup Strategy

- Longhorn volumes support automatic backup scheduling
- PostgreSQL databases backed up via Longhorn volume snapshots
- NFS data relies on external NFS server backup policies
