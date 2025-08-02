# Authelia Implementation Plan

## Overview
Implement Authelia as a core service to provide authentication and authorization for applications in the home cluster. This includes integrating with Traefik for middleware-based authentication.

## Prerequisites
- Traefik ingress controllers (public/private) - ✅ Already implemented
- Cert-manager for TLS certificates - ✅ Already implemented
- Redis or similar for session storage
- Database for user/group storage (PostgreSQL recommended)

## Implementation Steps

### Phase 1: Core Infrastructure Setup

#### Step 1.1: Add Authelia Helm Chart Configuration
- [ ] Add Authelia chart to renovate detection
- [ ] Research latest stable Authelia Helm chart version
- [ ] Identify official Helm repository URL

**Files to modify:**
- Research Authelia Helm chart options (official vs community)

#### Step 1.2: Create Authelia Core Service
- [ ] Create `src/core-services/authelia/index.ts`
- [ ] Define `AutheliaArgs` interface with required configuration
- [ ] Implement `Authelia` class extending `pulumi.ComponentResource`
- [ ] Add namespace creation
- [ ] Configure Helm chart deployment

**Configuration requirements:**
- Domain configuration
- Session storage (Redis)
- User database configuration
- OIDC/OAuth providers (optional)
- SMTP settings for notifications
- Access control rules

#### Step 1.3: Add Dependencies
- [ ] Add Redis deployment for session storage
- [ ] Consider PostgreSQL for user storage (or use file-based initially)
- [ ] Create necessary secrets for database connections

### Phase 2: Traefik Integration

#### Step 2.1: Create Authelia Middleware Utilities
- [ ] Create `src/utils/authelia.ts` helper functions
- [ ] Implement `createAutheliaMiddleware()` function
- [ ] Implement `createForwardAuthMiddleware()` function
- [ ] Add middleware configuration types

**Utility functions to implement:**
```typescript
// Generate Authelia middleware configuration
function createAutheliaMiddleware(name: string, autheliaUrl: string): object

// Generate forward auth middleware for Traefik
function createForwardAuthMiddleware(name: string, autheliaUrl: string): object

// Generate auth annotations for ingresses
function getAutheliaAnnotations(middlewareName: string): object
```

#### Step 2.2: Update TauApplication Base Class
- [ ] Modify `src/constructs/tauApplication.ts`
- [ ] Add optional authentication configuration to `CreateIngressArgs`
- [ ] Implement auth middleware injection in `createIngress()` method
- [ ] Add helper methods for auth configuration

**TauApplication enhancements:**
```typescript
interface CreateIngressArgs {
  // ... existing args
  auth?: {
    enabled: boolean;
    middleware?: string;
    bypassPaths?: string[];
  };
}
```

#### Step 2.3: Update Traefik Configuration
- [ ] Modify ingress controllers to support Authelia middleware
- [ ] Add Authelia service discovery configuration
- [ ] Configure forward auth endpoints

### Phase 3: Configuration and Secrets Management

#### Step 3.1: Create Configuration Structure
- [ ] Define Authelia configuration YAML structure
- [ ] Create ConfigMap for Authelia configuration
- [ ] Set up user database (initial file-based approach)
- [ ] Configure access control rules

#### Step 3.2: Secrets Management
- [ ] Create secrets for:
  - JWT signing key
  - Session encryption key
  - Database credentials (if using database)
  - SMTP credentials (if using email)
- [ ] Use SOPS for secret encryption
- [ ] Create secret deployment in Authelia service

#### Step 3.3: Domain and DNS Configuration
- [ ] Configure Authelia subdomain (e.g., `auth.domain.com`)
- [ ] Update DNS records
- [ ] Configure TLS certificate

### Phase 4: Integration with Existing Services

#### Step 4.1: Update Main Index
- [ ] Add Authelia to core services in `index.ts`
- [ ] Configure dependency order (after cert-manager, before applications)
- [ ] Export Authelia service for application use

#### Step 4.2: Create Demo Integration
- [ ] Update demo-app to use Authelia authentication
- [ ] Test authentication flow
- [ ] Verify middleware functionality

#### Step 4.3: Update Constants
- [ ] Add Authelia-related constants to `src/constants.ts`
- [ ] Define default middleware names
- [ ] Add auth-related configuration keys

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

## File Structure

```
src/
├── core-services/
│   └── authelia/
│       └── index.ts                 # Main Authelia service
├── constructs/
│   └── tauApplication.ts           # Updated with auth support
├── utils/
│   ├── index.ts                    # Export auth utilities
│   └── authelia.ts                 # Auth middleware helpers
├── constants.ts                    # Auth-related constants
└── applications/
    └── demo-app/
        └── index.ts                # Updated to use auth
```

## Configuration Examples

### Authelia Service Configuration
```typescript
const authelia = new Authelia("authelia", {
  domain: config.require("domain"),
  subdomain: "auth",
  sessionStorage: {
    type: "redis",
    host: "redis-service",
  },
  userStorage: {
    type: "file", // or "postgresql"
  },
  smtp: {
    host: config.requireSecret("smtp_host"),
    username: config.requireSecret("smtp_username"),
    password: config.requireSecret("smtp_password"),
  },
});
```

### TauApplication Usage
```typescript
// In application
this.createIngress({
  port: 80,
  auth: {
    enabled: true,
    bypassPaths: ["/health", "/metrics"],
  },
});
```

## Dependencies and Order

1. **MetalLB** (load balancer)
2. **Cert-Manager** (TLS certificates)
3. **Ingress Controllers** (Traefik)
4. **Redis** (session storage)
5. **Authelia** ← New core service
6. **Applications** (with auth support)

## Security Considerations

- [ ] Use strong JWT signing keys
- [ ] Configure proper session timeouts
- [ ] Set up secure cookie settings
- [ ] Configure HTTPS-only access
- [ ] Implement proper access control rules
- [ ] Regular secret rotation strategy

## Rollback Plan

- [ ] Document current ingress configurations
- [ ] Create feature flag for auth enablement
- [ ] Test rollback procedures
- [ ] Maintain backward compatibility in TauApplication

## Success Criteria

- [ ] Authelia deploys successfully as core service
- [ ] Traefik middleware integration works
- [ ] Applications can enable/disable auth easily
- [ ] Authentication flow works end-to-end
- [ ] Session management functions correctly
- [ ] Bypass paths work as expected
- [ ] Documentation is complete and accurate

## Estimated Timeline

- **Phase 1**: 2-3 hours (Core service setup)
- **Phase 2**: 3-4 hours (Traefik integration)
- **Phase 3**: 2-3 hours (Configuration and secrets)
- **Phase 4**: 1-2 hours (Integration)
- **Phase 5**: 2-3 hours (Testing and documentation)

**Total**: 10-15 hours

## Notes

- Start with file-based user storage for simplicity
- Consider PostgreSQL for production user storage
- Implement gradual rollout to existing applications
- Monitor performance impact of auth middleware
- Plan for future OIDC/OAuth provider integration
