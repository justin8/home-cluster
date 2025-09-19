import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface ExternalDnsArgs {
  namespace: string;
  provider: string;
  ingressClasses: string[];
  env?: k8s.types.input.core.v1.EnvVar[];
  extraArgs?: pulumi.Input<string>[];
  registry?: string;
}

export class ExternalDns extends pulumi.ComponentResource {
  constructor(name: string, args: ExternalDnsArgs, opts?: pulumi.ComponentResourceOptions) {
    super("core-services:ExternalDns", name, {}, opts);

    const { namespace, provider, ingressClasses, extraArgs } = args;
    const env = args.env || [];
    const ingressClassArgs = ingressClasses.map(cls => `--ingress-class=${cls}`);
    const registry = args.registry || "txt";

    new k8s.helm.v3.Release(
      name,
      {
        chart: "external-dns",
        version: "1.19.0",
        repositoryOpts: {
          repo: "https://kubernetes-sigs.github.io/external-dns/",
        },
        namespace: namespace,
        values: {
          provider: { name: provider },
          txtOwnerId: name,
          policy: "sync",
          sources: ["ingress", "traefik-proxy"],
          // logLevel: "debug",
          extraArgs: ["--traefik-disable-legacy", ...ingressClassArgs, ...(extraArgs || [])],
          registry,
          env,
        },
      },
      {
        parent: this,
      }
    );
  }
}
