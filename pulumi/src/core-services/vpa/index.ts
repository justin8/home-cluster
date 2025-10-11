import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface VerticalPodAutoscalerArgs {
  namespace?: pulumi.Input<string>;
}

export class VerticalPodAutoscaler extends pulumi.ComponentResource {
  constructor(
    appName: string,
    args: VerticalPodAutoscalerArgs = {},
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(appName, appName, {}, opts);

    const config = new pulumi.Config();
    const domain = config.require("domain");
    const namespace = args.namespace || "vpa";

    const ns = new k8s.core.v1.Namespace(
      `${appName}-ns`,
      {
        metadata: {
          name: namespace,
        },
      },
      { parent: this }
    );

    const vpaRelease = new k8s.helm.v3.Release(
      "vpa",
      {
        chart: "vpa",
        version: "4.9.0",
        repositoryOpts: {
          repo: "https://charts.fairwinds.com/stable",
        },
        namespace,
        values: {
          updater: {
            enabled: true,
            extraArgs: {
              "feature-gates": "InPlaceOrRecreate=true",
              "min-replicas": 1,
            },
          },
          recommender: {
            enabled: true,
          },
          admissionController: {
            enabled: true,
            registerWebhook: true,
            extraArgs: {
              "feature-gates": "InPlaceOrRecreate=true",
            },
          },
        },
      },
      { parent: this, dependsOn: [ns] }
    );
  }
}
