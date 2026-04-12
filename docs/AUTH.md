# Authentication Architecture

The cluster uses [Pocket ID](https://github.com/pocket-id/pocket-id) as the central Identity Provider (IdP) for all services. Authentication is enforced either natively by applications that support OIDC or via **Tinyauth**, which acts as an authenticating reverse proxy for applications that do not.

## Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Authentication Flow                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    User     │    │ Pocket ID   │    │  Tinyauth   │    │   Service   │
│  (Browser)  │    │ (Identity   │    │ (Auth Proxy)│    │ (Protected  │
│             │    │  Provider)  │    │             │    │  Provider)  │
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
│ • Issues access tokens and ID tokens                                            │
│                                                                                 │
│ Tinyauth (Authentication Proxy):                                                │
│ • Acts as OAuth2 client to Pocket ID                                            │
│ • Protects services that don't have native OAuth2 support                       │
│ • Handles OAuth2 flow and session management                                    │
│ • Proxies authenticated requests to backend services                            │
│                                                                                 │
│ Protected Services:                                                             │
│ • Applications that need authentication but don't support OAuth2                │
│ • Receive requests with user context from Tinyauth                              │
│ • Can trust that all incoming requests are authenticated                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Managing OIDC Clients

OIDC clients are managed declaratively using the `PocketIDOIDCClient` custom resource provided by the `pocket-id-operator`.

### Creating a Client

To create a new OIDC client, add a `PocketIDOIDCClient` manifest to your application's Helm chart:

```yaml
apiVersion: pocketid.internal/v1alpha1
kind: PocketIDOIDCClient
metadata:
  name: my-app
  namespace: { { .Release.Namespace } }
spec:
  isPublic: false # Set to true for public clients (no secret)
  callbackUrls:
    - https://my-app.{{ .Values.domain }}/callback
```

### Credentials Secret

The operator automatically creates and maintains a Kubernetes Secret containing the client credentials.

- **Secret Name:** `{metadata.name}-oidc-credentials` (e.g., `my-app-oidc-credentials`)
- **Namespace:** Same as the `PocketIDOIDCClient` resource.

The following keys are populated in the secret:

- `client_id`
- `client_secret` (only for confidential clients)
- `issuer_url`
- `discovery_url`
- `authorization_url`
- `token_url`
- `userinfo_url`
- `jwks_url`
- `end_session_url`
- `callback_urls` (JSON array of allowed callbacks)

### Manual Setup (Bootstrap)

On a clean cluster, you must first complete the one-time setup for Pocket ID:

1. Navigate to `https://pocketid.${domain}/setup`
2. Create the admin user
3. The operator will then be able to reconcile and create configured clients automatically.
