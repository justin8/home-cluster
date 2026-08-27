# PostgreSQL Usage Guide

## Overview

This guide explains how to configure and manage PostgreSQL databases in your home cluster setup using CloudNativePG (CNPG), including global configuration standards, GitOps-driven disaster recovery procedures, and documented failure modes.

---

## 1. Global Backup Configuration & Architecture

CNPG databases use **native physical backups (Barman Object Store)** streaming to Backblaze B2 (`jdray-backup` bucket).

### Global Values (`global-values.yaml`)

Global backup settings are maintained centrally in `kubernetes/global-values.yaml`:

```yaml
cnpg:
  backup:
    destinationPath: s3://jdray-backup/cnpg
    endpointURL: https://s3.us-west-001.backblazeb2.com
    secretName: cnpg-b2-credentials
    retentionPolicy: "30d"
```

### Shared Credentials Architecture (`shared-secrets` & `reflector`)

The B2 backup access keys (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`) are managed as a `SealedSecret` in `kubernetes/charts/core-services/shared-secrets/templates/cnpg-b2-credentials.yaml`.

The `shared-secrets-reflector` (`reflector.v1.k8s.emberstack.com`) automatically mirrors the `cnpg-b2-credentials` Secret from `kube-system` into target application namespaces (`home-automation`, `immich`, etc.).

---

## 2. Adding a Database to a Helm Chart

Every application database is defined explicitly in `templates/database/cluster.yaml` referencing global backup values.

### Crucial B2 Directory Rule (`serverName`)

The `serverName` parameter specifies the exact subfolder on Backblaze B2 under `destinationPath` (`s3://jdray-backup/cnpg/<serverName>/`):

- **`externalClusters[0].barmanObjectStore.serverName` (RESTORE SOURCE):** Points to the existing B2 directory containing the base backup and WAL logs to restore **from**.
- **`backup.barmanObjectStore.serverName` (BACKUP DESTINATION):** Points to the B2 directory where the new cluster will write its post-recovery WAL logs and future backups **to**.

> ⚠️ **CRITICAL RULE:** If the directory specified in `backup.barmanObjectStore.serverName` already exists and contains WAL files when a new cluster is created or restored, CNPG's pre-flight check will fail with `Expected empty archive` and the database will refuse to start. The backup destination `serverName` must always point to a clean/new directory name.

### Crucial Bootstrap Rule (`initdb` vs `recovery`)

> ⚠️ **BOOTSTRAP MUTUAL EXCLUSION:** CloudNativePG strictly forbids specifying both `initdb` and `recovery` at the same time in `spec.bootstrap`.
>
> - **For normal operation & new installs:** Use `initdb` (with extensions in `postInitSQL`) and leave `recovery` commented out.
> - **For disaster recovery:** Comment out `initdb` and uncomment `recovery`.

```yaml
# templates/database/cluster.yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: {{ .Release.Name }}-db
  namespace: {{ .Release.Namespace }}
spec:
  instances: 1
  enablePDB: false
  postgresql:
    parameters:
      max_connections: "100"
      shared_buffers: 128MB
      effective_cache_size: 512MB
      maintenance_work_mem: 64MB
      checkpoint_completion_target: "0.9"

  # Note: CNPG forbids specifying both initdb and recovery at the same time in spec.bootstrap.
  # For normal operation/new installs, use initdb. For disaster recovery, comment out initdb
  # and uncomment recovery below.
  bootstrap:
    initdb:
      database: {{ .Release.Name }}
      owner: {{ .Release.Name }}_user
    # recovery:
    #   source: {{ .Release.Name }}-db-b2-backup
    #   database: {{ .Release.Name }}
    #   owner: {{ .Release.Name }}_user
    #   secret:
    #     name: {{ .Release.Name }}-db-password

  # READ PATH: Restores base backup and WAL logs from source directory on B2 (s3://jdray-backup/cnpg/{{ .Release.Name }}-db/)
  externalClusters:
    - name: {{ .Release.Name }}-db-b2-backup
      barmanObjectStore:
        destinationPath: {{ .Values.cnpg.backup.destinationPath }}
        serverName: {{ .Release.Name }}-db
        endpointURL: {{ .Values.cnpg.backup.endpointURL }}
        s3Credentials:
          accessKeyId:
            name: {{ .Values.cnpg.backup.secretName }}
            key: AWS_ACCESS_KEY_ID
          secretAccessKey:
            name: {{ .Values.cnpg.backup.secretName }}
            key: AWS_SECRET_ACCESS_KEY

  # WRITE PATH: New cluster archives post-recovery WALs to clean directory on B2 (s3://jdray-backup/cnpg/{{ .Release.Name }}-db-v2/)
  backup:
    barmanObjectStore:
      destinationPath: {{ .Values.cnpg.backup.destinationPath }}
      serverName: {{ .Release.Name }}-db-v2
      endpointURL: {{ .Values.cnpg.backup.endpointURL }}
      s3Credentials:
        accessKeyId:
          name: {{ .Values.cnpg.backup.secretName }}
          key: AWS_ACCESS_KEY_ID
        secretAccessKey:
          name: {{ .Values.cnpg.backup.secretName }}
          key: AWS_SECRET_ACCESS_KEY
      wal:
        compression: gzip
        maxParallel: 2
      data:
        compression: gzip
    retentionPolicy: {{ .Values.cnpg.backup.retentionPolicy | quote }}

  storage:
    size: {{ .Values.databaseVolumeSizeGi }}Gi
    storageClass: longhorn
```

### Database Connection Secrets

CNPG automatically creates and manages a Secret named `<cluster-name>-app` containing:

- `user` — Database username
- `password` — Database password
- `dbname` — Database name
- `host` — Database read-write hostname (`<cluster-name>-rw`)
- `port` — Database port (`5432`)
- `uri` — Full PostgreSQL connection URI

You can mount these credentials directly into your application's `deployment.yaml`:

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

### Scheduled Backups

Include a `ScheduledBackup` resource in application database templates (e.g., `templates/database/scheduled-backup.yaml`) for nightly physical base backups:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: {{ .Release.Name }}-db-daily-backup
  namespace: {{ .Release.Namespace }}
spec:
  schedule: "0 0 2 * * *"
  backupOwnerReference: self
  cluster:
    name: {{ .Release.Name }}-db
```

---

## 3. GitOps Disaster Recovery / Restore Procedure

Disaster recovery in this cluster is **100% GitOps driven via ArgoCD**. No manual scaling of application deployments or out-of-band `kubectl` cluster modifications are required.

> **Note:** Manual scaling of the application deployment during recovery is unnecessary because CNPG automatically blocks incoming database connections and isolates PostgreSQL until recovery is complete and the state is consistent.

### Step 1: Update `cluster.yaml` in Git for Recovery

When restoring a database (e.g. following storage loss or migrating to a new cluster), update `cluster.yaml`:

1. In `spec.bootstrap`, comment out `initdb` and uncomment `recovery`.
2. Set `externalClusters[0].barmanObjectStore.serverName` to the **existing source directory** on B2 containing the base backup and WAL logs (e.g., `homeassistant-db`).
3. Set `backup.barmanObjectStore.serverName` to a **new, clean target directory** on B2 for post-recovery WAL logs (e.g., `homeassistant-db-v2`).

### Step 2: Commit and Push to Git

Commit and push the manifest changes to `main`.

### Step 3: Automated ArgoCD Recovery

ArgoCD applies the updated manifest to the cluster. On a fresh PVC, CNPG automatically detects `bootstrap.recovery`:

1. Connects to `externalClusters[0]` (`s3://jdray-backup/cnpg/homeassistant-db/`), downloads the base backup, and replays all WAL logs up to the latest transaction.
2. Verifies that `backup` (`s3://jdray-backup/cnpg/homeassistant-db-v2/`) is clean.
3. Transitions the cluster status to `Cluster in healthy state` and begins archiving new WAL logs to the new directory.

---

## 4. Documented Failure Modes & Troubleshooting

### Failure Mode: `Expected empty archive` Error During Recovery

- **Symptom:** The recovery pod (`<app>-db-1-full-recovery-*`) fails during initialization with the following error in logs:
  ```text
  ERROR: WAL archive check failed for server <app>-db: Expected empty archive
  ```
- **Cause:** By default, CNPG runs `barman-cloud-check-wal-archive` against `backup.barmanObjectStore` before starting PostgreSQL to ensure the new cluster won't overwrite existing WAL files in its target write directory. If `backup.barmanObjectStore.serverName` is set to an existing folder that already contains WAL files (such as `externalClusters.barmanObjectStore.serverName`), `barman-cloud-check-wal-archive` detects pre-existing WAL files and halts.
- **Resolution:** Ensure `backup.barmanObjectStore.serverName` specifies a clean, distinct directory on B2 (e.g. `homeassistant-db-v2`), while `externalClusters[0].barmanObjectStore.serverName` specifies the old backup directory (e.g. `homeassistant-db`). Never delete existing WAL files from the backup bucket.

---

## Best Practices & Security

- **Secrets:** Database credentials are auto-generated or sourced from SealedSecrets.
- **Access Control:** Databases are strictly cluster-private (`<cluster-name>-rw.<namespace>.svc`).
- **Persistence:** Volume size is configurable via `values.yaml` (`databaseVolumeSizeGi`).
