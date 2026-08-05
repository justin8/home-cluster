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

## Provisioning Patterns

### Manual (Explicit Three-Resource Pattern)

For applications that support only a **single instance**, use the explicit three-resource pattern. This provides stable, human-readable volume names in the Longhorn UI and simplifies manual backups/restores.

This pattern is implemented via the `common.longhornVolume` template in `kubernetes/charts/common/templates/_longhornvolume.tpl`. Use it in your app chart (typically `templates/volume.yaml`):

```yaml
{
  {
    - include "common.longhornVolume" (dict "ctx" . "name" "my-app-data" "sizeGi" .Values.volumeSizeGi) -,
  },
}
```

It manages:

1. `longhorn.io/v1beta2 Volume`: Define the volume in `longhorn-system` with recurring job group labels.
2. `PersistentVolume`: A cluster-scoped PV using CSI binding to the Longhorn volume.
3. `PersistentVolumeClaim`: Reference the PV by `volumeName` in the application namespace.

### Dynamic Provisioning

For **managed databases** (e.g., CloudNativePG) or applications that require **horizontal scaling/failover**, use dynamic provisioning. This allows the orchestrator to automatically manage the volume lifecycle for each instance.

Use a simple PVC in the application chart:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-app-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: longhorn
  resources:
    requests:
      storage: 10Gi
```

## Volume Sizing in Helm Charts

Volume size is defined in `values.yaml` as `volumeSizeGi`. All manual volumes should use Gi for consistency.

```yaml
# values.yaml
volumeSizeGi: 5
```

The `common.longhornVolume` template automatically converts this to bytes for the Longhorn `Volume` spec and uses `Gi` for the PV and PVC requests.

```yaml
# volume.yaml
{
  {
    - include "common.longhornVolume" (dict "ctx" . "name" "my-app-data" "sizeGi" .Values.volumeSizeGi) -,
  },
}
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

## Node Replacement / Reset Recovery

When a Talos node is replaced, reset (`talosctl reset`), or re-installed:

1. **`DiskFilesystemChanged` / `DiskNotReady` Error**:
   When the node re-joins Kubernetes, a fresh filesystem is created on `/var/lib/longhorn` with a new `diskUUID`. Longhorn's safety guard detects that the UUID on disk does not match the old `diskUUID` stored in Kubernetes, resulting in:
   - `Disk default-disk-1030800000000(/var/lib/longhorn) on node <node-name> is not ready: record diskUUID doesn't match the one on the disk`
   - `ALLOWSCHEDULING: false` or `SCHEDULABLE: false` for the node's disk.

2. **Remediation Procedure**:
   To clear the stale disk registration and allow Longhorn to adopt the fresh disk:

   a. **Disable scheduling on the stale disk**:

   ```bash
   kubectl patch node.longhorn.io <node-name> -n longhorn-system --type=merge -p='{"spec":{"disks":{"default-disk-1030800000000":{"allowScheduling":false}}}}'
   ```

   b. **Remove the stale disk entry from the spec**:

   ```bash
   kubectl patch node.longhorn.io <node-name> -n longhorn-system --type=json -p='[{"op": "remove", "path": "/spec/disks/default-disk-1030800000000"}]'
   ```

   c. **Re-add the fresh disk path**:

   ```bash
   kubectl patch node.longhorn.io <node-name> -n longhorn-system --type=merge -p='{"spec":{"disks":{"default-disk-1030800000000":{"allowScheduling":true,"diskType":"filesystem","evictionRequested":false,"path":"/var/lib/longhorn","storageReserved":50955090329}}}}'
   ```

   d. **Restart the `longhorn-manager` pod on that node**:

   ```bash
   kubectl delete pod -n longhorn-system -l app=longhorn-manager --field-selector spec.nodeName=<node-name>
   ```

3. **Verification**:
   Verify that the node status returns to `READY: True` and `SCHEDULABLE: True`:
   ```bash
   kubectl get nodes.longhorn.io -n longhorn-system
   ```
