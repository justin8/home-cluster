import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { TauSecret } from "../../constructs";
import { TauApplication, TauApplicationArgs } from "../../constructs/tauApplication";

const config = new pulumi.Config();

export class Kavita extends TauApplication {
  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const port = 5000;

    super(name, { ...args, namespace: name }, opts);

    const mediasMount = this.volumeManager.addNFSMount("/mnt/pool/media");
    const configMount = this.volumeManager.addLonghornVolume("/config", {
      backupEnabled: true,
      size: "10Gi",
    });
    const volumeMounts = [mediasMount, configMount];

    const configSecret = new TauSecret(
      `${name}-config`,
      {
        namespace: this.namespace,
        data: {
          TZ: config.require("timezone"),
          PUID: config.require("shared_uid"),
          PGID: config.require("shared_gid"),
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
                  // When 0.8.8 is released, try out oauth integration: https://github.com/Kareadita/Kavita/discussions/2533
                  image: "lscr.io/linuxserver/kavita:0.8.8",
                  ports: [
                    {
                      containerPort: port,
                    },
                  ],
                  envFrom: [{ secretRef: { name: configSecret.name } }],
                  volumeMounts,
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
      {
        appName: name,
        port,
        labels: this.labels,
        auth: false,
        // public: true,
      },
      { dependsOn: [this.ns!] }
    );

    this.createVPA({ workload: deployment });
  }
}
