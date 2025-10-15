import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export class CNPGOperator extends pulumi.ComponentResource {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super("CNPGOperator", name, {}, opts);

    // Create namespace for CNPG operator
    const ns = new k8s.core.v1.Namespace(
      "cnpg-system",
      {
        metadata: {
          name: "cnpg-system",
        },
      },
      { parent: this }
    );

    // Install CNPG operator using Helm chart
    const cnpgChart = new k8s.helm.v3.Chart(
      "cnpg-operator",
      {
        chart: "cloudnative-pg",
        version: "0.25.0",
        namespace: ns.metadata.name,
        fetchOpts: {
          repo: "https://cloudnative-pg.github.io/charts",
        },
        values: {
          replicaCount: 1,
          resources: {
            limits: { cpu: "1000m", memory: "768Mi" },
            requests: { cpu: "200m", memory: "256Mi" },
          },
          config: {
            INHERITED_LABELS: ["app", "kube-image-keeper.enix.io/image-caching-policy"],
            monitoring: {
              enabled: false,
            },
            logging: {
              level: "info",
            },
          },
        },
      },
      { parent: this, dependsOn: [ns] }
    );

    // Export the chart for dependency management
    this.registerOutputs({
      chart: cnpgChart,
      namespace: ns.metadata.name,
    });
  }
}
