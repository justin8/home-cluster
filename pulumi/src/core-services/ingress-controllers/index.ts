import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DEFAULT_TLS_SECRET, PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "../../constants";
import { createIpAddressPool } from "../../utils";

export interface IngressControllersArgs {
  publicIP?: pulumi.Input<string>;
  privateIP?: pulumi.Input<string>;
}

export class IngressControllers extends pulumi.ComponentResource {
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
        version: "37.2.0",
        repositoryOpts: { repo: "https://traefik.github.io/charts" },
        namespace: type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
        createNamespace: true,
        values: {
          deployment: {
            replicas: 2,
          },
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
    const isPublic = type === "public";

    new k8s.apiextensions.CustomResource(
      `${type}-dashboard-ingressroute`,
      {
        apiVersion: "traefik.io/v1alpha1",
        kind: "IngressRoute",
        metadata: {
          name: "dashboard",
          namespace: isPublic ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
          annotations: {
            "external-dns.alpha.kubernetes.io/target": isPublic ? this.publicIP : this.privateIP,
          },
        },
        spec: {
          entryPoints: ["websecure"],
          routes: [
            {
              match: pulumi.interpolate`Host(\`traefik-${type}.${domain}\`)`,
              kind: "Rule",
              middlewares: [
                {
                  name: "tinyauth", // The short-name of a middleware is used in IngressRoutes, while the full name is used for a regular Ingress
                  namespace: type === "public" ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
                },
              ],
              services: [{ name: "api@internal", kind: "TraefikService" }],
            },
          ],
          tls: { secretName: DEFAULT_TLS_SECRET },
        },
      },
      { parent: this, dependsOn: [traefik] }
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

    this.publicIP = pulumi.output(publicIP);
    this.privateIP = pulumi.output(privateIP);

    this.createDashboard("public", publicTraefik, domain);
    this.createDashboard("private", privateTraefik, domain);
  }
}
