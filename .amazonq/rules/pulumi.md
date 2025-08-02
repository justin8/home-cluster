# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Architecture Overview

This repository contains Pulumi infrastructure as code for a home Kubernetes cluster. The architecture consists of:

1. **Core Services** - Foundational Kubernetes services:
   - MetalLB - Load balancer for bare metal Kubernetes
   - Cert-Manager - Certificate management with Let's Encrypt and Cloudflare DNS
   - NFS-CSI - NFS storage driver for persistent volumes
   - Ingress Controllers - Traefik ingress controllers (public and private)

2. **Applications** - Services deployed on the cluster:
   - Demo App - Example application with NFS volume mounts

3. **Constructs** - Reusable infrastructure components:
   - TauApplication - Base class for applications with ingress and domain management
   - VolumeManager - Handles NFS volume creation and mounting

## Key Components

### Dependency Chain

The infrastructure has a specific deployment order enforced by dependency relationships:

```
MetalLB → Ingress Controllers
      ↘
        Applications (Demo App, etc.)
      ↗
Cert Manager, NFS-CSI
```

### Configuration

Configuration is stored in `Pulumi.home-cluster.yaml` and includes:

- IP address pools for services
- Ingress IPs (public and private)
- NFS server hostname
- Domain name and Cloudflare credentials
- Certificate manager email

### Application Pattern

Applications extend the `TauApplication` base class which provides:

- Domain management
- Ingress creation (public or private)
- Volume management through VolumeManager

## Development Guidelines

1. **Adding New Applications**:
   - Extend the TauApplication class
   - Define required NFS mounts using volumeManager
   - Create any required Kubernetes resources (deployments, services)
   - Call createIngress() to expose the application

2. **Adding Core Services**:
   - Create a new directory under `src/core-services/`
   - Define a Pulumi component resource class
   - Add the service to the dependency chain in `index.ts`

3. **Volume Management**:
   - Use the VolumeManager to create and manage NFS volumes
   - Access storage through the addNFSMount method
