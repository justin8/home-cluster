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
  public readonly publicIP: pulumi.Output<string>;
  public readonly privateIP: pulumi.Output<string>;

  private createIngressController(
    appName: string,
    type: string,
    ip: pulumi.Input<string>,
    version: pulumi.Input<string>,
    dependencies: pulumi.Resource[] = []
  ) {
    const pool = new k8s.apiextensions.CustomResource(
      `${appName}-${type}-pool`,
      {
        apiVersion: "metallb.io/v1beta1",
        kind: "IPAddressPool",
        metadata: {
          name: `${type}-ingress`,
          namespace: "metallb-system",
        },
        spec: { 
          addresses: [pulumi.interpolate`${ip}/32`],
          autoAssign: false
        },
      },
      { parent: this, dependsOn: dependencies }
    );

    const advertisement = new k8s.apiextensions.CustomResource(
      `${appName}-${type}-l2-advertisement`,
      {
        apiVersion: "metallb.io/v1beta1",
        kind: "L2Advertisement",
        metadata: {
          name: `${type}-ingress`,
          namespace: "metallb-system",
        },
        spec: {
          ipAddressPools: [`${type}-ingress`],
        },
      },
      { parent: this, dependsOn: [pool] }
    );

    return new k8s.helm.v3.Release(
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
      { parent: this, dependsOn: [pool, advertisement, ...dependencies] }
    );
  }

  constructor(
    appName: string,
    args: IngressControllersArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(appName, appName, {}, opts);

    const config = new pulumi.Config();
    const version = args.version || "30.1.0";
    const publicIP = args.publicIP || config.require("public_ingress_ip");
    const privateIP = args.privateIP || config.require("private_ingress_ip");

    const publicTraefik = this.createIngressController(appName, "public", publicIP, version);
    const privateTraefik = this.createIngressController(appName, "private", privateIP, version, [publicTraefik]);

    this.publicIngressClass = pulumi.output("traefik-public");
    this.privateIngressClass = pulumi.output("traefik-private");
    this.publicIP = pulumi.output(publicIP);
    this.privateIP = pulumi.output(privateIP);
  }
}
