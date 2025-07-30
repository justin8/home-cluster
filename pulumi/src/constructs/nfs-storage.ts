import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export function createNFSPersistentVolume(name: string, path: pulumi.Input<string>, opts?: pulumi.ComponentResourceOptions): k8s.core.v1.PersistentVolume {
  const config = new pulumi.Config();
  const nfsHostname = config.require("nfs_hostname");
  const volumeHandle = `${nfsHostname}/${path}`;

  return new k8s.core.v1.PersistentVolume(name, {
    spec: {
      capacity: { storage: "1Gi" },
      accessModes: ["ReadWriteMany"],
      persistentVolumeReclaimPolicy: "Retain",
      csi: {
        driver: "nfs.csi.k8s.io",
        volumeHandle: volumeHandle,
        volumeAttributes: {
          server: nfsHostname,
          share: path,
        },
      },
    },
  }, opts);
}

export function createNFSStorage(name: string, path: pulumi.Input<string>, opts?: pulumi.ComponentResourceOptions) {
  const pv = createNFSPersistentVolume(`${name}-pv`, path, opts);
  const pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
    spec: {
      accessModes: ["ReadWriteMany"],
      resources: { requests: { storage: "1Gi" } },
      volumeName: pv.metadata.name,
    },
  }, opts);
  
  return { pv, pvc };
}