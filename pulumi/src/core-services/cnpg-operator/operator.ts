import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export class CNPGOperator extends pulumi.ComponentResource {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super("CNPGOperator", name, {}, opts);

    // Create namespace for CNPG operator
    const namespace = new k8s.core.v1.Namespace(
      "cnpg-system",
      {
        metadata: { name: "cnpg-system" },
      },
      { parent: this }
    );

    // Install CNPG operator using Helm chart
    const cnpgChart = new k8s.helm.v3.Chart(
      "cnpg-operator",
      {
        chart: "cloudnative-pg",
        version: "0.21.1", // Latest stable version as of implementation
        namespace: namespace.metadata.name,
        fetchOpts: {
          repo: "https://cloudnative-pg.github.io/charts",
        },
        values: {
          // Operator configuration optimized for small clusters
          replicaCount: 1,
          resources: {
            limits: { cpu: "200m", memory: "256Mi" },
            requests: { cpu: "100m", memory: "128Mi" },
          },
          config: {
            // Enable monitoring and logging
            monitoring: {
              enabled: false, // Disabled as per requirements
            },
            logging: {
              level: "info",
            },
          },
        },
      },
      { parent: this, dependsOn: [namespace] }
    );

    // Export the chart for dependency management
    this.registerOutputs({
      chart: cnpgChart,
      namespace: namespace.metadata.name,
    });
  }
}
