import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { createIpAddressPool } from "../../utils";

declare var require: any;

export interface MetalLBArgs {
  addresses: pulumi.Input<pulumi.Input<string>[]>;
  namespace?: pulumi.Input<string>;
}

export class MetalLB extends pulumi.ComponentResource {
  constructor(appName: string, args: MetalLBArgs, opts?: pulumi.ComponentResourceOptions) {
    super(appName, appName, {}, opts);

    const config: pulumi.Config = new pulumi.Config(appName);

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

    const helm = new k8s.helm.v3.Release(
      "metallb",
      {
        chart: "metallb",
        version: "v0.15",
        repositoryOpts: {
          repo: "https://metallb.github.io/metallb",
        },
        namespace: ns.metadata.name,
        values: {
          speaker: {
            ignoreExcludeLB: true,
          },
        },
      },
      { parent: this }
    );

    createIpAddressPool(
      {
        name: `${appName}-default`,
        ipAddresses: addresses,
        namespace: ns.metadata.name,
        autoAssign: true,
      },
      { parent: this }
    );
  }
}
