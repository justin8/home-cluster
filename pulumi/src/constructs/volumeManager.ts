import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export class VolumeManager {
  private volumes: k8s.types.input.core.v1.Volume[] = [];
  private storageMap = new Map<string, { pv: k8s.core.v1.PersistentVolume; pvc: k8s.core.v1.PersistentVolumeClaim }>();
  private config = new pulumi.Config();
  private nfsHostname = this.config.require("nfs_hostname");
  
  constructor(private parent: pulumi.ComponentResource) {}

  addNFSMount(nfsPath: string): k8s.types.input.core.v1.VolumeMount {
    const volumeName = `nfs-${nfsPath.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
    
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

  getVolumes(): k8s.types.input.core.v1.Volume[] {
    return this.volumes;
  }

  getStorage(nfsPath: string) {
    return this.storageMap.get(nfsPath);
  }

  private createNFSPersistentVolume(name: string, path: string): k8s.core.v1.PersistentVolume {
    const volumeHandle = `${this.nfsHostname}/${path}`;
    return new k8s.core.v1.PersistentVolume(name, {
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
    }, { parent: this.parent });
  }

  private createNFSStorage(name: string, path: string) {
    const pv = this.createNFSPersistentVolume(`${name}-pv`, path);
    const pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
      spec: {
        accessModes: ["ReadWriteMany"],
        resources: { requests: { storage: "1Gi" } },
        volumeName: pv.metadata.name,
      },
    }, { parent: this.parent });
    
    return { pv, pvc };
  }
}