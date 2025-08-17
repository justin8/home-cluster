import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

import { TauSecret } from "../../constructs";
import { TauApplication, TauApplicationArgs } from "../../constructs/tauApplication";
import { createService, getServiceURL } from "../../utils";

const config = new pulumi.Config();

export class Immich extends TauApplication {
  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const sharedUID = Number(config.require("shared_uid"));
    const sharedGID = Number(config.require("shared_gid"));
    const immichVersion = "v1.138.0";
    const databaseImage = "ghcr.io/tensorchord/cloudnative-vectorchord:17-0.4.3";
    const redisName = "redis";
    const mlName = "ml";

    const databaseSpecOverride = {
      postgresql: {
        shared_preload_libraries: ["vchord.so"],
      },

      bootstrap: {
        initdb: {
          postInitSQL: [
            "CREATE EXTENSION vchord CASCADE",
            'CREATE EXTENSION IF NOT EXISTS "cube" CASCADE',
            'CREATE EXTENSION IF NOT EXISTS "earthdistance" CASCADE',
          ],
        },
      },
    };

    super(
      name,
      {
        ...args,
        namespace: name,
        database: {
          name: "immich-database",
          storageSize: "5Gi",
          image: databaseImage,
          namespace: name,
          specOverride: databaseSpecOverride,
          superUser: true,
        },
      },
      opts
    );

    // Add storage volumes
    const dataMount = this.volumeManager.addNFSMount("/storage/immich", "/data");
    const modelCacheMount = this.volumeManager.addLonghornVolume("/cache", {
      backupEnabled: false,
      size: "10Gi",
    });

    const redisPassword = new random.RandomPassword(`${name}-redis-password`, { length: 32 })
      .result;
    const configSecret = new TauSecret(
      `${name}-config-secret`,
      {
        namespace: this.namespace,
        data: {
          TZ: config.require("timezone"),
          IMMICH_PORT: "2283",
          REDIS_PORT: "6379",
          REDIS_PASSWORD: redisPassword,
          REDIS_HOSTNAME: getServiceURL(redisName, this.namespace),
        },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    const databaseSecret = new TauSecret(
      `${name}-database-secret`,
      {
        namespace: this.namespace,
        data: {
          DB_PASSWORD: this.database!.connectionSecret.data.password,
          DB_USERNAME: this.database!.connectionSecret.data.username,
          DB_DATABASE_NAME: this.database!.connectionSecret.data.database,
          DB_PORT: this.database!.connectionSecret.data.port,
          DB_HOSTNAME: this.database!.connectionSecret.data.host,
        },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    // Redis deployment
    const redisDeployment = new k8s.apps.v1.Deployment(
      redisName,
      {
        metadata: { namespace: this.namespace },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: { app: redisName } },
          template: {
            metadata: { labels: { app: redisName } },
            spec: {
              securityContext: {
                fsGroup: sharedGID,
              },
              containers: [
                {
                  name: "redis",
                  image: "docker.io/valkey/valkey:8-bookworm",
                  command: ["/bin/sh", "-c", 'valkey-server --requirepass "$REDIS_PASSWORD"'],
                  ports: [{ containerPort: Number(configSecret.data.REDIS_PORT) }],
                  envFrom: [{ secretRef: { name: configSecret.name } }],
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
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!, configSecret] }
    );

    const redisService = createService(
      {
        appName: redisName,
        port: Number(configSecret.data.REDIS_PORT),
        namespace: this.namespace,
        labels: { app: redisName },
      },
      { parent: this, dependsOn: [this.ns!] }
    );

    // Immich machine learning deployment
    const mlDeployment = new k8s.apps.v1.Deployment(
      mlName,
      {
        metadata: { namespace: this.namespace },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: { app: mlName } },
          template: {
            metadata: { labels: { app: mlName } },
            spec: {
              securityContext: {
                fsGroup: sharedGID,
              },
              containers: [
                {
                  name: "immich-ml",
                  image: `ghcr.io/immich-app/immich-machine-learning:${immichVersion}`,
                  ports: [{ containerPort: Number(configSecret.data.IMMICH_PORT) }],
                  envFrom: [
                    { secretRef: { name: configSecret.name } },
                    { secretRef: { name: databaseSecret.name } },
                  ],
                  volumeMounts: [modelCacheMount],
                  // resources: {
                  //   limits: {
                  //     "gpu.intel.com/i915": "1", // Make this an option to the constructor args to choose acceleration type
                  //   },
                  // },
                  livenessProbe: {
                    exec: { command: ["python", "healthcheck.py"] },
                  },
                  readinessProbe: {
                    exec: { command: ["python", "healthcheck.py"] },
                  },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    runAsNonRoot: true,
                    runAsUser: sharedUID,
                    runAsGroup: sharedGID,
                    capabilities: {
                      drop: ["ALL"],
                    },
                  },
                },
              ],
              volumes: this.volumeManager.getVolumes([modelCacheMount]),
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!, configSecret] }
    );

    createService(
      {
        appName: mlName,
        port: Number(configSecret.data.IMMICH_PORT),
        namespace: this.namespace,
        labels: { app: mlName },
      },
      { parent: this }
    );

    // Immich server deployment
    const serverDeployment = new k8s.apps.v1.Deployment(
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
              securityContext: {
                fsGroup: sharedGID,
                fsGroupChangePolicy: "OnRootMismatch",
              },
              initContainers: [
                {
                  name: "postgresql-isready",
                  image: databaseImage,
                  envFrom: [
                    { secretRef: { name: configSecret.name } },
                    { secretRef: { name: databaseSecret.name } },
                  ],
                  command: [
                    "/bin/sh",
                    "-cu",
                    'until pg_isready "--user=${DB_USERNAME}" "--dbname=${DB_DATABASE_NAME}" "--host=${DB_HOSTNAME}" "--port=${DB_PORT}" ; do sleep 2 ; done',
                  ],
                },
              ],
              containers: [
                {
                  name: "immich-server",
                  image: `ghcr.io/immich-app/immich-server:${immichVersion}`,
                  ports: [{ containerPort: Number(configSecret.data.IMMICH_PORT) }],
                  envFrom: [
                    { secretRef: { name: configSecret.name } },
                    { secretRef: { name: databaseSecret.name } },
                  ],
                  livenessProbe: {
                    // Make this slow so Kubernetes won't kill it during migrations on upgrade
                    httpGet: { port: Number(configSecret.data.IMMICH_PORT), path: "/" },
                    initialDelaySeconds: 600,
                    periodSeconds: 60,
                  },
                  readinessProbe: {
                    httpGet: { port: Number(configSecret.data.IMMICH_PORT), path: "/" },
                  },
                  volumeMounts: [dataMount],
                  // resources: {
                  //   limits: {
                  //     "gpu.intel.com/i915": "1",
                  //   },
                  // },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    runAsNonRoot: true,
                    runAsUser: sharedUID,
                    runAsGroup: sharedGID,
                    capabilities: {
                      drop: ["ALL"],
                    },
                  },
                },
              ],

              volumes: this.volumeManager.getVolumes(),
            },
          },
        },
      },
      { parent: this, dependsOn: [this.ns!, this.database!, configSecret, redisService] }
    );

    // Create ingress for Immich server
    this.createHttpIngress(
      {
        appName: name,
        port: Number(configSecret.data.IMMICH_PORT),
        auth: false,
        public: true,
      },
      { dependsOn: [this.ns!] }
    );
  }
}
