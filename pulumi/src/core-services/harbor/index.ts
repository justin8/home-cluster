import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauApplication, TauApplicationArgs } from "../../constructs";
import {
  DEFAULT_TLS_SECRET,
  PRIVATE_INGRESS_CLASS,
  PRIVATE_AUTH_MIDDLEWARE,
} from "../../constants";

const config = new pulumi.Config();

export interface HarborArgs extends TauApplicationArgs {
  namespace?: string;
}

export class Harbor extends TauApplication {
  constructor(name: string, args: HarborArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super(name, args, opts);

    // Deploy Harbor using Helm
    const harbor = new k8s.helm.v3.Release(
      name,
      {
        chart: "harbor",
        version: "1.10.0",
        repositoryOpts: {
          repo: "https://helm.goharbor.io",
        },
        namespace: this.namespace,
        values: {
          expose: {
            type: "ingress",
            tls: {
              enabled: true,
              certSource: "secret",
              secret: {
                secretName: DEFAULT_TLS_SECRET,
              },
            },
            ingress: {
              hosts: {
                core: this.applicationDomain,
              },
              className: PRIVATE_INGRESS_CLASS,
              annotations: {
                "traefik.ingress.kubernetes.io/router.middlewares": PRIVATE_AUTH_MIDDLEWARE,
              },
            },
          },
          externalURL: pulumi.interpolate`https://${this.applicationDomain}`,
          persistence: {
            enabled: true,
            persistentVolumeClaim: {
              registry: {
                size: "30Gi",
              },
            },
          },
        },
      },
      { parent: this }
    );
  }
}
