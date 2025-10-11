import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { TauApplication, TauApplicationArgs } from "../../constructs/tauApplication";

const config = new pulumi.Config();

export class Syncthing extends TauApplication {
  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const sharedUID = Number(config.require("shared_uid"));
    const sharedGID = Number(config.require("shared_gid"));

    super(
      name,
      {
        ...args,
        namespace: name,
        namespaceLabels: {
          // Privileged mode is needed to allow for host ports
          "pod-security.kubernetes.io/enforce": "privileged",
          "pod-security.kubernetes.io/audit": "privileged",
          "pod-security.kubernetes.io/warn": "privileged",
        },
      },
      opts
    );

    const dataMount = this.volumeManager.addNFSMount("/mnt/pool/apps/syncthing", "/data");
    const configMount = this.volumeManager.addLonghornVolume("/config", {
      size: "500Mi",
      backupEnabled: true,
    });

    const volumeMounts = [dataMount, configMount];

    // Syncthing deployment
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
                  name: "syncthing",
                  image: "ghcr.io/linuxserver/syncthing:latest",
                  ports: [
                    { containerPort: 8384, hostPort: 8384, name: "web" },
                    { containerPort: 22000, hostPort: 22000, name: "sync-tcp" },
                    { containerPort: 22000, hostPort: 22000, protocol: "UDP", name: "sync-udp" },
                    { containerPort: 21027, hostPort: 21027, protocol: "UDP", name: "discovery" },
                  ],
                  env: [
                    { name: "TZ", value: config.require("timezone") },
                    { name: "PUID", value: sharedUID.toString() },
                    { name: "PGID", value: sharedGID.toString() },
                  ],
                  volumeMounts,
                  livenessProbe: {
                    httpGet: { port: 8384, path: "/" },
                    initialDelaySeconds: 30,
                  },
                  readinessProbe: {
                    httpGet: { port: 8384, path: "/" },
                    initialDelaySeconds: 10,
                  },
                },
              ],
              volumes: this.volumeManager.getVolumes(),
              securityContext: { fsGroup: sharedGID, fsGroupChangePolicy: "OnRootMismatch" },
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    this.createHttpIngress(
      {
        appName: name,
        port: 8384,
        auth: true,
        public: false,
      },
      { dependsOn: [this.ns!] }
    );

    this.createVPA({ workload: deployment });
  }
}
