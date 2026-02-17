import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { SHARED_SECRETS_NAMESPACE } from "../../constants";
import { TauSecret } from "../../constructs";

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
        version: "10.0.9",
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
          "api-token": config.requireSecret("cloudflare_api_token"),
        },
        allowedNamespaces: [
          "kube-system",
          "cert-manager",
          "dns",
          "traefik-private",
          "traefik-public",
        ],
      },
      { parent: this }
    );
  }
}
