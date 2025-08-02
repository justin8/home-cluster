# PostgreSQL Clusters with CloudNativePG - Requirements Document

## Overview
Add PostgreSQL database cluster support to the home-cluster Pulumi project using CloudNativePG (CNPG) operator, with a utility function for easy database provisioning for applications.

## Goals
1. Deploy and manage PostgreSQL instances using CloudNativePG operator
2. Provide a simple utility function for applications to request databases
3. Ensure data persistence with Longhorn storage and NFS backups
4. Integrate with existing TauApplication pattern
5. Support automatic cleanup and restore capabilities

## Requirements

### 1. Core Infrastructure

#### 1.1 CNPG Operator Deployment
- Deploy CloudNativePG operator as a core service
- Operator should be deployed before any applications that need databases
- Include necessary RBAC permissions and CRDs
- Support operator upgrades

#### 1.2 PostgreSQL Instance Management
- Support creating single PostgreSQL instances with configurable:
  - Storage size (using Longhorn storage class)
  - PostgreSQL version
  - Resource limits (CPU/Memory) - optimized for low resource usage
- Default instance configuration for typical small workloads
- Instances should be able to restart on different nodes using Longhorn volumes
- Support for instance monitoring health checks

#### 1.3 Storage Integration
- Use Longhorn storage class for PostgreSQL data volumes
- NFS backup storage configured via Pulumi config variable
- WAL archiving to NFS for point-in-time recovery capability
- Automatic volume attachment to new nodes on instance restart

### 2. Database Provisioning Utility

#### 2.1 Database Creation Function
Create a utility function with the following signature:
```typescript
interface DatabaseConfig {
  name: string;
  namespace?: string; // Optional: specify namespace (default: "default")
  owner?: string;
  instance?: string; // Optional: specify which instance to use
  extensions?: string[]; // PostgreSQL extensions to enable
  storageSize?: string; // Default: "10Gi"
}

function createDatabase(config: DatabaseConfig): DatabaseResult
```

#### 2.2 Database Result Interface
```typescript
interface DatabaseResult {
  connectionString: pulumi.Output<string>;
  host: pulumi.Output<string>;
  port: pulumi.Output<number>;
  database: string;
  username: pulumi.Output<string>;
  password: pulumi.Output<string>;
  secret: k8s.core.v1.Secret; // Kubernetes secret with connection details
}
```

#### 2.3 Instance Selection Strategy
- Create dedicated PostgreSQL instance per application by default
- Support for shared instances if explicitly specified
- Automatic instance creation with sensible defaults
- Instance naming convention: `postgres-{app-name}` or custom name
- Instances created in specified namespace (default: "default")
- Database instances and applications must be in the same namespace

### 3. Integration with TauApplication

#### 3.1 TauApplication Enhancement
- Add optional database configuration to TauApplication constructor
- Automatically create database in the same namespace as the application
- Inject connection details as environment variables
- Support multiple databases per application if needed
- Database and application must be in the same namespace for security and simplicity

#### 3.2 Environment Variable Injection
Standard environment variables for database connections:
- `DATABASE_URL` - Full connection string
- `DB_HOST` - Database host (simple service name within namespace)
- `DB_PORT` - Database port
- `DB_NAME` - Database name
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password

### 4. Security and Access Control

#### 4.1 Credential Management
- Generate secure random passwords for each database
- Store credentials in Kubernetes secrets in the same namespace as the database instance
- Each application gets its own database user with full access to its database
- Support credential rotation (manual process)
- Simple namespace-local secret access (no cross-namespace permissions needed)

#### 4.2 Network Security
- Database instances accessible only within cluster
- No external access required
- TLS encryption for connections (if supported by CNPG)

### 5. Backup and Recovery

#### 5.1 Automated Backups
- Daily scheduled backups using CNPG backup capabilities
- Backups stored on NFS share (configured via Pulumi config)
- Simple retention policy (configurable, default: 7 days)
- Backup naming convention for easy identification

#### 5.2 Restore Capabilities
- Support for restoring from backup when recreating a service
- Point-in-time recovery using WAL archives
- Manual restore process (no automatic restore on service recreation)
- Backup verification through restore testing

### 6. Lifecycle Management

#### 6.1 Service Cleanup
- Automatic cleanup of database instances when applications are deleted
- Namespace-scoped cleanup (databases only cleaned up within their own namespace)
- Backup creation before cleanup (safety measure)
- Configurable cleanup behavior (immediate vs. delayed)
- Simple cleanup process since database and application are always co-located

#### 6.2 Health Monitoring
- Basic health checks for PostgreSQL instances
- Instance restart capability on failure
- Simple logging for troubleshooting

### 7. Configuration Management

#### 7.1 Pulumi Configuration
New configuration parameters:
- `postgres_backup_nfs_path` - NFS path for backup storage
- `postgres_storage_class` - Longhorn storage class name (default: "longhorn")
- `postgres_version` - Default PostgreSQL version (default: "15")
- `postgres_default_storage_size` - Default storage size (default: "10Gi")
- `postgres_backup_retention_days` - Backup retention period (default: 7)

#### 7.2 Instance Templates
- Single default template optimized for low resource usage
- Configurable resource limits per instance if needed

## Implementation Plan

### Phase 1: Core Infrastructure
1. Create CNPG operator deployment in core-services
2. Implement basic PostgreSQL instance creation with Longhorn storage
3. Basic database provisioning utility

### Phase 2: Application Integration
1. Enhance TauApplication with database support
2. Implement automatic environment variable injection
3. Create example application using the database utility

### Phase 3: Backup and Lifecycle
1. NFS backup implementation with daily scheduling
2. Service cleanup and restore capabilities
3. Basic health monitoring

### Phase 4: Documentation and Testing
1. Usage documentation and examples
2. Backup/restore procedures
3. Testing with sample applications

## File Structure
```
src/
├── core-services/
│   └── cnpg/
│       ├── index.ts
│       └── operator.ts
├── constructs/
│   └── postgresInstance.ts
├── utils/
│   ├── database.ts
│   └── index.ts (export database utilities)
└── applications/
    └── example-with-db/ (example implementation)
```

## Dependencies
- CloudNativePG operator
- PostgreSQL container images
- Storage provisioner (existing NFS or local storage)

## Success Criteria
1. Applications can request databases with a single function call
2. Database instances persist data across node restarts using Longhorn
3. Daily backups are automatically created and stored on NFS
4. Integration with TauApplication is seamless
5. Database cleanup happens automatically when services are deleted
6. Restore from backup is possible (manual process)

## Risks and Considerations
1. Longhorn storage performance for PostgreSQL workloads
2. NFS backup storage capacity and performance
3. Network latency between applications and database instances
4. Resource allocation for low-usage database instances
5. Backup integrity and restore testing procedures
6. Handling of database instance failures and restarts
7. Namespace organization and potential resource conflicts
8. Ensuring proper cleanup when entire namespaces are deleted

## Open Questions
1. **Vertical Scaling**: CNPG does support some level of vertical scaling by updating resource limits, but it requires a restart. Should we implement this as a manual configuration update process?

2. **Backup Verification**: Should we implement automated backup verification by periodically testing restores, or rely on manual verification?

3. **Database Extensions**: Should we have a predefined list of commonly used PostgreSQL extensions, or allow applications to specify any extension?

4. **Instance Naming**: Should database instances be named after the application (`postgres-{app-name}`) or allow custom naming?

5. **Shared vs Dedicated**: While the default is dedicated instances, should we provide a simple way to opt into a shared instance for very lightweight applications?

6. **Namespace Detection**: Should the database utility automatically detect the current namespace context from the TauApplication parent, or always require explicit namespace specification in the config?

7. **Namespace Organization**: Should we provide any conventions or recommendations for organizing applications and their databases across namespaces (e.g., one namespace per application vs. grouping related applications)?
