import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export class IntelGPU extends pulumi.ComponentResource {
  constructor(appName: string, opts?: pulumi.ComponentResourceOptions) {
    super(appName, appName, {}, opts);

    const namespace = "intel-gpu";
    const ns = new k8s.core.v1.Namespace(
      namespace,
      {
        metadata: {
          name: namespace,
          labels: {
            app: namespace,
            "pod-security.kubernetes.io/enforce": "privileged",
            "pod-security.kubernetes.io/audit": "privileged",
            "pod-security.kubernetes.io/warn": "privileged",
          },
        },
      },
      { parent: this }
    );

    const operator = new k8s.helm.v3.Release(
      "device-plugin-operator",
      {
        chart: "intel-device-plugins-operator",
        version: "0.34.1",
        repositoryOpts: {
          repo: "https://intel.github.io/helm-charts/",
        },
        namespace: namespace,
      },
      { parent: this, dependsOn: [ns] }
    );

    new k8s.helm.v3.Release(
      "gpu-device-plugin",
      {
        chart: "intel-device-plugins-gpu",
        version: "0.34.1",
        repositoryOpts: {
          repo: "https://intel.github.io/helm-charts/",
        },
        namespace: namespace,
      },
      { parent: this, dependsOn: [ns, operator] }
    );
  }
}
