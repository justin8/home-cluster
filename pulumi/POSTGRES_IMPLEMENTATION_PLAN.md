# PostgreSQL Clusters Implementation Plan

## Overview
This document provides a detailed step-by-step implementation plan for adding PostgreSQL support using CloudNativePG (CNPG) to the home-cluster Pulumi project.

## Prerequisites
- Longhorn storage is installed and working in the cluster
- NFS server is accessible for backups
- Pulumi configuration variables are set

## Phase 1: Core Infrastructure Setup

### Step 1.1: Install CloudNativePG Operator
**Files to create:**
- `src/core-services/cnpg/index.ts`
- `src/core-services/cnpg/operator.ts`

**Implementation details:**

#### `src/core-services/cnpg/operator.ts`
```typescript
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export class CNPGOperator extends pulumi.ComponentResource {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super("CNPGOperator", name, {}, opts);

    // Create namespace for CNPG operator
    const namespace = new k8s.core.v1.Namespace("cnpg-system", {
      metadata: { name: "cnpg-system" }
    }, { parent: this });

    // Install CNPG operator using Helm chart
    const cnpgChart = new k8s.helm.v3.Chart("cnpg-operator", {
      chart: "cloudnative-pg",
      version: "0.18.0", // Check for latest version
      namespace: namespace.metadata.name,
      repositoryOpts: {
        repo: "https://cloudnative-pg.github.io/charts"
      },
      values: {
        // Operator configuration
        replicaCount: 1,
        resources: {
          limits: { cpu: "100m", memory: "200Mi" },
          requests: { cpu: "100m", memory: "200Mi" }
        }
      }
    }, { parent: this, dependsOn: [namespace] });
  }
}
```

#### `src/core-services/cnpg/index.ts`
```typescript
export { CNPGOperator } from "./operator";
```

**Tasks:**
1. Research latest CNPG operator version and Helm chart
2. Create the operator deployment files
3. Test operator installation
4. Verify CRDs are installed correctly

### Step 1.2: Update Main Index to Include CNPG
**File to modify:** `index.ts`

**Changes:**
```typescript
// Add import
import { CNPGOperator } from "./src/core-services/cnpg";

// Add after existing core services
const cnpgOperator = new CNPGOperator("cnpg-operator");

// Update coreServices array
const coreServices = [metallb, certManager, nfsCsi, ingressControllers, cnpgOperator];
```

### Step 1.3: Add Pulumi Configuration Variables
**File to modify:** `Pulumi.home-cluster.yaml`

**New configuration variables:**
```yaml
config:
  # ... existing config ...
  home-cluster:postgres_backup_nfs_path: "/mnt/backups/postgres"
  home-cluster:postgres_storage_class: "longhorn"
  home-cluster:postgres_version: "15"
  home-cluster:postgres_default_storage_size: "10Gi"
  home-cluster:postgres_backup_retention_days: "7"
```

## Phase 2: PostgreSQL Instance Management

### Step 2.1: Create PostgreSQL Instance Construct
**File to create:** `src/constructs/postgresInstance.ts`

**Implementation outline:**
```typescript
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

interface PostgresInstanceArgs {
  namespace?: string;
  storageSize?: string;
  version?: string;
  extensions?: string[];
}

export class PostgresInstance extends pulumi.ComponentResource {
  public readonly connectionSecret: k8s.core.v1.Secret;
  public readonly serviceName: pulumi.Output<string>;
  public readonly host: pulumi.Output<string>;
  public readonly port: pulumi.Output<number>;

  constructor(name: string, args: PostgresInstanceArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super("PostgresInstance", name, {}, opts);

    const config = new pulumi.Config();
    const namespace = args.namespace || "default";
    const storageSize = args.storageSize || config.get("postgres_default_storage_size") || "10Gi";
    const version = args.version || config.get("postgres_version") || "15";
    const storageClass = config.require("postgres_storage_class");
    const backupNfsPath = config.require("postgres_backup_nfs_path");
    const retentionDays = config.get("postgres_backup_retention_days") || "7";

    // Create PostgreSQL cluster using CNPG CRD
    // Implementation details below...
  }
}
```

**Key components to implement:**
1. CNPG Cluster custom resource
2. Backup configuration with NFS storage
3. Connection secret generation
4. Service exposure
5. Storage configuration with Longhorn

**Tasks:**
1. Study CNPG Cluster CRD specification
2. Implement cluster creation with proper storage configuration
3. Set up backup configuration pointing to NFS
4. Create connection secrets with standard naming
5. Test instance creation and connectivity

### Step 2.2: Implement Backup Configuration
**Within PostgresInstance constructor:**

```typescript
// Backup configuration
const backupConfig = {
  retentionPolicy: `${retentionDays}d`,
  data: {
    compression: "gzip",
    encryption: "AES256"
  },
  wal: {
    compression: "gzip",
    encryption: "AES256"
  }
};

// NFS backup storage configuration
const backupStorage = {
  storageClass: "nfs-client", // Assuming NFS storage class exists
  size: "50Gi" // Configurable backup storage size
};
```

**Tasks:**
1. Configure CNPG backup to use NFS storage
2. Set up daily backup schedule
3. Implement retention policy
4. Test backup creation and storage

## Phase 3: Database Utility Function

### Step 3.1: Create Database Utility
**File to create:** `src/utils/database.ts`

**Implementation structure:**
```typescript
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { PostgresInstance } from "../constructs/postgresInstance";

export interface DatabaseConfig {
  name: string;
  namespace?: string;
  owner?: string;
  instance?: string;
  extensions?: string[];
  storageSize?: string;
}

export interface DatabaseResult {
  connectionString: pulumi.Output<string>;
  host: pulumi.Output<string>;
  port: pulumi.Output<number>;
  database: string;
  username: pulumi.Output<string>;
  password: pulumi.Output<string>;
  secret: k8s.core.v1.Secret;
}

export function createDatabase(config: DatabaseConfig): DatabaseResult {
  // Implementation steps:
  // 1. Determine instance name (default: postgres-{config.name})
  // 2. Create or reference PostgreSQL instance
  // 3. Create database within instance
  // 4. Create user credentials
  // 5. Return connection details
}
```

**Key implementation details:**
1. Instance naming convention: `postgres-{app-name}`
2. Database naming: same as config.name
3. User naming: `{database}_user`
4. Secret naming: `{database}-postgres-credentials`

**Tasks:**
1. Implement instance creation/lookup logic
2. Create database and user within PostgreSQL instance
3. Generate secure random passwords
4. Create Kubernetes secrets with connection details
5. Return structured DatabaseResult

### Step 3.2: Update Utils Index
**File to modify:** `src/utils/index.ts`

**Changes:**
```typescript
export { createDatabase, DatabaseConfig, DatabaseResult } from "./database";
```

## Phase 4: TauApplication Integration

### Step 4.1: Enhance TauApplication Constructor
**File to modify:** `src/constructs/tauApplication.ts`

**New interface:**
```typescript
interface DatabaseOptions {
  enabled: boolean;
  name?: string;
  extensions?: string[];
  storageSize?: string;
}

// Add to TauApplication constructor options
interface TauApplicationOptions {
  database?: DatabaseOptions;
}
```

**Implementation changes:**
1. Add optional database parameter to constructor
2. Call createDatabase when database.enabled is true
3. Store database result for environment variable injection
4. Ensure database is created in same namespace as application

### Step 4.2: Environment Variable Injection
**Within TauApplication class:**

```typescript
protected getDatabaseEnvironmentVariables(): k8s.types.input.core.v1.EnvVar[] {
  if (!this.databaseResult) return [];
  
  return [
    { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: this.databaseResult.secret.metadata.name, key: "DATABASE_URL" }}},
    { name: "DB_HOST", valueFrom: { secretKeyRef: { name: this.databaseResult.secret.metadata.name, key: "DB_HOST" }}},
    { name: "DB_PORT", valueFrom: { secretKeyRef: { name: this.databaseResult.secret.metadata.name, key: "DB_PORT" }}},
    { name: "DB_NAME", valueFrom: { secretKeyRef: { name: this.databaseResult.secret.metadata.name, key: "DB_NAME" }}},
    { name: "DB_USER", valueFrom: { secretKeyRef: { name: this.databaseResult.secret.metadata.name, key: "DB_USER" }}},
    { name: "DB_PASSWORD", valueFrom: { secretKeyRef: { name: this.databaseResult.secret.metadata.name, key: "DB_PASSWORD" }}}
  ];
}
```

**Tasks:**
1. Modify TauApplication constructor to accept database options
2. Integrate createDatabase call when enabled
3. Implement environment variable injection method
4. Update deployment templates to include database env vars
5. Test integration with sample application

## Phase 5: Example Implementation

### Step 5.1: Create Example Application
**File to create:** `src/applications/postgres-example/index.ts`

**Implementation:**
```typescript
import { TauApplication } from "../../constructs/tauApplication";
import * as k8s from "@pulumi/kubernetes";

export class PostgresExample extends TauApplication {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(name, {
      database: {
        enabled: true,
        extensions: ["uuid-ossp", "pgcrypto"]
      }
    }, opts);

    // Create a simple web application that connects to PostgreSQL
    const deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
      spec: {
        replicas: 1,
        selector: { matchLabels: this.labels },
        template: {
          metadata: { labels: this.labels },
          spec: {
            containers: [{
              name: "app",
              image: "postgres:15-alpine", // Simple psql client for testing
              command: ["sleep", "3600"], // Keep container running
              env: this.getDatabaseEnvironmentVariables(),
              resources: {
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "100m", memory: "128Mi" }
              }
            }]
          }
        }
      }
    }, { parent: this });
  }
}
```

### Step 5.2: Add Example to Main Index
**File to modify:** `index.ts`

**Changes:**
```typescript
import { PostgresExample } from "./src/applications/postgres-example";

// Add after existing applications
new PostgresExample("postgres-example", {
  dependsOn: coreServices,
});
```

## Phase 6: Testing and Validation

### Step 6.1: Unit Testing
**Tasks:**
1. Test CNPG operator deployment
2. Test PostgreSQL instance creation
3. Test database utility function
4. Test TauApplication integration
5. Verify backup configuration

### Step 6.2: Integration Testing
**Test scenarios:**
1. Create application with database
2. Verify database connectivity from application
3. Test backup creation and storage
4. Test application deletion and cleanup
5. Test database restoration from backup

### Step 6.3: Documentation Testing
**Tasks:**
1. Verify all configuration variables work
2. Test example application deployment
3. Validate backup and restore procedures
4. Document any issues or limitations found

## Phase 7: Documentation and Cleanup

### Step 7.1: Usage Documentation
**File to create:** `docs/POSTGRES_USAGE.md`

**Content outline:**
1. Quick start guide
2. Configuration options
3. Database utility function usage
4. TauApplication integration examples
5. Backup and restore procedures
6. Troubleshooting guide

### Step 7.2: Code Documentation
**Tasks:**
1. Add comprehensive JSDoc comments
2. Document all interfaces and types
3. Add inline code comments for complex logic
4. Update README.md with PostgreSQL features

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create CNPG operator deployment
- [ ] Add operator to main index
- [ ] Add Pulumi configuration variables
- [ ] Test operator installation

### Phase 2: PostgreSQL Instance Management
- [ ] Create PostgresInstance construct
- [ ] Implement backup configuration
- [ ] Test instance creation
- [ ] Verify backup functionality

### Phase 3: Database Utility Function
- [ ] Create database utility function
- [ ] Implement instance management logic
- [ ] Test database creation
- [ ] Update utils index

### Phase 4: TauApplication Integration
- [ ] Enhance TauApplication constructor
- [ ] Implement environment variable injection
- [ ] Test integration
- [ ] Update existing applications if needed

### Phase 5: Example Implementation
- [ ] Create example application
- [ ] Add to main index
- [ ] Test deployment
- [ ] Verify database connectivity

### Phase 6: Testing and Validation
- [ ] Unit testing
- [ ] Integration testing
- [ ] Performance testing
- [ ] Security validation

### Phase 7: Documentation and Cleanup
- [ ] Create usage documentation
- [ ] Add code documentation
- [ ] Update README
- [ ] Final code review

## Estimated Timeline
- **Phase 1**: 1-2 days
- **Phase 2**: 2-3 days
- **Phase 3**: 1-2 days
- **Phase 4**: 1-2 days
- **Phase 5**: 1 day
- **Phase 6**: 2-3 days
- **Phase 7**: 1 day

**Total estimated time**: 9-14 days

## Risk Mitigation
1. **CNPG Version Compatibility**: Test with latest stable version first
2. **Storage Performance**: Monitor Longhorn performance with PostgreSQL workloads
3. **Backup Reliability**: Implement backup verification procedures
4. **Resource Usage**: Monitor resource consumption and adjust defaults
5. **Network Connectivity**: Test database connectivity across different scenarios

## Success Criteria
- [ ] CNPG operator deploys successfully
- [ ] PostgreSQL instances can be created via utility function
- [ ] TauApplication integration works seamlessly
- [ ] Backups are created and stored on NFS
- [ ] Example application connects to database successfully
- [ ] Cleanup works properly when applications are deleted
- [ ] Documentation is complete and accurate
