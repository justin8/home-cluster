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
