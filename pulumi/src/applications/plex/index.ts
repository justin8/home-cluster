import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { TauApplication, TauApplicationArgs } from "../../constructs/tauApplication";

const config = new pulumi.Config();

export class Plex extends TauApplication {
  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const sharedUID = Number(config.require("shared_uid"));
    const sharedGID = Number(config.require("shared_gid"));
    const webPort = 32400;

    super(
      name,
      {
        ...args,
        namespace: name,
      },
      opts
    );

    const mediaMount = this.volumeManager.addNFSMount("/mnt/pool/media");
    const configMount = this.volumeManager.addLonghornVolume("/config", {
      size: "25Gi",
      backupEnabled: true,
    });

    const volumeMounts = [configMount, mediaMount];

    const deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: { namespace: this.namespace },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: this.labels },
          template: {
            metadata: { labels: this.labels },
            spec: {
              containers: [
                {
                  name: "plex",
                  image: "ghcr.io/linuxserver/plex:latest",
                  ports: [{ containerPort: webPort, name: "web" }],
                  env: [
                    { name: "TZ", value: config.require("timezone") },
                    { name: "PUID", value: sharedUID.toString() },
                    { name: "PGID", value: sharedGID.toString() },
                  ],
                  volumeMounts,
                  resources: {
                    requests: { "gpu.intel.com/i915": "1" },
                    limits: { "gpu.intel.com/i915": "1" },
                  },
                  livenessProbe: {
                    httpGet: { port: webPort, path: "/web" },
                    initialDelaySeconds: 60,
                  },
                  readinessProbe: {
                    httpGet: { port: webPort, path: "/web" },
                    initialDelaySeconds: 30,
                  },
                },
              ],
              volumes: this.volumeManager.getVolumes(),
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    this.createHttpIngress(
      {
        appName: name,
        port: webPort,
        auth: false,
        public: true,
      },
      { dependsOn: [this.ns!] }
    );
  }
}
