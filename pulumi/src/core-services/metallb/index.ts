import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

declare var require: any;

export interface MetalLBArgs {
  addresses: pulumi.Input<pulumi.Input<string>[]>;
  namespace?: pulumi.Input<string>;
  version?: pulumi.Input<string>;
}

export class MetalLB extends pulumi.ComponentResource {
  constructor(
    appName: string,
    args: MetalLBArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(appName, appName, {}, opts);

    const config: pulumi.Config = new pulumi.Config(appName);

    const version = args.version || "v0.15";
    const namespace = args.namespace || "metallb-system";
    const addresses = args.addresses;

    const ns = new k8s.core.v1.Namespace(
      `${appName}-ns`,
      {
        metadata: {
          name: namespace,
          labels: {
            "pod-security.kubernetes.io/enforce": "privileged",
            "pod-security.kubernetes.io/audit": "privileged",
            "pod-security.kubernetes.io/warn": "privileged",
          },
        },
      },
      { parent: this }
    );

    const helm = new k8s.helm.v3.Release("metallb", {
      chart: "metallb",
      version,
      repositoryOpts: {
        repo: "https://metallb.github.io/metallb",
      },
      namespace: ns.metadata.name,
      values: {
        speaker: {
          ignoreExcludeLB: true,
        },
      },
    });

    const addressPool = new k8s.apiextensions.CustomResource(
      `${appName}-address-pool`,
      {
        apiVersion: "metallb.io/v1beta1",
        kind: "IPAddressPool",
        metadata: {
          name: "default",
          namespace: ns.metadata.name,
        },
        spec: {
          addresses: addresses,
        },
      },
      {
        parent: this,
        dependsOn: [helm],
      }
    );

    const l2Advertisement = new k8s.apiextensions.CustomResource(
      `${appName}-l2-advertisement`,
      {
        apiVersion: "metallb.io/v1beta1",
        kind: "L2Advertisement",
        metadata: {
          name: "default",
          namespace: ns.metadata.name,
        },
        spec: {
          ipAddressPools: ["default"],
        },
      },
      {
        parent: this,
        dependsOn: [addressPool],
      }
    );
  }
}
