import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { BACKUP_JOB_GROUP, FSTRIM_JOB_GROUP } from "../core-services/longhorn";

export interface LonghornVolumeOptions {
  /** @default "1Gi" */
  size?: string;
  /** @default "longhorn" */
  storageClass?: string;
  /** @default ["ReadWriteOnce"] */
  accessModes?: pulumi.Input<string>[];
  /** @default false */
  backupEnabled?: boolean;
}

export class VolumeManager {
  private volumes: k8s.types.input.core.v1.Volume[] = [];
  private storageMap = new Map<
    string,
    {
      pv?: k8s.core.v1.PersistentVolume;
      pvc: k8s.core.v1.PersistentVolumeClaim;
    }
  >();
  private config = new pulumi.Config();
  private nfsHostname = this.config.require("nfs_hostname");
  private appName: string;

  constructor(
    appName: string,
    private parent: pulumi.ComponentResource
  ) {
    this.appName = appName;
  }

  /**
   * Returns volumes corresponding to the given volume mounts
   * @param volumeMounts Optional array of volume mounts to get volumes for
   * @returns Array of volume definitions for pod spec
   */
  getVolumes(
    volumeMounts?: k8s.types.input.core.v1.VolumeMount[]
  ): k8s.types.input.core.v1.Volume[] {
    if (!volumeMounts) {
      return this.volumes; // Return all volumes if no mounts specified
    }

    // Filter volumes to only include those referenced in the volumeMounts
    const volumeNames = volumeMounts.map(mount => mount.name);
    return this.volumes.filter(vol => volumeNames.includes(vol.name));
  }

  getStorage(path: string) {
    return this.storageMap.get(path);
  }

  /**
   * Sets up a recurring backup schedule for a volume
   */
  private setupBackupForVolume(volumeName: string, schedule: string) {
    // Create a recurring backup job for this volume
    // This uses a custom resource definition provided by Longhorn
    new k8s.apiextensions.CustomResource(
      `${volumeName}-backup-job`,
      {
        apiVersion: "longhorn.io/v1beta2",
        kind: "RecurringJob",
        metadata: {
          name: `${volumeName}-backup`,
          namespace: "longhorn-system",
        },
        spec: {
          name: `${volumeName}-backup`,
          groups: [volumeName],
          task: "backup",
          cron: schedule,
          retain: 7, // Keep 7 days of backups by default
          concurrency: 2,
          labels: {},
        },
      },
      { parent: this.parent }
    );
  }

  /**
   * Creates an NFS mount using the NFS CSI driver
   * @param nfsPath The path on the NFS server to mount
   * @param options Volume configuration options
   * @returns A volume mount object for use in container spec
   */
  addNFSMount(nfsPath: string): k8s.types.input.core.v1.VolumeMount {
    const volumeName = `nfs${nfsPath.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;

    if (!this.storageMap.has(volumeName)) {
      const storage = this.createNFSVolume(volumeName, nfsPath);
      this.storageMap.set(volumeName, storage);

      this.volumes.push({
        name: volumeName,
        persistentVolumeClaim: { claimName: storage.pvc.metadata.name },
      });
    }

    return {
      name: volumeName,
      mountPath: nfsPath,
    };
  }

  /**
   * Creates a Longhorn volume with the given options
   * @param mountPath Where the volume should be mounted in the container
   * @param options Volume configuration options
   * @returns A volume mount object for use in container spec
   */
  addLonghornVolume(
    mountPath: string,
    options: LonghornVolumeOptions = {}
  ): k8s.types.input.core.v1.VolumeMount {
    // Generate a safe name for the volume
    const volumeName = `lh${mountPath.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;

    if (!this.storageMap.has(volumeName)) {
      const storage = this.createLonghornVolume(volumeName, options);
      this.storageMap.set(volumeName, storage);

      this.volumes.push({
        name: volumeName,
        persistentVolumeClaim: { claimName: storage.pvc.metadata.name },
      });
    }

    return {
      name: volumeName,
      mountPath: mountPath,
    };
  }

  private createNFSVolume(name: string, path: string) {
    const volumeHandle = `${this.nfsHostname}/${path}`;
    const pvName = `${this.appName}-pv-${name}`.substring(0, 60);
    const pvcName = `${this.appName}-pvc-${name}`.substring(0, 60);

    const pv = new k8s.core.v1.PersistentVolume(
      pvName,
      {
        metadata: {
          name: pvName,
        },
        spec: {
          capacity: { storage: "1Gi" },
          accessModes: ["ReadWriteMany"],
          persistentVolumeReclaimPolicy: "Retain",
          storageClassName: "", // Don't use longhorn storage class
          csi: {
            driver: "nfs.csi.k8s.io",
            volumeHandle: volumeHandle,
            volumeAttributes: {
              server: this.nfsHostname,
              share: path,
            },
          },
        },
      },
      { parent: this.parent }
    );

    const pvc = new k8s.core.v1.PersistentVolumeClaim(
      pvcName,
      {
        metadata: {
          name: pvcName,
        },
        spec: {
          accessModes: ["ReadWriteMany"],
          storageClassName: "", // Don't use longhorn storage class
          resources: { requests: { storage: "1Gi" } },
          volumeName: pv.metadata.name,
        },
      },
      { parent: this.parent }
    );

    return { pv, pvc };
  }

  private createLonghornVolume(name: string, options: LonghornVolumeOptions) {
    const storageClass = options.storageClass || "longhorn";
    const size = options.size || "1Gi";
    const accessModes = options.accessModes || ["ReadWriteOnce"];
    const backupEnabled = options.backupEnabled || false;
    const opts = { parent: this.parent };

    const longhornVolume = createLonghornVolumeResource(
      this.appName,
      name,
      size,
      backupEnabled,
      opts
    );
    const pv = createLonghornPersistentVolume(
      this.appName,
      name,
      size,
      accessModes,
      storageClass,
      longhornVolume,
      { ...opts, dependsOn: [longhornVolume] }
    );
    const pvc = createLonghornPersistentVolumeClaim(
      this.appName,
      name,
      size,
      accessModes,
      storageClass,
      pv,
      { ...opts, dependsOn: [pv] }
    );

    return { pv, pvc };
  }
}

export function createLonghornVolumeResource(
  identifier: string,
  name: string,
  size: string,
  backupEnabled: boolean,
  opts?: pulumi.CustomResourceOptions
) {
  const lhvName = `${identifier}-${name}`.substring(0, 60);
  return new k8s.apiextensions.CustomResource(
    lhvName,
    {
      apiVersion: "longhorn.io/v1beta2",
      kind: "Volume",
      metadata: {
        name: lhvName,
        namespace: "longhorn-system",
        labels: {
          [`recurring-job-group.longhorn.io/${FSTRIM_JOB_GROUP}`]: "enabled",
          ...(backupEnabled
            ? { [`recurring-job-group.longhorn.io/${BACKUP_JOB_GROUP}`]: "enabled" }
            : {}),
        },
      },
      spec: {
        size: String(parseSizeToBytes(size)),
        frontend: "blockdev",
        // numberOfReplicas: numberOfReplicas,
        // dataLocality: dataLocality,
        // replicaSoftAntiAffinity: replicaSoftAntiAffinity,
        // replicaZoneSoftAntiAffinity: replicaZoneSoftAntiAffinity,
        // diskSelector: [], // Empty means any disk
        // nodeSelector: [], // Empty means any node
        // recurringJobSelector: backupEnabled ? [BACKUP_JOB_GROUP] : [],
        // Optional: Specify backup target if needed
        // backupCompressionMethod: "lz4",
        // snapshotMaxCount: 10,
        // snapshotMaxSize: "100Mi",
      },
    },
    opts
  );
}

export function createLonghornPersistentVolume(
  identifier: string,
  name: string,
  size: string,
  accessModes: pulumi.Input<string>[],
  storageClass: string,
  longhornVolume: k8s.apiextensions.CustomResource,
  opts?: pulumi.CustomResourceOptions
) {
  const pvName = `${identifier}-pv-${name}`.substring(0, 60);
  return new k8s.core.v1.PersistentVolume(
    pvName,
    {
      metadata: {
        name: pvName,
      },
      spec: {
        capacity: {
          storage: size,
        },
        volumeMode: "Filesystem",
        accessModes: accessModes,
        persistentVolumeReclaimPolicy: "Delete",
        storageClassName: storageClass,
        csi: {
          driver: "driver.longhorn.io",
          volumeHandle: longhornVolume.metadata.name,
          fsType: "ext4",
        },
      },
    },
    opts
  );
}

export function createLonghornPersistentVolumeClaim(
  identifier: string,
  name: string,
  size: string,
  accessModes: pulumi.Input<string>[],
  storageClass: string,
  pv: k8s.core.v1.PersistentVolume,
  opts?: pulumi.CustomResourceOptions
) {
  const pvcName = `${identifier}-pvc-${name}`.substring(0, 60);
  return new k8s.core.v1.PersistentVolumeClaim(
    pvcName,
    {
      metadata: {
        name: pvcName,
      },
      spec: {
        accessModes: accessModes,
        storageClassName: storageClass,
        volumeName: pv.metadata.name,
        resources: {
          requests: { storage: size },
        },
      },
    },
    opts
  );
}

function parseSizeToBytes(size: string | number): number {
  if (typeof size === "number") return size;
  const match = /^([0-9.]+)\s*(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/i.exec(size);
  if (!match) throw new Error(`Invalid size format: ${size}`);
  const n = parseFloat(match[1]);
  const unit = (match[2] || "").toLowerCase();
  switch (unit) {
    case "ki":
      return Math.round(n * 1024);
    case "mi":
      return Math.round(n * 1024 ** 2);
    case "gi":
      return Math.round(n * 1024 ** 3);
    case "ti":
      return Math.round(n * 1024 ** 4);
    case "pi":
      return Math.round(n * 1024 ** 5);
    case "ei":
      return Math.round(n * 1024 ** 6);
    case "k":
      return Math.round(n * 1e3);
    case "m":
      return Math.round(n * 1e6);
    case "g":
      return Math.round(n * 1e9);
    case "t":
      return Math.round(n * 1e12);
    case "p":
      return Math.round(n * 1e15);
    case "e":
      return Math.round(n * 1e18);
    case "":
      return Math.round(n);
    default:
      throw new Error(`Unknown size unit: ${unit}`);
  }
}
