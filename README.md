# Home Kubernetes Cluster

This repository contains infrastructure as code for a home Kubernetes cluster running on Talos Linux. This branch is currently in the process of migrating from Pulumi-based management to a GitOps approach using ArgoCD.

## Overview

The infrastructure is managed using ArgoCD and Talos Linux with Talhelper providing:

- Kubernetes infrastructure management
- Core Kubernetes services
- Persistent storage options (NFS and Longhorn)
- Application deployment framework via ArgoCD
- Ingress management
- Certificate management

## Initial Setup

### Requirements

- Talos Linux nodes
- Cloudflare account for DNS and TLS
- NFS server for persistent storage

### Configuration

Configuration is managed via Helm values and Kubernetes manifests located in the `kubernetes/` directory. Secrets are managed using SOPS.

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

Tinyauth is used as an auth proxy in front of most services that don't support native OAuth2. It also needs its own OAuth client setup in Pocket ID.

## Cluster Deployment

For cluster creation, initialization, and post-deployment setup instructions, see [docs/TALOS.md](docs/TALOS.md).

## Project Layout

```
/kubernetes
├── apps/                        # Application manifests and Helm charts
├── bootstrap/                   # ArgoCD root application
├── charts/                      # Local Helm charts
└── values/                      # Global and environment-specific values
/talos
├── talconfig.yaml               # Talhelper configuration
└── talsecret.sops.yaml          # Encrypted cluster secrets
```

## Core Services

The infrastructure includes the following core services:

1. **SharedSecrets** - Cluster-wide secret management using SOPS
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

## Storage Options

The cluster uses both NFS and Longhorn for different use cases:

- **NFS**: Used for shared file access across multiple nodes/pods when network file storage is appropriate
- **Longhorn**: Used for persistent block storage with replication when data needs high availability

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
