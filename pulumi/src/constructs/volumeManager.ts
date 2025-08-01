import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { v4 as uuidv4 } from "uuid";

export interface VolumeOptions {
  /** @default "1Gi" */
  size?: string;
  /** @default "longhorn" */
  storageClass?: string;
  /** @default ["ReadWriteOnce"] */
  accessModes?: pulumi.Input<string>[];
  /** @default false */
  backupEnabled?: boolean;
  /** @default "0 3 * * *" - Cron schedule for backups (daily at 3am) */
  backupSchedule?: string;
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

  constructor(private parent: pulumi.ComponentResource) {}

  /**
   * Creates a Longhorn PVC using dynamic provisioning
   */
  private createLonghornStorage(
    name: string,
    mountPath: string,
    options: VolumeOptions,
  ) {
    const storageClass = options.storageClass || "longhorn";
    const size = options.size || "1Gi";
    const accessModes = options.accessModes || ["ReadWriteOnce"];

    const pvc = new k8s.core.v1.PersistentVolumeClaim(
      `${name}-pvc`,
      {
        spec: {
          accessModes: accessModes,
          storageClassName: storageClass,
          resources: {
            requests: { storage: size },
          },
        },
        metadata: {
          annotations: {
            "tau.volume/mountPath": mountPath,
          },
        },
      },
      { parent: this.parent },
    );

    return { pvc };
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
      { parent: this.parent },
    );
  }

  /**
   * Creates an NFS mount using the NFS CSI driver
   * @param nfsPath The path on the NFS server to mount
   * @param options Volume configuration options
   * @returns A volume mount object for use in container spec
   */
  addNFSMount(
    nfsPath: string,
    options: VolumeOptions = {},
  ): k8s.types.input.core.v1.VolumeMount {
    const volumeName = `nfs-${nfsPath.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;

    if (!this.storageMap.has(nfsPath)) {
      const storage = this.createNFSStorage(volumeName, nfsPath);
      this.storageMap.set(nfsPath, storage);

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
   * Returns volumes corresponding to the given volume mounts
   * @param volumeMounts Optional array of volume mounts to get volumes for
   * @returns Array of volume definitions for pod spec
   */
  getVolumes(
    volumeMounts?: k8s.types.input.core.v1.VolumeMount[],
  ): k8s.types.input.core.v1.Volume[] {
    if (!volumeMounts) {
      return this.volumes; // Return all volumes if no mounts specified
    }

    // Filter volumes to only include those referenced in the volumeMounts
    const volumeNames = volumeMounts.map((mount) => mount.name);
    return this.volumes.filter((vol) => volumeNames.includes(vol.name));
  }

  /**
   * Creates a Longhorn volume with the given options
   * @param mountPath Where the volume should be mounted in the container
   * @param options Volume configuration options
   * @returns A volume mount object for use in container spec
   */
  createVolume(
    mountPath: string,
    options: VolumeOptions = {},
  ): k8s.types.input.core.v1.VolumeMount {
    // Generate a safe name for the volume
    const volumeId = uuidv4().substring(0, 8);
    const volumeName = `vol-${mountPath.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${volumeId}`;
    const shortName = volumeName.substring(0, 60); // Ensure name isn't too long

    if (!this.storageMap.has(mountPath)) {
      const storage = this.createLonghornStorage(shortName, mountPath, options);
      this.storageMap.set(mountPath, storage);

      this.volumes.push({
        name: shortName,
        persistentVolumeClaim: { claimName: storage.pvc.metadata.name },
      });

      // Set up backup if enabled
      if (options.backupEnabled) {
        this.setupBackupForVolume(
          shortName,
          options.backupSchedule || "0 3 * * *",
        ); // Default daily at 3am
      }
    }

    return {
      name: shortName,
      mountPath: mountPath,
    };
  }

  getStorage(path: string) {
    return this.storageMap.get(path);
  }

  private createNFSPersistentVolume(
    name: string,
    path: string,
  ): k8s.core.v1.PersistentVolume {
    const volumeHandle = `${this.nfsHostname}/${path}`;
    return new k8s.core.v1.PersistentVolume(
      name,
      {
        spec: {
          capacity: { storage: "1Gi" },
          accessModes: ["ReadWriteMany"],
          persistentVolumeReclaimPolicy: "Retain",
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
      { parent: this.parent },
    );
  }

  private createNFSStorage(name: string, path: string) {
    const pv = this.createNFSPersistentVolume(`${name}-pv`, path);
    const pvc = new k8s.core.v1.PersistentVolumeClaim(
      `${name}-pvc`,
      {
        spec: {
          accessModes: ["ReadWriteMany"],
          resources: { requests: { storage: "1Gi" } },
          volumeName: pv.metadata.name,
        },
      },
      { parent: this.parent },
    );

    return { pv, pvc };
  }
}
