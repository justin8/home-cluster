import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { TauApplication, TauApplicationArgs } from "../../constructs/tauApplication";
import { TauSecret } from "../../constructs";

const config = new pulumi.Config();

export class Kavita extends TauApplication {
  constructor(args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const name = "kavita";
    const port = 5000;
    // When 0.8.8 is released, try out oauth integration: https://github.com/Kareadita/Kavita/discussions/2533
    const image = "lscr.io/linuxserver/kavita:0.8.7";

    super(name, { ...args, namespace: name }, opts);

    const booksMount = this.volumeManager.addNFSMount("/storage/books");
    const mangaComicsMount = this.volumeManager.addNFSMount("/storage/manga-comics");
    const volumeMounts = [booksMount, mangaComicsMount];

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
                  image,
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
      { dependsOn: [deployment] }
    );
  }
}
