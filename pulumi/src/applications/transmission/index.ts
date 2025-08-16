import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { TauSecret } from "../../constructs";
import { TauApplication, TauApplicationArgs } from "../../constructs/tauApplication";

const config = new pulumi.Config();

export class Transmission extends TauApplication {
  constructor(args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const name = "transmission";
    const port = 9091;

    super(name, { ...args, namespace: name, createNamespace: false }, opts);

    const ns = new k8s.core.v1.Namespace(
      name,
      {
        metadata: {
          name: name,
          labels: {
            app: name,
            "pod-security.kubernetes.io/enforce": "privileged",
            "pod-security.kubernetes.io/audit": "privileged",
            "pod-security.kubernetes.io/warn": "privileged",
          },
        },
      },
      opts
    );

    const storageMount = this.volumeManager.addNFSMount("/storage");
    const configMount = this.volumeManager.addLonghornVolume("/config", {
      backupEnabled: true,
      size: "500Mi",
    });
    const volumeMounts = [storageMount, configMount];

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
      { parent: this, dependsOn: [ns] }
    );

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
      { parent: this, dependsOn: [ns] }
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
                  volumeMounts: [
                    {
                      name: "vpn-config",
                      mountPath: "/etc/wireguard",
                    },
                  ],
                },
                {
                  name: name,
                  image: "lscr.io/linuxserver/transmission:4.0.6",
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
      { parent: this, dependsOn: [ns, configSecret, vpnSecret] }
    );

    this.createHttpIngress({ appName: name, port, labels: this.labels }, { dependsOn: [ns] });
  }
}
