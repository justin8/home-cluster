import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { TauSecret } from "../../../constructs";
import { TauApplication, TauApplicationArgs } from "../../../constructs/tauApplication";

const config = new pulumi.Config();

export class JellySeerr extends TauApplication {
  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const port = 5055;

    super(name, args, opts);

    const configMount = this.volumeManager.addLonghornVolume("/app/config", {
      backupEnabled: true,
      size: "5Gi",
    });
    const volumeMounts = [configMount];

    const configSecret = new TauSecret(
      `${name}-config`,
      {
        namespace: this.namespace,
        data: {
          TZ: config.require("timezone"),
        },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    const deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: {
          namespace: this.namespace,
        },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: {
            matchLabels: this.labels,
          },
          template: {
            metadata: {
              labels: this.labels,
            },
            spec: {
              containers: [
                {
                  name: name,
                  image: "fallenbagel/jellyseerr:preview-OIDC",
                  ports: [
                    {
                      containerPort: port,
                    },
                  ],
                  envFrom: [{ secretRef: { name: configSecret.name } }],
                  volumeMounts,
                  livenessProbe: {
                    httpGet: {
                      path: "/api/v1/status",
                      port: port,
                    },
                    initialDelaySeconds: 30,
                    periodSeconds: 30,
                  },
                },
              ],
              volumes: this.volumeManager.getVolumes(),
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!, configSecret] }
    );

    this.createHttpIngress(
      { appName: name, port, labels: this.labels, public: true, auth: false },
      { dependsOn: [this.ns!] }
    );
  }
}
