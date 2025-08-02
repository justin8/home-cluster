# PostgreSQL Usage Guide

## Overview

This guide explains how to use PostgreSQL databases in your Pulumi home cluster setup using CloudNativePG (CNPG).

## Quick Start

### 1. Configuration

Add the following configuration variable to your `Pulumi.home-cluster.yaml`:

```yaml
config:
  home-cluster:postgres_backup_nfs_path: "/mnt/backups/postgres"
```

**Default Values (built into code):**

- PostgreSQL version: `15`
- Storage class: `longhorn`
- Default storage size: `10Gi`
- Backup retention: `7 days`

### 2. Using Database with TauApplication

The easiest way to add a database to your application is through the TauApplication constructor:

```typescript
import { TauApplication } from "../constructs/tauApplication";

export class MyApp extends TauApplication {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(
      name,
      {
        database: {
          enabled: true,
          extensions: ["uuid-ossp", "pgcrypto"], // Optional
          storageSize: "20Gi", // Optional, defaults to config value
        },
      },
      opts
    );

    // Your application deployment
    const deployment = new k8s.apps.v1.Deployment(
      `${name}-deployment`,
      {
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: "app",
                  image: "your-app:latest",
                  env: this.getAllEnvironmentVariables(), // Includes database env vars
                  // ... rest of container spec
                },
              ],
            },
          },
        },
      },
      { parent: this }
    );
  }
}
```

### 3. Using Database Utility Function Directly

For more control, you can use the database utility function directly:

```typescript
import { createDatabase } from "../utils/database";

const dbResult = createDatabase({
  name: "my-app-db",
  namespace: "my-namespace",
  extensions: ["uuid-ossp"],
  storageSize: "15Gi",
});

// Use dbResult.secret in your deployments
```

## Environment Variables

When using the TauApplication integration, the following environment variables are automatically injected:

- `DATABASE_URL` - Full PostgreSQL connection string
- `DB_HOST` - Database hostname
- `DB_PORT` - Database port (5432)
- `DB_NAME` - Database name
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password

## Database Features

### Supported PostgreSQL Extensions

You can specify PostgreSQL extensions when creating a database:

```typescript
database: {
  enabled: true,
  extensions: [
    "uuid-ossp",    // UUID generation
    "pgcrypto",     // Cryptographic functions
    "hstore",       // Key-value store
    "ltree",        // Tree-like structures
    "pg_trgm"       // Trigram matching
  ]
}
```

### Storage Configuration

- **Storage Class**: Uses Longhorn by default for persistent storage
- **Size**: Configurable per database (default: 10Gi)
- **Persistence**: Data persists across pod restarts and node failures

### Backup Configuration

- **Schedule**: Daily backups (configured in CNPG)
- **Storage**: Backups stored on NFS (path configurable)
- **Retention**: 7 days by default (configurable)

## Examples

### Basic Web Application with Database

```typescript
export class WebApp extends TauApplication {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(
      name,
      {
        database: {
          enabled: true,
          extensions: ["uuid-ossp"],
        },
      },
      opts
    );

    const deployment = new k8s.apps.v1.Deployment(
      `${name}-deployment`,
      {
        spec: {
          replicas: 1,
          selector: { matchLabels: this.labels },
          template: {
            metadata: { labels: this.labels },
            spec: {
              containers: [
                {
                  name: "web",
                  image: "node:18-alpine",
                  env: this.getAllEnvironmentVariables([{ name: "NODE_ENV", value: "production" }]),
                  ports: [{ containerPort: 3000 }],
                  resources: {
                    requests: { cpu: "100m", memory: "128Mi" },
                    limits: { cpu: "500m", memory: "512Mi" },
                  },
                },
              ],
            },
          },
        },
      },
      { parent: this }
    );

    // Create ingress for web access
    this.createIngress({ port: 3000 });
  }
}
```

### Multiple Databases per Application

```typescript
export class ComplexApp extends TauApplication {
  private readonly analyticsDb: DatabaseResult;

  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(
      name,
      {
        database: {
          enabled: true,
          name: "main-db",
        },
      },
      opts
    );

    // Create additional database for analytics
    this.analyticsDb = createDatabase(
      {
        name: "analytics-db",
        namespace: this.namespace,
        storageSize: "50Gi",
      },
      this
    );

    // Your deployment would use both databases
  }
}
```

## Troubleshooting

### Database Connection Issues

1. **Check if CNPG operator is running:**

   ```bash
   kubectl get pods -n cnpg-system
   ```

2. **Check database cluster status:**

   ```bash
   kubectl get clusters.postgresql.cnpg.io
   ```

3. **Check database logs:**
   ```bash
   kubectl logs -l cnpg.io/cluster=your-db-name
   ```

### Storage Issues

1. **Check Longhorn storage:**

   ```bash
   kubectl get pv | grep longhorn
   ```

2. **Check storage class:**
   ```bash
   kubectl get storageclass longhorn
   ```

### Backup Issues

1. **Check backup configuration:**

   ```bash
   kubectl describe clusters.postgresql.cnpg.io your-db-name
   ```

2. **Verify NFS mount:**
   ```bash
   # Check if NFS path is accessible from cluster nodes
   ```

## Best Practices

### Security

- Database credentials are automatically generated and stored in Kubernetes secrets
- Each application gets its own database user with full access to its database
- Databases are only accessible within the cluster

### Resource Management

- Start with default resource limits and adjust based on usage
- Monitor storage usage and increase as needed
- Use appropriate PostgreSQL extensions for your use case

### Backup and Recovery

- Backups are automated but test restore procedures regularly
- Keep backup retention period appropriate for your needs
- Monitor backup storage usage on NFS

### Development Workflow

1. Create your application extending TauApplication
2. Enable database in constructor options
3. Use `this.getAllEnvironmentVariables()` in container specs
4. Deploy and test database connectivity
5. Monitor resource usage and adjust as needed

## Configuration Reference

### Required Pulumi Configuration Variables

| Variable                   | Description                 |
| -------------------------- | --------------------------- |
| `postgres_backup_nfs_path` | NFS path for backup storage |

### Built-in Defaults

| Setting              | Default Value | Description                            |
| -------------------- | ------------- | -------------------------------------- |
| PostgreSQL Version   | `"15"`        | PostgreSQL major version               |
| Storage Class        | `"longhorn"`  | Storage class for PostgreSQL data      |
| Default Storage Size | `"10Gi"`      | Default storage size for new databases |
| Backup Retention     | `7 days`      | Backup retention period                |

### Per-Database Configuration Options

| Option        | Type     | Default      | Description                         |
| ------------- | -------- | ------------ | ----------------------------------- |
| `enabled`     | boolean  | `false`      | Enable database for the application |
| `name`        | string   | app name     | Database name                       |
| `extensions`  | string[] | `[]`         | PostgreSQL extensions to enable     |
| `storageSize` | string   | config value | Storage size for the database       |

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Review CNPG documentation: https://cloudnative-pg.io/
3. Check Kubernetes events: `kubectl get events`
4. Review application and database logs
