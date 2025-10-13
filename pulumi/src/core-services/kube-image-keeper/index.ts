import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export class KubeImageKeeper extends pulumi.ComponentResource {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super("tau:core-services:KubeImageKeeper", name, {}, opts);

    const namespace = new k8s.core.v1.Namespace(
      `${name}-namespace`,
      {
        metadata: {
          name: "kuik",
          labels: {
            "pod-security.kubernetes.io/enforce": "privileged",
          },
        },
      },
      { parent: this }
    );

    new k8s.helm.v3.Release(
      "kuik",
      {
        chart: "kube-image-keeper",
        repositoryOpts: {
          repo: "https://charts.enix.io/",
        },
        namespace: namespace.metadata.name,
        values: {
          fullnameOverride: "kuik",
          registry: {
            replicas: 2,
            persistence: {
              enabled: true,
              accessModes: "ReadWriteMany",
              storageClass: "longhorn-static",
            },
          },
        },
      },
      { parent: this, dependsOn: [namespace] }
    );
  }
}
