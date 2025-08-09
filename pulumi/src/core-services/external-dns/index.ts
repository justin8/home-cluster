import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauSecret } from "../shared-secrets";

export interface ExternalDNSArgs {
  publicIngressClass: string;
  privateIngressClass: string;
  cloudflareSecret: TauSecret;
  // piholeSecret: TauSecret;
}

interface DeployExternalDNSArgs {
  namespace: string;
  provider: string;
  ingressClass: string;
  env?: k8s.types.input.core.v1.EnvVar[];
  extraArgs?: string[];
}

export class ExternalDNS extends pulumi.ComponentResource {
  constructor(name: string, args: ExternalDNSArgs, opts?: pulumi.ComponentResourceOptions) {
    super("core-services:ExternalDNS", name, {}, opts);
    const namespace = "kube-system";
    this.deployExternalDNS(
      {
        namespace,
        provider: "cloudflare",
        ingressClass: args.publicIngressClass,
        env: [
          {
            name: "CF_API_TOKEN",
            valueFrom: {
              secretKeyRef: {
                name: args.cloudflareSecret.name,
                key: "api-token",
              },
            },
          },
        ],
      },
      opts
    );
    // this.deployExternalDNS(namespace, "pihole", args.privateIngressClass, opts);
  }

  private deployExternalDNS(args: DeployExternalDNSArgs, opts?: pulumi.ComponentResourceOptions) {
    const { namespace, provider, ingressClass, extraArgs } = args;
    const name = `external-dns-${provider}-${ingressClass}`;
    const labels = { app: name };
    const env = args.env || [];

    // Create namespace if it doesn't exist
    // const ns = new k8s.core.v1.Namespace(
    //   namespace,
    //   {
    //     metadata: { name: namespace },
    //   },
    //   opts
    // );

    new k8s.helm.v3.Release(
      name,
      {
        chart: "external-dns",
        version: "1.18.0",
        repositoryOpts: {
          repo: "https://kubernetes-sigs.github.io/external-dns/",
        },
        namespace: namespace,
        values: {
          provider: { name: provider },
          txtOwnerId: ingressClass,
          policy: "sync",
          source: ["ingress"],
          extraArgs: [`--ingress-class=${ingressClass}`, ...(extraArgs || [])],
          env,
        },
      },
      {
        parent: this,
      }
    );
  }
}
