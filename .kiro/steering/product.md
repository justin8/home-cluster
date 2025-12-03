# Product Overview

Home Kubernetes cluster infrastructure-as-code repository for managing a self-hosted Kubernetes environment running on Talos Linux.

## Core Infrastructure

- **Cluster OS**: Talos Linux (immutable Kubernetes OS)
- **Infrastructure as Code**: Pulumi with TypeScript
- **Storage**: Dual strategy - Longhorn (distributed block) + NFS (shared files)
- **Networking**: MetalLB load balancer, Traefik ingress (public/private), PiHole DNS
- **Certificates**: Cert-Manager with Let's Encrypt and Cloudflare DNS validation
- **Authentication**: PocketID (OAuth2/OIDC) + TinyAuth (auth proxy)
- **Databases**: CloudNativePG operator for managed PostgreSQL instances

## Target Environment

Designed for small home clusters, including control-plane-only setups with 2-3 nodes.
