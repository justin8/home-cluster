import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { SHARED_SECRETS_NAMESPACE } from "../../constants";
import { reflectorAnnotationsForNamespaces } from "../../utils";

const config = new pulumi.Config();

export class SharedSecrets extends pulumi.ComponentResource {
  public readonly cloudflareSecret: TauSecret;

  constructor(appName: string, opts?: pulumi.ComponentResourceOptions) {
    super(appName, appName, {}, opts);

    const ns = new k8s.core.v1.Namespace(
      SHARED_SECRETS_NAMESPACE,
      {
        metadata: {
          name: SHARED_SECRETS_NAMESPACE,
        },
      },
      { parent: this }
    );

    const reflector = new k8s.helm.v3.Release(
      "reflector",
      {
        chart: "reflector",
        version: "9.1.22",
        repositoryOpts: {
          repo: "https://emberstack.github.io/helm-charts",
        },
        namespace: ns.metadata.name,
        values: {
          priorityClassName: "system-cluster-critical",
        },
      },
      { parent: this }
    );

    this.cloudflareSecret = new TauSecret(
      "cloudflare-api-token",
      {
        data: {
          email: config.require("cloudflare_email"),
          "api-token": config.requireSecret("cloudflare_api_token"),
        },
        allowedNamespaces: [
          "kube-system",
          "cert-manager",
          "external-dns",
          "traefik-private",
          "traefik-public",
        ],
      },
      { parent: this }
    );
  }
}

interface TauSecretArgs {
  data: { [key: string]: pulumi.Input<string> };
  allowedNamespaces: string[];
}

export class TauSecret extends pulumi.ComponentResource {
  public readonly name: string;
  public readonly secret: k8s.core.v1.Secret;
  public readonly data: { [key: string]: pulumi.Input<string> };

  constructor(name: string, args: TauSecretArgs, opts?: pulumi.ComponentResourceOptions) {
    super(name, name, {}, opts);
    this.name = name;
    this.data = args.data;
    this.secret = new k8s.core.v1.Secret(
      name,
      {
        metadata: {
          name,
          namespace: SHARED_SECRETS_NAMESPACE,
          annotations: reflectorAnnotationsForNamespaces(args.allowedNamespaces),
        },
        stringData: this.data,
      },
      opts
    );
  }
}
