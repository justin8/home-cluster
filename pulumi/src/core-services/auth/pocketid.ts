import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { MAIL_PROXY_ENDPOINT, MAIL_PROXY_PORT } from "../../constants";
import { TauApplication, TauApplicationArgs } from "../../constructs";

const config = new pulumi.Config();

export interface PocketIdArgs extends TauApplicationArgs {
  namespace: string;
}

export class PocketId extends TauApplication {
  constructor(name: string, args: PocketIdArgs, opts?: pulumi.ComponentResourceOptions) {
    super(name, args, opts);

    const port = 1411;
    const dataMount = this.volumeManager.addLonghornVolume("/app/data", {
      backupEnabled: true,
    });

    const serviceAccount = new k8s.core.v1.ServiceAccount(
      name,
      {
        metadata: {
          name,
          namespace: this.namespace,
        },
        automountServiceAccountToken: true,
      },
      { ...opts, parent: this }
    );

    const configuration = new k8s.core.v1.Secret(
      `${name}-config`,
      {
        metadata: {
          name: `${name}-config`,
          namespace: this.namespace,
        },
        type: "Opaque",
        stringData: {
          UI_CONFIG_DISABLED: "true",
          APP_NAME: `${config.require("domain")} - Pocket ID`,
          SESSION_DURATION: (60 * 24 * 30).toString(),
          EMAIL_ONE_TIME_ACCESS_AS_ADMIN_ENABLED: "true",
          APP_URL: pulumi.interpolate`https://${this.applicationDomain}`,
          TRUST_PROXY: "true",
          SMTP_HOST: MAIL_PROXY_ENDPOINT,
          SMTP_PORT: MAIL_PROXY_PORT.toString(),
          MAXMIND_LICENSE_KEY: config.require("maxmind_license_key"),
        },
      },
      { ...opts, parent: this }
    );

    const statefulSet = new k8s.apps.v1.StatefulSet(
      name,
      {
        metadata: {
          name,
          namespace: this.namespace,
        },
        spec: {
          replicas: 1,
          selector: {
            matchLabels: this.labels,
          },
          template: {
            metadata: {
              labels: this.labels,
            },
            spec: {
              serviceAccountName: serviceAccount.metadata.name,
              containers: [
                {
                  name: "pocketid",
                  image: "ghcr.io/pocket-id/pocket-id:v1.11.2",
                  ports: [{ containerPort: port }],
                  volumeMounts: [dataMount],
                  envFrom: [{ secretRef: { name: configuration.metadata.name } }],
                  livenessProbe: {
                    httpGet: {
                      path: "/health",
                      port,
                    },
                  },
                  readinessProbe: {
                    httpGet: {
                      path: "/health",
                      port,
                    },
                  },
                },
              ],
              volumes: this.volumeManager.getVolumes([dataMount]),
            },
          },
        },
      },
      { ...opts, parent: this }
    );

    this.createHttpIngress(
      { appName: name, port, labels: this.labels, public: true, auth: false },
      { parent: this, dependsOn: [statefulSet] }
    );
  }
}
