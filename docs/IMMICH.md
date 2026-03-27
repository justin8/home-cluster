# Immich

## Backup and Restore

See the [official Immich restore docs](https://docs.immich.app/administration/backup-and-restore/#restore-cli) for full reference.

### Restore Process

#### 1. Scale down Immich

Set replicas to 0 for the Immich deployment so nothing is writing to the database during restore and git push to apply

#### 2. Open a debug shell in the Immich namespace

```bash
debug-shell immich
```

#### 3. Install PostgreSQL client tools

Inside the debug shell:

```sh
apk add postgresql
```

#### 4. Copy the database backup into the debug pod

Database backups are stored at `storage:/mnt/pool/apps/immich/backups`. Find the latest backup file, then copy it into the pod:

```bash
kubectl cp /mnt/pool/apps/immich/backups/immich-db-backup-20260326T000000-v2.0.1-pg17.5.sql.gz \
  immich/debug:/immich-db-backup.sql.gz
```

#### 5. Get the database connection string

The connection URI is stored in the `immich-database-app` secret under the `uri` field:

```bash
kubectl get secret immich-database-app -n immich \
  -o jsonpath='{.data.uri}' | base64 -d
```

#### 6. Restore the database

Inside the debug shell, run the restore using the connection string from the previous step:

```sh
gunzip --stdout /tmp/immich-db-backup.sql.gz \
  | sed "s/SELECT pg_catalog.set_config('search_path', '', false);/SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', true);/g" \
  | psql "<connection string>" \
    --single-transaction
```

Replace `<user>` and `<password>` with the values decoded from the secret in step 5.

#### 7. Scale Immich back up

Update the manifest files and git push
