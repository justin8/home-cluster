# Longhorn Storage

## Overview

Longhorn provides distributed block storage for Kubernetes with the following features:

- High availability through volume replication
- Snapshot and backup capabilities
- Disaster recovery support
- Web UI for management

## Prerequisites for Talos Linux

When running on Talos Linux, the following prerequisites are required:

1. System Extensions:
   - `siderolabs/iscsi-tools` (enables iscsid daemon)
   - `siderolabs/util-linux-tools` (provides linux tools)

2. Machine Configuration:

   ```yaml
   machine:
     kubelet:
       extraMounts:
         - destination: /var/lib/longhorn
           type: bind
           source: /var/lib/longhorn
           options:
             - bind
             - rshared
             - rw
   ```

3. Pod Security:
   - Set pod security to privileged mode

## Management

### Accessing the Longhorn UI

The Longhorn UI is available at `https://longhorn.<domain>` once deployed.

### Monitoring Volume Health

Use the Longhorn UI to monitor volume health, replica status, and backup status.

### Resizing Volumes

Only increasing volume sizes is supported. Update the size in the app's `volume.yaml` and sync via ArgoCD.

## Volume Sizing in Helm Charts

Volume size is defined in `values.yaml` as Mi or Gi. Use Mi for volumes under 1Gi, Gi otherwise:

```yaml
# values.yaml (Mi — for volumes under 1Gi)
volumeSizeMi: 100

# values.yaml (Gi — for volumes 1Gi and above)
volumeSizeGi: 5
```

```yaml
# volume.yaml
apiVersion: longhorn.io/v1beta2
kind: Volume
spec:
  size: {{ mul .Values.volumeSizeMi 1024 | mul 1024 | quote }}           # Mi → bytes
  # or
  size: {{ mul .Values.volumeSizeGi 1024 | mul 1024 | mul 1024 | quote }} # Gi → bytes
---
# PV and PVC use the value directly with the appropriate suffix
  storage: {{ .Values.volumeSizeMi }}Mi   # or {{ .Values.volumeSizeGi }}Gi
```

## Backup and Restore

### How Backups Work

Recurring backup jobs are created for volumes with backups enabled:

- Schedule: Daily at 3am (cron: `0 3 * * *`)
- Retention: 7 days of backups
- Backup target: Configured in the Longhorn settings (NFS)

Manual backups can also be created through the Longhorn UI.

### Restoring From Backups

1. In the Longhorn UI (`https://longhorn.<domain>`), restore the backup to a **new name** (e.g. `mail-proxy-spool-v2`)
2. Update the volume name in the app's Helm chart — change all references in `volume.yaml` from the old name to the new name (the Longhorn `Volume` CR `metadata.name`, the PV `metadata.name` and `csi.volumeHandle`, and the PVC `metadata.name` and `volumeName`)
3. Commit and push — ArgoCD will sync the new resources and the deployment will pick up the new volume

## Cluster Recovery

When rebuilding a cluster:

1. Ensure Talos Linux nodes have the required configuration
2. Deploy core services (including Longhorn) via ArgoCD, but hold off on apps
3. Restore volumes from backups in the Longhorn UI with new names
4. Update the volume, PV and PVC references per the above steps, then push the change to allow ArgoCD to sync the changes
