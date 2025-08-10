import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DEFAULT_TLS_SECRET, PUBLIC_INGRESS_CLASS, PRIVATE_INGRESS_CLASS } from "../../constants";
import { createIpAddressPool } from "../../utils";

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
    type: "public" | "private",
    ip: pulumi.Input<string>,
    dependsOn: pulumi.Resource[] = []
  ) {
    const poolName = createIpAddressPool(
      {
        name: `${type}-ingress`,
        ipAddresses: [pulumi.interpolate`${ip}/32`],
      },
      {
        parent: this,
        dependsOn,
      }
    );

    return new k8s.helm.v3.Release(
      `${appName}-${type}`,
      {
        chart: "traefik",
        version: "37.0.0",
        repositoryOpts: { repo: "https://traefik.github.io/charts" },
        namespace: type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
        createNamespace: true,
        values: {
          ingressClass: {
            enabled: true,
            isDefaultClass: false,
            name: type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
          },
          service: {
            type: "LoadBalancer",
            annotations: {
              "metallb.io/address-pool": poolName,
            },
          },
          providers: {
            kubernetesIngress: {
              ingressClass: type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
            },
            kubernetesCRD: {
              namespaces: [type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS],
            },
          },
          ports: {
            web: {
              redirections: {
                entryPoint: {
                  to: "websecure",
                  scheme: "https",
                  permanent: "true",
                },
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
      { parent: this, dependsOn: dependsOn }
    );
  }

  private createDashboard(
    type: "public" | "private",
    traefik: k8s.helm.v3.Release,
    domain: string
  ) {
    const middleware = new k8s.apiextensions.CustomResource(
      `${type}-dashboard-ip-allowlist`,
      {
        apiVersion: "traefik.io/v1alpha1",
        kind: "Middleware",
        metadata: {
          name: "local-ip-allowlist",
          namespace: type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
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
          namespace: type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
        },
        spec: {
          entryPoints: ["websecure"],
          routes: [
            {
              match: pulumi.interpolate`Host(\`traefik-${type}.${domain}\`)`,
              kind: "Rule",
              middlewares: [
                {
                  name: "local-ip-allowlist",
                  namespace: type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
                },
              ],
              services: [{ name: "api@internal", kind: "TraefikService" }],
            },
          ],
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
    const privateTraefik = this.createIngressController(appName, "private", privateIP, [
      publicTraefik,
    ]);

    const domain = config.require("domain");

    this.createDashboard("public", publicTraefik, domain);
    this.createDashboard("private", privateTraefik, domain);

    this.publicIngressClass = pulumi.output(PUBLIC_INGRESS_CLASS);
    this.privateIngressClass = pulumi.output(PRIVATE_INGRESS_CLASS);
    this.publicIP = pulumi.output(publicIP);
    this.privateIP = pulumi.output(privateIP);
  }
}
