import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface NFDArgs {
  namespace?: pulumi.Input<string>;
}

export class NFD extends pulumi.ComponentResource {
  constructor(appName: string, args: NFDArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super(appName, appName, {}, opts);

    const namespace = "node-feature-discovery";
    const ns = new k8s.core.v1.Namespace(
      namespace,
      {
        metadata: {
          name: namespace,
          labels: {
            app: namespace,
            "pod-security.kubernetes.io/enforce": "privileged",
            "pod-security.kubernetes.io/audit": "privileged",
            "pod-security.kubernetes.io/warn": "privileged",
          },
        },
      },
      { parent: this }
    );

    new k8s.kustomize.v2.Directory(
      "nfd-manifests",
      {
        namespace: namespace,
        directory:
          "https://github.com/kubernetes-sigs/node-feature-discovery/deployment/overlays/default?ref=v0.17.4",
      },
      { parent: this, dependsOn: [ns] }
    );
  }
}
