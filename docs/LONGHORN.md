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

## Usage in Applications

### Creating Longhorn Volumes

```typescript
// In your TauApplication implementation
const volumeMount = this.volumeManager.createVolume("/path/to/mount", {
  size: "10Gi",
  backupEnabled: true,
  backupSchedule: "0 3 * * *", // Daily at 3am
});
```

### Common Mounting Patterns

```typescript
// Data directory mount
const dataMount = this.volumeManager.createVolume("/data/my-app", {
  size: "10Gi",
  backupEnabled: true,
});

// Config directory mount
const configMount = this.volumeManager.createVolume("/config/my-app", {
  size: "1Gi",
});

// Shared volume with ReadWriteMany access
const sharedMount = this.volumeManager.createVolume("/shared/files", {
  size: "20Gi",
  accessModes: ["ReadWriteMany"],
  backupEnabled: true,
});
```

### Using Both NFS and Longhorn in Containers

```typescript
// Create mounts
const nfsMount = this.volumeManager.addNFSMount("/storage/media");
const longhornMount = this.volumeManager.createVolume("/data/app", {
  size: "10Gi",
  backupEnabled: true,
});

// In your TauApplication implementation:
new k8s.apps.v1.Deployment("my-app", {
  spec: {
    template: {
      spec: {
        containers: [
          {
            name: "app",
            image: "nginx",
            volumeMounts: [
              // NFS mount for shared network files
              nfsMount,

              // Longhorn volumes for persistent data
              longhornMount,
            ],
          },
        ],
        // Pass the volume mounts to only include volumes needed by this container
        volumes: this.volumeManager.getVolumes([nfsMount, longhornMount]),
      },
    },
  },
});
```

## Volume Options

All volume creation methods accept these options:

| Option          | Description                       | Default             |
| --------------- | --------------------------------- | ------------------- |
| `size`          | Storage size (e.g. "1Gi", "10Gi") | "1Gi"               |
| `storageClass`  | Kubernetes StorageClass           | "longhorn"          |
| `accessModes`   | Volume access modes               | `["ReadWriteOnce"]` |
| `backupEnabled` | Enable recurring backups          | `false`             |

## Management

### Accessing the Longhorn UI

The Longhorn UI is available at `https://longhorn.<domain>` once deployed.

### Monitoring Volume Health

Use the Longhorn UI to monitor volume health, replica status, and backup status.

### Resizing Volumes

Only increasing volume sizes is supported.

When increasing the size of a longhorn volume in Pulumi, it will currently have an error due to the deployment order enforced by pulumi in combination with the longhorn volumes. It will return an error like `admission webhook "validator.longhorn.io" denied the request: PVC jellyfin-pvc-lh-config size should be expanded from 21474836480 to 53687091200 first` instead. It can be resolved manually for now by doing the below steps:

1. Update the volume size in the Pulumi config
2. Run `kubectl edit persistentvolumeclaims -n <namespace> <pvc-name>` and update the two size fields before saving and exiting
3. Run `pulumi up` - to retag the resources as managed by Pulumi and other metadata

## Backup and Restore

### How Backups Work

When `backupEnabled` is set to `true` for a volume, a recurring backup job is created with the following default settings:

- Schedule: Daily at 3am (cron: `0 3 * * *`)
- Retention: 7 days of backups
- Backup target: Configured in the Longhorn settings (NFS)

In addition to scheduled backups, you can create manual backups through the Longhorn UI.

### Restoring From Backups

As Longhorn volumes, PVs and PVCs have predictable names with this setup, you can restore a backup in the Longhorn UI (`https://longhorn.<domain>`) and use the same volume name. When bringing the service back online it will use this new volume. Note that if the PV and PVC exist, deleting the longhorn volume will delete them as well, running `pulumi up --refresh` should recreate them.

Step by step instructions:

1. Scale down the service: `kubectl scale --replicas 0 -n $NAMESPACE deployment/$DEPLOYMENT`
2. In the Longhorn web UI delete the volume (this will delete the PV and PVC as well), then restore a backup to the same original name
3. Once the volume has restored, set the data locality to `best-effort`, otherwise you will get a 'Server-Side Apply field conflict detected' error
4. Run `pulumi up --refresh` to recreate the PV, PVC and scale the deployment back again

**NOTE:** Pulumi will see Longhorn volumes with the same name as the correct resource; so you can also delete the deployments or set up the volumes before creating resources via Pulumi.

## Cluster Recovery

When rebuilding a cluster, follow these steps:

1. Ensure Talos Linux nodes have the required configuration
2. Deploy the Pulumi stack's core services only (including Longhorn), but don't deploy apps yet.
3. Restore volumes from backups using the Longhorn UI to the same volume names.
4. Deploy all services via Pulumi
5. Applications will automatically connect to the restored volumes
