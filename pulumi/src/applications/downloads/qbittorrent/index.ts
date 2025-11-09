import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { TauSecret } from "../../../constructs";
import { TauApplication, TauApplicationArgs } from "../../../constructs/tauApplication";

const config = new pulumi.Config();

export class QBittorrent extends TauApplication {
  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const port = 8080;

    super(name, args, opts);

    const downloadsMount = this.volumeManager.addNFSMount("/mnt/pool/media/downloads");
    const configMount = this.volumeManager.addLonghornVolume("/config", {
      backupEnabled: true,
      size: "1Gi",
    });
    const volumeMounts = [downloadsMount, configMount];

    const vpnSecret = new TauSecret(
      `${name}-vpn`,
      {
        namespace: this.namespace,
        data: {
          "wg0.conf": config
            .requireSecret("wireguard-config")
            .apply(b64 => Buffer.from(b64, "base64").toString("utf8")),
        },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    const configSecret = new TauSecret(
      `${name}-config`,
      {
        namespace: this.namespace,
        data: {
          TZ: config.require("timezone"),
          PUID: config.require("shared_uid"),
          PGID: config.require("shared_gid"),
          TORRENTING_PORT: config.require("torrent_port"),
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
              securityContext: {
                sysctls: [
                  {
                    name: "net.ipv4.conf.all.src_valid_mark",
                    value: "1",
                  },
                ],
              },
              containers: [
                {
                  name: "vpn",
                  image: "jordanpotter/wireguard:latest",
                  securityContext: {
                    privileged: true,
                  },
                  lifecycle: {
                    postStart: {
                      exec: {
                        command: [
                          "sh",
                          "-c",
                          "sleep 30 && iptables -I OUTPUT 1 -d 10.244.0.0/16 -j ACCEPT", // Allow pods in the cluster to reach services running in the pod
                        ],
                      },
                    },
                  },
                  volumeMounts: [
                    {
                      name: "vpn-config",
                      mountPath: "/etc/wireguard",
                    },
                  ],
                },
                {
                  name: name,
                  image: "lscr.io/linuxserver/qbittorrent:20.04.1",
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
                    timeoutSeconds: 5,
                  },
                },
              ],
              volumes: [
                ...this.volumeManager.getVolumes(),
                {
                  name: "vpn-config",
                  secret: {
                    secretName: vpnSecret.name,
                  },
                },
              ],
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!, configSecret, vpnSecret] }
    );

    this.createHttpIngress({ appName: name, port, labels: this.labels }, { dependsOn: [this.ns!] });
    this.createVPA({ workload: deployment });
  }
}
