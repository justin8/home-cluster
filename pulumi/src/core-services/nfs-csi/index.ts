import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface NFSCSIArgs {
  namespace?: pulumi.Input<string>;
}

export class NFSCSI extends pulumi.ComponentResource {
  constructor(
    appName: string,
    args: NFSCSIArgs = {},
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(appName, appName, {}, opts);

    const namespace = args.namespace || "kube-system";

    const helm = new k8s.helm.v3.Release("csi-driver-nfs", {
      chart: "csi-driver-nfs",
      version: "v4.11.0",
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
    }, { parent: this });
  }
}