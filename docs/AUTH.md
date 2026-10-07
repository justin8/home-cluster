# Authentication Architecture

The cluster uses [Pocket ID](https://github.com/pocket-id/pocket-id) as the central Identity Provider (IdP) for all services. Authentication and authorization are enforced by **Pomerium**, which acts as a central Identity-Aware Proxy (IAP) and Ingress Controller.

## Authentication Flow (Pomerium)

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    User     │    │ Pocket ID   │    │  Pomerium   │    │   Service   │
│  (Browser)  │    │ (Identity   │    │ (IAP/Ingress)│    │ (Protected  │
│             │    │  Provider)  │    │              │    │  Backend)   │
└──────┬──────┘    └──────┬──────┘    └──────┬───────┘    └──────┬──────┘
       │                  │                  │                   │
       │ 1. Access        │                  │                   │
       │ https://app.dom  │                  │                   │
       ├────────────────────────────────────►│                   │
       │                  │                  │                   │
       │ 2. Redirect to   │                  │                   │
       │ Pomerium Auth    │                  │                   │
       │◄────────────────────────────────────┤                   │
       │                  │                  │                   │
       │ 3. Handshake with│                  │                   │
       │ PocketID (OIDC)  │                  │                   │
       │◄─────────────────┼──────────────────┤                   │
       │                  │                  │                   │
       │ 4. Login &       │                  │                   │
       │ Consent          │                  │                   │
       ├─────────────────►│                  │                   │
       │                  │                  │                   │
       │ 5. Callback with │                  │                   │
       │ Auth Code        │                  │                   │
       ├────────────────────────────────────►│                   │
       │                  │                  │                   │
       │                  │ 6. Verify Policy │                   │
       │                  │ (Groups/Claims)  │                   │
       │                  │◄─────────────────┤                   │
       │                  │                  │                   │
       │ 7. Set Session   │                  │                   │
       │ Cookie & Proxy   │                  │                   │
       │◄────────────────────────────────────┼──────────────────►│
```

## Pomerium Policies

Access control is defined in the `Ingress` resource via annotations.

### Authentication Shortcuts

- **`ingress.pomerium.io/allow_any_authenticated_user: "true"`**: Requires a valid PocketID session but allows any user.
- **`ingress.pomerium.io/allow_public_unauthenticated_access: "true"`**: Bypasses authentication entirely (used for APIs or public assets).

### Granular Authorization (PPL)

Use the `ingress.pomerium.io/policy` annotation for more complex logic:

#### OIDC Group Access

Pomerium evaluates groups provided by PocketID in the ID Token.

1.  **`admin`**: For administrative portals (ArgoCD, Longhorn, Pi-hole).
    ```yaml
    - allow:
        and:
          - groups: { has: admin }
    ```
2.  **`private`**: For restricted internal tools.
    ```yaml
    - allow:
        and:
          - groups: { has: private }
    ```

#### Example: Admin Only

```yaml
{
  {
    include "common.pomeriumIngress" (dict
    "ctx" .
    "name" "my-app"
    "port" 80
    "allowedUsers" "admin"
    ),
  },
}
```

## Managing OIDC Clients

OIDC clients are managed via the `PocketIDOIDCClient` custom resource. The **Pomerium** client is the primary integration.

### The Pomerium Client

- **Metadata Name:** `pomerium`
- **Callback URL:** `https://authenticate.{{ .Values.domain }}/oauth2/callback`
- **Credentials Secret:** `pomerium-oidc-credentials` (Populated in the `pomerium` namespace).

## Automated OIDC Credential Synchronization

### The Challenge with Native OIDC in Self-Hosted Apps

Many self-hosted applications natively support OpenID Connect, but require credentials (`client_id`, `client_secret`, and issuer/discovery URLs) to be entered through a web admin UI or saved to internal storage (PostgreSQL rows, JSON/XML config files on PVCs), without supporting direct dynamic injection via standard environment variables.

In a GitOps environment with automated rotation and backup restores, relying on manual configuration causes silent failures:

1. **Cluster Restorations & IdP Rotations**: When Pocket ID clients are provisioned or secrets are rotated, the Pocket ID operator creates a new secret `{metadata.name}-oidc-credentials`.
2. **Database/Storage Restores**: Restoring an application's database or volume restores stale, pre-rotation credentials.
3. **Desynchronization**: The application attempts token exchange using stale credentials, failing with `401 invalid_client` (`Client authentication failed`).

### Design Pattern: Automated Startup Sync

Wherever an application does not natively read environment variables or Kubernetes Secrets for OIDC, **always automate the sync during container startup** (via an `initContainer` or startup script). The container consumes `{metadata.name}-oidc-credentials` as environment variables and synchronizes them into the application's configuration store before the main container starts.

### Implemented Examples in the Cluster

| Application            | Configuration Store                                             | Sync Mechanism                                                                                                                                                       | Reference Manifest                                               |
| ---------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Immich**             | PostgreSQL (`system_metadata.system-config`)                    | `postgresql-isready` init container updates `system_metadata` using `psql` and `jsonb_set` for `clientId`, `clientSecret`, and `issuerUrl` once PostgreSQL is ready. | `kubernetes/charts/apps/immich/templates/server/deployment.yaml` |
| **Kavita**             | JSON file (`/config/appsettings.json` on PVC)                   | `update-oidc-config` init container runs `jq` against `appsettings.json` to update `OpenIdConnectSettings` (`Authority`, `ClientId`, `Secret`).                      | `kubernetes/charts/apps/kavita/templates/deployment.yaml`        |
| **Jellyfin**           | XML file (`/config/plugins/configurations/SSO-Auth.xml` on PVC) | `provision-sso-config` init container generates/patches `SSO-Auth.xml` using environment variables.                                                                  | `kubernetes/charts/apps/jellyfin/templates/deployment.yaml`      |
| **Pomerium / Grafana** | Native Kubernetes Secret / Env                                  | Directly references `{metadata.name}-oidc-credentials` in Helm chart values or container `env`/`envFrom`.                                                            | `kubernetes/charts/core-services/pomerium/templates/global.yaml` |

## Component Overview

- **Pocket ID (Identity Provider):**
  - Manages users, groups, and authentication.
  - Issues tokens via OIDC.
- **Pomerium (IAP):**
  - Consumes OIDC tokens.
  - Enforces per-ingress authorization policies.
  - Provides a single, secure entry point for all web traffic.
- **Tinyauth (Legacy):**
  - Previously used for applications without native OIDC support. Native Pomerium integration is now preferred for all ingresses.

## Network Policy Requirements for OIDC Clients

Because Pocket ID discovery and token endpoints (`https://pocketid.<domain>`) are exposed through Pomerium, outbound requests to Pomerium VIPs are intercepted by Cilium's eBPF socket-level load balancing and DNATed to the Pomerium proxy pods on container port `8443`.

Any application workload utilizing OIDC MUST have the following egress rules in its `CiliumNetworkPolicy`:

```yaml
  egress:
    # Pomerium Ingress & VIPs (for PocketID OIDC)
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: pomerium
            app.kubernetes.io/name: pomerium
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
            - port: "8443"
              protocol: TCP
    - toCIDRSet:
        - cidr: {{ .Values.network.pomeriumIngress }}/32
        - cidr: {{ .Values.network.privateIngress }}/32
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
            - port: "8443"
              protocol: TCP
```
