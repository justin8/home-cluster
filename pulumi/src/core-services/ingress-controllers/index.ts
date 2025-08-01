import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DEFAULT_TLS_SECRET } from "../../constants";

export interface IngressControllersArgs {
  publicIP?: pulumi.Input<string>;
  privateIP?: pulumi.Input<string>;
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
    dependencies: pulumi.Resource[] = []
  ) {
    const config = new pulumi.Config();
    const domain = config.require("domain");
    const isPrivate = type === "private";
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
        version: "37.0.0",
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
            kubernetesCRD: {
              namespaces: [`traefik-${type}`],
            },
          },
          ports: {
            web: {
              redirectTo: {
                port: "websecure",
              },
            },
          },
          ingressRoute: {
            dashboard: {
              enabled: false,
            },
          },

        },
      },
      { parent: this, dependsOn: [pool, advertisement, ...dependencies] }
    );
  }

  private createDashboard(type: string, traefik: k8s.helm.v3.Release, domain: string) {
    const middleware = new k8s.apiextensions.CustomResource(
      `${type}-dashboard-ip-allowlist`,
      {
        apiVersion: "traefik.io/v1alpha1",
        kind: "Middleware",
        metadata: {
          name: "local-ip-allowlist",
          namespace: `traefik-${type}`,
        },
        spec: {
          ipAllowList: {
            sourceRange: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
          },
        },
      },
      { parent: this, dependsOn: [traefik] }
    );

    new k8s.apiextensions.CustomResource(
      `${type}-dashboard-ingressroute`,
      {
        apiVersion: "traefik.io/v1alpha1",
        kind: "IngressRoute",
        metadata: {
          name: "dashboard",
          namespace: `traefik-${type}`,
        },
        spec: {
          entryPoints: ["websecure"],
          routes: [{
            match: pulumi.interpolate`Host(\`traefik-${type}.${domain}\`)`,
            kind: "Rule",
            middlewares: [{ name: "local-ip-allowlist", namespace: `traefik-${type}` }],
            services: [{ name: "api@internal", kind: "TraefikService" }],
          }],
          tls: { secretName: DEFAULT_TLS_SECRET },
        },
      },
      { parent: this, dependsOn: [middleware] }
    );
  }

  constructor(
    appName: string,
    args: IngressControllersArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(appName, appName, {}, opts);

    const config = new pulumi.Config();
    const publicIP = args.publicIP || config.require("public_ingress_ip");
    const privateIP = args.privateIP || config.require("private_ingress_ip");

    const publicTraefik = this.createIngressController(appName, "public", publicIP);
    const privateTraefik = this.createIngressController(appName, "private", privateIP, [publicTraefik]);

    const domain = config.require("domain");

    this.createDashboard("public", publicTraefik, domain);
    this.createDashboard("private", privateTraefik, domain);



    this.publicIngressClass = pulumi.output("traefik-public");
    this.privateIngressClass = pulumi.output("traefik-private");
    this.publicIP = pulumi.output(publicIP);
    this.privateIP = pulumi.output(privateIP);
  }
}
