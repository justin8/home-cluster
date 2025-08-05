# PostgreSQL Usage Guide

## Overview

This guide explains how to use PostgreSQL databases in your Pulumi home cluster setup using CloudNativePG (CNPG).

## Quick Start

### 1. Using Database with TauApplication

The easiest way to add a database to your application is through the TauApplication constructor. It simplifies setup and provides helper functions to get connection details as environment variables.

```typescript
import { TauApplication } from "../constructs/tauApplication";

export class MyApp extends TauApplication {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(
      name,
      {
        database: {
          name: "my-app-db", // Required
          extensions: ["uuid-ossp", "pgcrypto"], // Optional
          storageSize: "20Gi", // Optional
          version: "17", // Optional
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

### 2. Using Database Utility Function Directly

For more control, you can use the database utility function directly.

```typescript
import { createDatabase } from "../utils/database";

const dbResult = createDatabase({
  name: "my-app-db", // Required
  namespace: "my-namespace",
  extensions: ["uuid-ossp"],
  storageSize: "15Gi",
  version: "17",
});

// Use dbResult.secret in your deployments
```

## Environment Variables

When using the TauApplication integration, the following environment variables are automatically injected via the `getAllEnvironmentVariables()` function:

- `DATABASE_URL` - Full PostgreSQL connection string
- `DB_HOST` - Database hostname
- `DB_PORT` - Database port (5432)
- `DB_NAME` - Database name
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password

You can also manually access these values from the Kubernetes secret at `dbResult.secret.stringData`:

- `url` - Full PostgreSQL connection string
- `host` - Database hostname
- `port` - Database port
- `database` - Database name
- `username` - Database username
- `password` - Database password

## Database Features

### Supported PostgreSQL Extensions

You can specify PostgreSQL extensions when creating a database (any supported by your CNPG/PostgreSQL version):

```typescript
database: {
  extensions: [
    "uuid-ossp", // UUID generation
    "pgcrypto", // Cryptographic functions
    "hstore", // Key-value store
    "ltree", // Tree-like structures
    "pg_trgm", // Trigram matching
  ];
}
```

### Storage Configuration

- **Storage Class**: Uses Longhorn by default for persistent storage
- **Size**: Configurable per database
- **Persistence**: Data persists across pod restarts and node failures

## Examples

### Basic Web Application with Database

```typescript
export class WebApp extends TauApplication {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(
      name,
      {
        database: {
          name: "web-db",
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
        version: "17",
      },
      this
    );

    // Your deployment would use both databases
  }
}
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

- Backups are not enabled by default; configure and test restore procedures if needed
- Monitor backup storage usage on NFS

### Development Workflow

1. Create your application extending TauApplication
2. Add a `database` property in constructor options
3. Use `this.getAllEnvironmentVariables()` in container specs
4. Deploy and test database connectivity
5. Monitor resource usage and adjust as needed
