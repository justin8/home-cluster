import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

import { TauSecret } from "../../constructs";
import { TauApplication, TauApplicationArgs } from "../../constructs/tauApplication";
import { createService, getServiceURL } from "../../utils";

const config = new pulumi.Config();

export class Grist extends TauApplication {
  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const gristConfig = new pulumi.Config("grist");
    const redisName = "redis";
    const redisDb = "0";

    super(
      name,
      {
        ...args,
        namespace: name,
        namespaceLabels: {
          "pod-security.kubernetes.io/enforce": "privileged",
          "pod-security.kubernetes.io/audit": "privileged",
          "pod-security.kubernetes.io/warn": "privileged",
        },
      },
      opts
    );

    const persistMount = this.volumeManager.addLonghornVolume("/persist", {
      backupEnabled: true,
      size: "20Gi",
    });

    const redisDataMount = this.volumeManager.addLonghornVolume("/data", {
      backupEnabled: true,
      size: "2Gi",
    });

    const sessionSecret = new random.RandomPassword(
      `${name}-session-secret`,
      { length: 32 },
      { parent: this }
    ).result;

    const redisPassword = new random.RandomPassword(
      `${name}-redis-password`,
      {
        length: 32,
        special: false,
      },
      { parent: this }
    ).result;

    const gristSecret = new TauSecret(
      `${name}-secret`,
      {
        namespace: this.namespace,
        data: {
          GRIST_DEFAULT_EMAIL: config.require("admin_email"),
          GRIST_OIDC_IDP_ISSUER: pulumi.interpolate`https://pocketid.${this.domain}`,
          GRIST_OIDC_IDP_CLIENT_ID: gristConfig.requireSecret("oidc_client_id"),
          GRIST_OIDC_IDP_CLIENT_SECRET: gristConfig.requireSecret("oidc_client_secret"),
          APP_HOME_URL: pulumi.interpolate`https://${this.applicationDomain}`,
          REDIS_URL: pulumi.interpolate`redis://:${redisPassword}@${getServiceURL(redisName, this.namespace)}/${redisDb}`,
          GRIST_SESSION_SECRET: sessionSecret,
          GRIST_SANDBOX_FLAVOR: "gvisor", // This prevents network calls from functions
          GRIST_EXPERIMENTAL_PLUGINS: "1",
          GRIST_ENABLE_REQUEST_FUNCTION: "1", // THis plus experimental functions enables the REQUEST function
          GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING: "false",
          GRIST_ANON_PLAYGROUND: "false",
          GRIST_MANAGED_WORKERS: "true",
        },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    const redisDeployment = new k8s.apps.v1.Deployment(
      `${name}-${redisName}`,
      {
        metadata: { name: redisName, namespace: this.namespace },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: { app: redisName } },
          template: {
            metadata: { labels: { app: redisName } },
            spec: {
              containers: [
                {
                  name: "redis",
                  image: "docker.io/valkey/valkey:8-bookworm",
                  command: [
                    "/bin/sh",
                    "-c",
                    'valkey-server --requirepass "$REDIS_PASSWORD" --dir /data --save 60 1000',
                  ],
                  ports: [{ containerPort: 6379 }],
                  env: [
                    {
                      name: "REDIS_PASSWORD",
                      value: redisPassword,
                    },
                  ],
                  volumeMounts: [redisDataMount],
                  livenessProbe: {
                    exec: { command: ["/bin/sh", "-c", 'valkey-cli -a "$REDIS_PASSWORD" ping'] },
                    initialDelaySeconds: 30,
                  },
                  readinessProbe: {
                    exec: { command: ["/bin/sh", "-c", 'valkey-cli -a "$REDIS_PASSWORD" ping'] },
                    initialDelaySeconds: 30,
                  },
                },
              ],
              volumes: this.volumeManager.getVolumes([redisDataMount]),
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    const redisService = createService(
      {
        appName: redisName,
        port: 6379,
        namespace: this.namespace,
        labels: { app: redisName },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    const gristDeployment = new k8s.apps.v1.Deployment(
      `${name}-server`,
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
                  name: "grist",
                  image: "gristlabs/grist:latest",
                  ports: [{ containerPort: 8484 }],
                  envFrom: [{ secretRef: { name: gristSecret.name } }],
                  volumeMounts: [persistMount],
                  securityContext: {
                    capabilities: {
                      add: ["SYS_PTRACE"],
                    },
                  },
                },
              ],
              volumes: this.volumeManager.getVolumes([persistMount]),
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!, gristSecret, redisService] }
    );

    this.createHttpIngress(
      {
        appName: name,
        port: 8484,
        auth: true,
        public: true,
      },
      { dependsOn: [this.ns!] }
    );

    this.createVPA({ workload: redisDeployment });
    this.createVPA({ workload: gristDeployment });
  }
}
