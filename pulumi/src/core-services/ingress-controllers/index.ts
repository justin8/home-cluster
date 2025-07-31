import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface IngressControllersArgs {
  publicIP?: pulumi.Input<string>;
  privateIP?: pulumi.Input<string>;
  version?: pulumi.Input<string>;
}

export class IngressControllers extends pulumi.ComponentResource {
  public readonly publicIngressClass: pulumi.Output<string>;
  public readonly privateIngressClass: pulumi.Output<string>;

  constructor(
    appName: string,
    args: IngressControllersArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(appName, appName, {}, opts);

    const config = new pulumi.Config();
    const version = args.version || "30.1.0";
    const configs = [
      { type: "public", ip: args.publicIP || config.require("public_ingress_ip") },
      { type: "private", ip: args.privateIP || config.require("private_ingress_ip") },
    ];

    const pools = configs.map(
      ({ type, ip }) =>
        new k8s.apiextensions.CustomResource(
          `${appName}-${type}-pool`,
          {
            apiVersion: "metallb.io/v1beta1",
            kind: "IPAddressPool",
            metadata: {
              name: `${type}-ingress`,
              namespace: "metallb-system",
            },
            spec: { addresses: [`${ip}/32`] },
          },
          { parent: this }
        )
    );

    configs.forEach(
      ({ type }, i) =>
        new k8s.helm.v3.Release(
          `${appName}-${type}`,
          {
            chart: "traefik",
            version,
            repositoryOpts: { repo: "https://traefik.github.io/charts" },
            namespace: `traefik-${type}`,
            createNamespace: true,
            values: {
              ingressClass: {
                enabled: true,
                isDefaultClass: false,
                name: `traefik-${type}`,
              },
              service: {
                type: "LoadBalancer",
                annotations: {
                  "metallb.universe.tf/address-pool": `${type}-ingress`,
                },
              },
              providers: {
                kubernetesIngress: { ingressClass: `traefik-${type}` },
              },
            },
          },
          { parent: this, dependsOn: [pools[i]] }
        )
    );

    this.publicIngressClass = pulumi.output("traefik-public");
    this.privateIngressClass = pulumi.output("traefik-private");
  }
}
