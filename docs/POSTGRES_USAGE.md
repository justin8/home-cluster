# PostgreSQL Usage Guide

## Overview

This guide explains how to use PostgreSQL databases in your home cluster setup using CloudNativePG (CNPG).

## Quick Start

### 1. Adding a Database to a Helm Chart

The easiest way to add a database to your application is to include a CNPG `Cluster` resource in your application's Helm chart.

```yaml
# templates/database/cluster.yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: {{ .Release.Name }}-database
  namespace: {{ .Release.Namespace }}
spec:
  instances: 1
  imageName: ghcr.io/tensorchord/cloudnative-vectorchord:17-0.4.3
  managed:
    roles:
      - name: {{ .Release.Name }}-user
        login: true
        superuser: true
  bootstrap:
    initdb:
      database: {{ .Release.Name }}-db
      owner: {{ .Release.Name }}-user
  storage:
    size: {{ .Values.databaseVolumeSizeGi }}Gi
    storageClass: longhorn
    pvcTemplate:
      accessModes:
        - ReadWriteOnce
      storageClassName: longhorn
      volumeName: {{ .Release.Name }}-database-data
      resources:
        requests:
          storage: {{ .Values.databaseVolumeSizeGi }}Gi
```

### 2. Accessing the Database

CNPG automatically creates a secret with the database credentials. You can mount these credentials as environment variables in your application deployment.

```yaml
# templates/deployment.yaml
env:
  - name: DB_HOST
    value: {{ .Release.Name }}-database-rw
  - name: DB_PORT
    value: "5432"
  - name: DB_NAME
    value: {{ .Release.Name }}-db
  - name: DB_USER
    valueFrom:
      secretKeyRef:
        name: {{ .Release.Name }}-database-app
        key: user
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: {{ .Release.Name }}-database-app
        key: password
```

## Environment Variables

CNPG creates a secret named `<cluster-name>-app` containing:

- `user` - Database username
- `password` - Database password
- `dbname` - Database name
- `host` - Database hostname
- `port` - Database port (5432)
- `uri` - Full PostgreSQL connection string

## Database Features

### Supported PostgreSQL Extensions

You can specify PostgreSQL extensions in the `initdb` section:

```yaml
bootstrap:
  initdb:
    database: my-db
    owner: my-user
    postInitSQL:
      - CREATE EXTENSION IF NOT EXISTS "uuid-ossp" CASCADE
      - CREATE EXTENSION IF NOT EXISTS "pgcrypto" CASCADE
```

### Storage Configuration

- **Storage Class**: Uses Longhorn by default for persistent storage
- **Size**: Configurable per database via `values.yaml`
- **Persistence**: Data persists across pod restarts and node failures using static volume bindings

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

CNPG databases use **native physical backups (Barman Object Store)** to Backblaze B2 (`jdray-backup` bucket).

#### Shared Credentials Architecture (`shared-secrets` & `reflector`)

The B2 backup credentials (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`) are managed centrally as a `SealedSecret` in the `shared-secrets` core service (`kubernetes/charts/core-services/shared-secrets/templates/cnpg-b2-credentials.yaml`).

The `shared-secrets-reflector` automatically mirrors the `cnpg-b2-credentials` Secret from `kube-system` into target database namespaces (such as `home-automation`, `immich`, etc.).

#### Adding B2 Backups to a CNPG Cluster

Add the `bootstrap.recovery` block and single `common.cnpgBackup` template to the application's `cluster.yaml`:

```yaml
spec:
  # Automated Disaster Recovery from S3/B2 on fresh PVC
  bootstrap:
    recovery:
      source: <app>-db-b2-backup

{{ include "common.cnpgBackup" (dict "ctx" . "name" "<app>-db") | indent 2 }}
```

#### Scheduled Backups

Include a `ScheduledBackup` resource in the application database templates (e.g., `templates/database/scheduled-backup.yaml`):

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: <app>-db-daily-backup
  namespace: { { .Release.Namespace } }
spec:
  schedule: "0 0 2 * * *"
  backupOwnerReference: self
  cluster:
    name: <app>-db
```

#### Disaster Recovery / Restoring a Cluster

If a node, PVC, or cluster is lost, ArgoCD re-deploys the `Cluster` resource. Because the PVC is empty, CNPG detects `bootstrap.recovery`, connects to B2, downloads the latest base backup and WAL logs, and restores PostgreSQL automatically.

## Limitations

- Currently only supports a single PostgreSQL instance per application
  - This is due to the way we provision Longhorn using static volumes - it greatly simplifies backups/restores and provides usable names in the Longhorn UI. However each CNPG cluster is created with a PVC template that maps back to a single volume
