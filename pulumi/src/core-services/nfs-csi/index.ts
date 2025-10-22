import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface NFSCSIArgs {
  namespace?: pulumi.Input<string>;
}

export class NFSCSI extends pulumi.ComponentResource {
  private config = new pulumi.Config();

  constructor(appName: string, args: NFSCSIArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super(appName, appName, {}, opts);

    const nfsIp = this.config.require("nfs_ip");
    const namespace = args.namespace || "kube-system";

    const helm = new k8s.helm.v3.Release(
      "csi-driver-nfs",
      {
        chart: "csi-driver-nfs",
        version: "4.12.1",
        repositoryOpts: {
          repo: "https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts",
        },
        namespace: namespace,
        values: {
          driver: {
            name: "nfs.csi.k8s.io",
          },
          controller: {
            replicas: 1,
          },
        },
      },
      { parent: this }
    );

    new k8s.storage.v1.StorageClass("nfs-csi", {
      metadata: {
        name: "nfs-csi",
      },
      provisioner: "nfs.csi.k8s.io",
      parameters: {
        server: nfsIp,
        share: "/mnt/pool/apps/k8s",
      },
      reclaimPolicy: "Retain",
      allowVolumeExpansion: true,
      mountOptions: ["nfsver=4.1"],
    });
  }
}
