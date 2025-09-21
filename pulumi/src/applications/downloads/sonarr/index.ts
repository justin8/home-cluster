import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { TauSecret } from "../../../constructs";
import { TauApplication, TauApplicationArgs } from "../../../constructs/tauApplication";

const config = new pulumi.Config();

export class Sonarr extends TauApplication {
  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const port = 8989;

    super(name, args, opts);

    const tvMount = this.volumeManager.addNFSMount("/mnt/pool/media/tv", "/media/tv");
    const downloadsMount = this.volumeManager.addNFSMount("/mnt/pool/downloads", "/downloads");
    const configMount = this.volumeManager.addLonghornVolume("/config", {
      backupEnabled: true,
      size: "2Gi",
    });
    const volumeMounts = [tvMount, downloadsMount, configMount];

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
                  image: "lscr.io/linuxserver/sonarr:4.0.15",
                  ports: [
                    {
                      containerPort: port,
                    },
                  ],
                  envFrom: [{ secretRef: { name: configSecret.name } }],
                  volumeMounts,
                  livenessProbe: {
                    httpGet: {
                      path: "/",
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

    this.createHttpIngress({ appName: name, port, labels: this.labels }, { dependsOn: [this.ns!] });
  }
}
