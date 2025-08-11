import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauApplication, TauApplicationArgs } from "../../constructs";

export interface PocketIdArgs extends TauApplicationArgs {
  namespace: string;
}

export class PocketId extends TauApplication {
  constructor(name: string, args: PocketIdArgs, opts?: pulumi.ComponentResourceOptions) {
    super(name, args, opts);

    const port = 1411;
    const dataMount = this.volumeManager.addLonghornVolume("/app/backend/data", {
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

    const deployment = new k8s.apps.v1.Deployment(
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
                  image: "ghcr.io/pocket-id/pocket-id:v1.7.0",
                  ports: [{ containerPort: port }],
                  volumeMounts: [dataMount],
                  env: [
                    {
                      name: "APP_URL",
                      value: pulumi.interpolate`https://${this.applicationDomain}`,
                    },
                    {
                      name: "TRUST_PROXY",
                      value: "true",
                    },
                  ],
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
      { parent: this, dependsOn: [deployment] }
    );
  }
}
