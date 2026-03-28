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

- Backups are enabled by default via Longhorn volume backups (see [LONGHORN](LONGHORN.md) for more details)
- CNPG's native backups are not being used currently

#### Restoring a Database Volume

CNPG manages its own PVC via `pvcTemplate`, so the standard Longhorn volume restore process (renaming the volume in `volume.yaml`) does not apply directly. The correct procedure is:

1. **Scale down the app** — delete or suspend the ArgoCD application (or scale the deployment to 0) so nothing is writing to the database
2. **Delete the CNPG Cluster** — this releases the PVC so the volume can be replaced. The PV/Longhorn volume are retained due to `persistentVolumeReclaimPolicy: Retain`
3. **Restore the backup in Longhorn UI** — restore to a **new name** (e.g. `immich-database-data-restored`)
4. **Update `volume.yaml`** — change the Longhorn `Volume` CR name, PV name, `csi.volumeHandle`, and the `volumeName` in the CNPG cluster's `pvcTemplate` to the new name
5. **Commit and push** — ArgoCD will recreate the CNPG Cluster pointing at the restored volume

## Limitations

- Currently only supports a single PostgreSQL instance per application
  - This is due to the way we provision Longhorn using static volumes - it greatly simplifies backups/restores and provides usable names in the Longhorn UI. However each CNPG cluster is created with a PVC template that maps back to a single volume
