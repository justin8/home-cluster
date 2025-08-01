# Home Kubernetes Cluster

This repository contains Pulumi infrastructure as code for a home Kubernetes cluster running on Talos Linux.

## Overview

The infrastructure is managed using Pulumi and TypeScript, providing:

- Core Kubernetes services
- Persistent storage options (NFS and Longhorn)
- Application deployment framework
- Ingress management
- Certificate management

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

## Applications

Applications extend the `TauApplication` base class which provides:

- Domain management
- Ingress creation (public or private)
- Volume management through VolumeManager

## Storage Strategy

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
      backupEnabled: true
    });
    
    // Create deployment
    new k8s.apps.v1.Deployment(name, {
      spec: {
        selector: { matchLabels: this.labels },
        template: {
          metadata: { labels: this.labels },
          spec: {
            containers: [{
              name: name,
              image: "my-image:latest",
              volumeMounts: [dataMount],
            }],
            volumes: this.volumeManager.getVolumes([dataMount]),
          },
        },
      },
    }, { parent: this });
    
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
