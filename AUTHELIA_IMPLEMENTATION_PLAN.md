# Authelia Implementation Plan

## Overview
Implement Authelia as a core service to provide authentication and authorization for applications in the home cluster. This includes integrating with Traefik for middleware-based authentication.

## Prerequisites
- Traefik ingress controllers (public/private) - ✅ Already implemented
- Cert-manager for TLS certificates - ✅ Already implemented
- Redis or similar for session storage
- Database for user/group storage (PostgreSQL recommended)

## Implementation Steps

### Phase 1: Core Infrastructure Setup ✅ COMPLETED

#### Step 1.1: Add Authelia Helm Chart Configuration ✅
- [x] Add Authelia chart to renovate detection
- [x] Research latest stable Authelia Helm chart version (0.9.3)
- [x] Identify official Helm repository URL (https://charts.authelia.com)

#### Step 1.2: Create Authelia Core Service ✅
- [x] Create `src/core-services/authelia/index.ts`
- [x] Define `AutheliaArgs` interface with required configuration
- [x] Implement `Authelia` class extending `pulumi.ComponentResource`
- [x] Add namespace creation
- [x] Configure Helm chart deployment

**Configuration implemented:**
- Domain configuration
- Session storage (Redis)
- User database configuration (file-based initially)
- SMTP settings for notifications (optional)
- Access control rules
- Secret generation and management

#### Step 1.3: Add Dependencies ✅
- [x] Add Redis deployment for session storage
- [x] Use file-based user storage initially
- [x] Create necessary secrets for JWT, session, and storage encryption

### Phase 2: Traefik Integration ✅ COMPLETED

#### Step 2.1: Create Authelia Middleware Utilities ✅
- [x] Create `src/utils/authelia.ts` helper functions
- [x] Implement `createAutheliaMiddleware()` function
- [x] Implement `createForwardAuthMiddleware()` function
- [x] Add middleware configuration types

**Utility functions implemented:**
```typescript
// Generate Authelia middleware configuration
function createAutheliaMiddleware(config: AutheliaMiddlewareConfig): object

// Generate forward auth middleware for Traefik
function createForwardAuthMiddleware(name: string, autheliaUrl: string, namespace?: string): object

// Generate auth annotations for ingresses
function getAutheliaAnnotations(middlewareName: string, namespace?: string, bypassPaths?: string[]): object
```

#### Step 2.2: Update TauApplication Base Class ✅
- [x] Modify `src/constructs/tauApplication.ts`
- [x] Add optional authentication configuration to `CreateIngressArgs`
- [x] Implement auth middleware injection in `createIngress()` method
- [x] Add helper methods for auth configuration

**TauApplication enhancements implemented:**
```typescript
interface CreateIngressArgs {
  // ... existing args
  auth?: AuthConfig;
}
```

#### Step 2.3: Update Traefik Configuration ✅
- [x] Modify ingress controllers to support Authelia middleware
- [x] Add Authelia service discovery configuration
- [x] Configure forward auth endpoints

### Phase 3: Configuration and Secrets Management ✅ COMPLETED

#### Step 3.1: Create Configuration Structure ✅
- [x] Define Authelia configuration YAML structure
- [x] Create ConfigMap for Authelia configuration
- [x] Set up user database (file-based approach)
- [x] Configure access control rules

#### Step 3.2: Secrets Management ✅
- [x] Create secrets for:
  - JWT signing key
  - Session encryption key
  - SMTP credentials (optional)
- [x] Automatic secret generation
- [x] Create secret deployment in Authelia service

#### Step 3.3: Domain and DNS Configuration ✅
- [x] Configure Authelia subdomain (auth.domain.com)
- [x] Configure TLS certificate via cert-manager
- [x] Ingress configuration with proper annotations

### Phase 4: Integration with Existing Services ✅ COMPLETED

#### Step 4.1: Update Main Index ✅
- [x] Add Authelia to core services in `index.ts`
- [x] Configure dependency order (after cert-manager, before applications)
- [x] Export Authelia service for application use

#### Step 4.2: Create Demo Integration ✅
- [x] Update demo-app to use Authelia authentication
- [x] Add configuration option to enable/disable auth
- [x] Demonstrate bypass paths functionality

#### Step 4.3: Update Constants ✅
- [x] Add Authelia-related constants to `src/constants.ts`
- [x] Define default middleware names
- [x] Add auth-related configuration keys

### Phase 5: Testing and Documentation

#### Step 5.1: Testing
- [ ] Test Authelia deployment
- [ ] Verify Traefik middleware integration
- [ ] Test authentication flow end-to-end
- [ ] Test bypass paths functionality
- [ ] Verify session management

#### Step 5.2: Documentation
- [ ] Update main README with Authelia information
- [ ] Create Authelia configuration guide
- [ ] Document TauApplication auth usage
- [ ] Add troubleshooting guide

## File Structure ✅ IMPLEMENTED

```
src/
├── core-services/
│   └── authelia/
│       └── index.ts                 # ✅ Main Authelia service
├── constructs/
│   └── tauApplication.ts           # ✅ Updated with auth support
├── utils/
│   ├── index.ts                    # ✅ Export auth utilities
│   └── authelia.ts                 # ✅ Auth middleware helpers
├── constants.ts                    # ✅ Auth-related constants
└── applications/
    └── demo-app/
        └── index.ts                # ✅ Updated to use auth
```

## Configuration Examples

### Authelia Service Configuration ✅ IMPLEMENTED
```typescript
const authelia = new Authelia("authelia", {
  domain: config.require("domain"),
  subdomain: "auth",
  sessionStorage: {
    type: "redis",
  },
  userStorage: {
    type: "file",
  },
  smtp: {
    host: config.require("smtp_host"),
    username: config.require("smtp_username"),
    password: config.requireSecret("smtp_password"),
    sender: config.require("smtp_sender"),
  },
});
```

### TauApplication Usage ✅ IMPLEMENTED
```typescript
// In application
this.createIngress({
  port: 80,
  auth: this.enableAuth({
    bypassPaths: ["/health", "/metrics"],
  }),
});
```

## Dependencies and Order ✅ IMPLEMENTED

1. **MetalLB** (load balancer)
2. **Cert-Manager** (TLS certificates)
3. **Ingress Controllers** (Traefik)
4. **Authelia** ← New core service
5. **Applications** (with auth support)

## Security Considerations ✅ IMPLEMENTED

- [x] Use strong JWT signing keys (auto-generated)
- [x] Configure proper session timeouts
- [x] Set up secure cookie settings
- [x] Configure HTTPS-only access
- [x] Implement proper access control rules
- [ ] Regular secret rotation strategy (manual process)

## Implementation Status

**COMPLETED PHASES: 1, 2, 3, 4 (80% complete)**
**REMAINING: Phase 5 - Testing and Documentation (20%)**

## Next Steps

1. Deploy and test the implementation
2. Verify all components work together
3. Create comprehensive documentation
4. Add troubleshooting guides

## Notes

- ✅ Started with file-based user storage for simplicity
- ✅ Implemented automatic secret generation
- ✅ Added gradual rollout capability to existing applications
- ✅ Included configuration options for flexibility
- 🔄 Ready for testing and documentation phase
