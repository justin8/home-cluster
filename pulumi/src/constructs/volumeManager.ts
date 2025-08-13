import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { BACKUP_JOB_GROUP, FSTRIM_JOB_GROUP } from "../core-services/longhorn";

export interface LonghornVolumeArgs {
  /** @default "1Gi" */
  size?: string;
  /** @default "longhorn" */
  storageClass?: string;
  /** @default "ReadWriteOnce" */
  accessMode?: "ReadWriteOnce" | "ReadOnlyMany" | "ReadWriteMany";
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
  private namespace: pulumi.Input<string>;

  constructor(
    appName: string,
    namespace: pulumi.Input<string>,
    private opts: pulumi.CustomResourceOptions
  ) {
    this.appName = appName;
    this.namespace = namespace || "default";
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
      this.opts
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
   * @param args Volume configuration options
   * @returns A volume mount object for use in container spec
   */
  addLonghornVolume(
    mountPath: string,
    args: LonghornVolumeArgs = {}
  ): k8s.types.input.core.v1.VolumeMount {
    // Generate a safe name for the volume
    const volumeName = `lh${mountPath.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;

    if (!this.storageMap.has(volumeName)) {
      const storage = this.createLonghornVolume(volumeName, args);
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
          storageClassName: "nfs-csi",
          csi: {
            driver: "nfs.csi.k8s.io",
            volumeHandle,
            volumeAttributes: {
              server: this.nfsHostname,
              share: path,
            },
          },
        },
      },
      this.opts
    );

    const pvc = new k8s.core.v1.PersistentVolumeClaim(
      pvcName,
      {
        metadata: {
          name: pvcName,
          namespace: this.namespace,
        },
        spec: {
          accessModes: ["ReadWriteMany"],
          storageClassName: "nfs-csi",
          resources: { requests: { storage: "1Gi" } },
          volumeName: pv.metadata.name,
        },
      },
      this.opts
    );

    return { pv, pvc };
  }

  private createLonghornVolume(name: string, args: LonghornVolumeArgs) {
    const storageClass = args.storageClass || "longhorn";
    const size = args.size || "1Gi";
    const accessMode = args.accessMode || "ReadWriteOnce";
    const backupEnabled = args.backupEnabled || false;

    const longhornVolume = createLonghornVolumeResource({
      identifier: this.appName,
      name,
      size,
      backupEnabled,
      accessMode,
      opts: this.opts,
    });
    const pv = createLonghornPersistentVolume({
      identifier: this.appName,
      name,
      size,
      longhornVolume,
      storageClass,
      accessMode,
      opts: { ...this.opts, dependsOn: [longhornVolume] },
      namespace: this.namespace,
    });
    const pvc = createLonghornPersistentVolumeClaim({
      identifier: this.appName,
      name,
      size,
      pv,
      storageClass,
      accessMode,
      opts: { ...this.opts, dependsOn: [pv] },
      namespace: this.namespace,
    });

    return { pv, pvc };
  }
}

interface LonghornResourceArgs {
  identifier: string;
  name: string;
  size: string;
  namespace?: pulumi.Input<string>;
  backupEnabled?: boolean;
  accessMode?: string;
  storageClass?: string;
  longhornVolume?: k8s.apiextensions.CustomResource;
  numberOfReplicas?: number;
  pv?: k8s.core.v1.PersistentVolume;
  opts?: pulumi.CustomResourceOptions;
}

export function createLonghornVolumeResource(args: LonghornResourceArgs) {
  const { identifier, name, size, backupEnabled, accessMode = "ReadWriteOnce", opts } = args;
  const lhvName = `${identifier}-${name}`.substring(0, 60);
  const accessModeMap: Record<string, string> = {
    ReadWriteOnce: "rwo",
    ReadWriteMany: "rwx",
    ReadOnlyMany: "rox",
  };
  const longhornAccessMode = accessModeMap[accessMode];
  const numberOfReplicas = args.numberOfReplicas || 2;

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
        dataLocality: "best-effort",
        migratable: longhornAccessMode == "rwx",
        accessMode: longhornAccessMode,
        numberOfReplicas,
      },
    },
    { ...opts, ignoreChanges: ["spec.migratable"] }
  );
}

export function createLonghornPersistentVolume(args: LonghornResourceArgs) {
  const {
    identifier,
    name,
    size,
    longhornVolume,
    storageClass = "longhorn",
    accessMode = "ReadWriteOnce",
    namespace = "default",
    opts,
  } = args;
  const pvName = `${identifier}-pv-${name}`.substring(0, 60);

  return new k8s.core.v1.PersistentVolume(
    pvName,
    {
      metadata: {
        name: pvName,
        namespace,
      },
      spec: {
        capacity: {
          storage: size,
        },
        volumeMode: "Filesystem",
        accessModes: [accessMode],
        persistentVolumeReclaimPolicy: "Delete",
        storageClassName: storageClass,
        csi: {
          driver: "driver.longhorn.io",
          volumeHandle: longhornVolume!.metadata.name,
          fsType: "ext4",
        },
      },
    },
    opts
  );
}

export function createLonghornPersistentVolumeClaim(args: LonghornResourceArgs) {
  const {
    identifier,
    name,
    size,
    pv,
    storageClass = "longhorn",
    accessMode = "ReadWriteOnce",
    namespace = "default",
    opts,
  } = args;
  const pvcName = `${identifier}-pvc-${name}`.substring(0, 60);
  return new k8s.core.v1.PersistentVolumeClaim(
    pvcName,
    {
      metadata: {
        name: pvcName,
        namespace,
      },
      spec: {
        accessModes: [accessMode],
        storageClassName: storageClass,
        volumeName: pv!.metadata.name,
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
