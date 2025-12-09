import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { TauApplication, TauApplicationArgs } from "../../constructs/tauApplication";

const config = new pulumi.Config();

export class HomeAutomation extends TauApplication {
  private mqttUserSecrets: Map<string, k8s.core.v1.Secret> = new Map();

  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
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
        database: {
          name: "homeassistant",
          storageSize: "10Gi",
        },
      },
      opts
    );

    this.createMqttBroker();
    this.createHomeAssistant();
    this.createZigbee2Mqtt();
  }

  private createMqttUsersSecrets(usernames: string[]) {
    usernames.forEach(username => {
      const password = new random.RandomPassword(
        `mqtt-${username}-password`,
        { length: 16, special: false },
        { parent: this }
      );

      const secret = new k8s.core.v1.Secret(
        `mqtt-${username}-credentials`,
        {
          metadata: {
            name: `mqtt-${username}-credentials`,
            namespace: this.namespace,
          },
          stringData: {
            username: username,
            password: password.result,
          },
        },
        { parent: this }
      );

      this.mqttUserSecrets.set(username, secret);
    });
  }

  private createMqttConfigMap() {
    const fs = require("fs");
    const path = require("path");

    const configPath = path.join(__dirname, "mosquitto.conf");
    const configContent = fs.readFileSync(configPath, "utf8");

    return new k8s.core.v1.ConfigMap(
      "mqtt-config",
      {
        metadata: {
          name: "mqtt-config",
          namespace: this.namespace,
        },
        data: {
          "mosquitto.conf": configContent,
        },
      },
      { parent: this }
    );
  }

  private createMqttInitCommand(usernames: string[]) {
    const passwdCommands = usernames.map(
      username =>
        `mosquitto_passwd -b /mosquitto/config/passwd ${username} $(cat /run/secrets/mqtt-${username}/password)`
    );

    const initScript = `
mkdir -p /mosquitto/config /mosquitto/log /mosquitto/data

touch /mosquitto/config/passwd
chmod 0700 /mosquitto/config/passwd

${passwdCommands.join(" && ")}
`;

    return ["sh", "-c", initScript];
  }

  private createMqttBroker() {
    const labels = { app: "mqtt" };
    const mqttConfigVolume = this.volumeManager.addLonghornVolume("/mosquitto", {
      size: "1Gi",
      backupEnabled: true,
    });

    const mqttUsers = ["homeassistant", "z2m", "test"];
    this.createMqttUsersSecrets(mqttUsers);
    const mqttConfigMap = this.createMqttConfigMap();
    const initCommand = this.createMqttInitCommand(mqttUsers);

    // Create volume mounts for each user's secret
    const secretVolumeMounts = mqttUsers.map(username => ({
      name: `mqtt-${username}-secret`,
      mountPath: `/run/secrets/mqtt-${username}`,
      readOnly: true,
    }));

    // Create volumes for each user's secret
    const secretVolumes = mqttUsers.map(username => ({
      name: `mqtt-${username}-secret`,
      secret: {
        secretName: this.mqttUserSecrets.get(username)!.metadata.name,
      },
    }));

    const mqttDeployment = new k8s.apps.v1.Deployment(
      "mqtt",
      {
        metadata: {
          namespace: this.namespace,
        },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: labels },
          template: {
            metadata: { labels },
            spec: {
              initContainers: [
                {
                  name: "mqtt-init",
                  image: "eclipse-mosquitto:2.0.22",
                  command: initCommand,
                  volumeMounts: [
                    mqttConfigVolume,
                    ...secretVolumeMounts,
                    {
                      name: "mqtt-config",
                      mountPath: "/mosquitto/config/mosquitto.conf",
                      subPath: "mosquitto.conf",
                      readOnly: true,
                    },
                  ],
                },
              ],
              containers: [
                {
                  name: "mosquitto",
                  image: "eclipse-mosquitto:2.0.22",
                  ports: [{ containerPort: 1883, name: "mqtt" }],
                  volumeMounts: [
                    mqttConfigVolume,
                    ...secretVolumeMounts,
                    {
                      name: "mqtt-config",
                      mountPath: "/mosquitto/config/mosquitto.conf",
                      subPath: "mosquitto.conf",
                      readOnly: true,
                    },
                  ],
                  livenessProbe: {
                    exec: {
                      command: [
                        "sh",
                        "-c",
                        "mosquitto_pub -u test -P $(cat /run/secrets/mqtt-test/password) -t test_topic -m test-message",
                      ],
                    },
                    initialDelaySeconds: 30,
                    periodSeconds: 30,
                  },
                },
              ],
              volumes: [
                ...this.volumeManager.getVolumes([mqttConfigVolume]),
                ...secretVolumes,
                {
                  name: "mqtt-config",
                  configMap: {
                    name: mqttConfigMap.metadata.name,
                  },
                },
              ],
            },
          },
        },
      },
      { parent: this }
    );

    this.createVPA({ workload: mqttDeployment });

    new k8s.core.v1.Service(
      "mqtt",
      {
        metadata: {
          namespace: this.namespace,
          labels,
          annotations: {
            "external-dns.alpha.kubernetes.io/hostname": `mqtt.${config.require("domain")}`,
          },
        },
        spec: {
          type: "LoadBalancer",
          selector: labels,
          ports: [{ port: 1883, targetPort: 1883, name: "mqtt", protocol: "TCP" }],
        },
      },
      { parent: this, dependsOn: [mqttDeployment] }
    );
  }

  private createHomeAssistant() {
    const labels = { app: "home-assistant" };
    const sharedUid = config.require("shared_uid");
    const sharedGid = config.require("shared_gid");

    const hassConfigVolume = this.volumeManager.addLonghornVolume("/config", {
      size: "5Gi",
      backupEnabled: true,
    });

    const hassDeployment = new k8s.apps.v1.Deployment(
      "home-assistant",
      {
        metadata: {
          namespace: this.namespace,
        },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: labels },
          template: {
            metadata: { labels },
            spec: {
              hostNetwork: true,
              containers: [
                {
                  name: "home-assistant",
                  image: "homeassistant/home-assistant:2025.12",
                  securityContext: {
                    privileged: true,
                  },
                  ports: [{ containerPort: 8123, name: "http" }],
                  volumeMounts: [hassConfigVolume],
                  env: [
                    { name: "TZ", value: config.require("timezone") },
                    { name: "PUID", value: sharedUid },
                    { name: "PGID", value: sharedGid },
                  ],
                  livenessProbe: {
                    httpGet: {
                      path: "/",
                      port: 8123,
                    },
                    initialDelaySeconds: 60,
                    periodSeconds: 30,
                  },
                },
              ],
              volumes: this.volumeManager.getVolumes([hassConfigVolume]),
            },
          },
        },
      },
      { parent: this }
    );

    this.createVPA({ workload: hassDeployment });

    new k8s.core.v1.Service(
      "home-assistant",
      {
        metadata: {
          namespace: this.namespace,
        },
        spec: {
          type: "LoadBalancer",
          selector: labels,
          ports: [{ port: 21063, targetPort: 21063, name: "homekit" }],
        },
      },
      { parent: this, dependsOn: [hassDeployment] }
    );

    this.createHttpIngress({
      labels,
      appName: "home-assistant",
      subdomain: "home-assistant",
      port: 8123,
      public: true,
      auth: false,
    });
  }

  private createZigbee2Mqtt() {
    const labels = { app: "zigbee2mqtt" };

    const zigbeeDataVolume = this.volumeManager.addLonghornVolume("/app/data", {
      size: "1Gi",
      backupEnabled: true,
      prefix: "zigbee2mqtt",
    });

    const z2mDeployment = new k8s.apps.v1.Deployment(
      "zigbee2mqtt",
      {
        metadata: {
          namespace: this.namespace,
        },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: labels },
          template: {
            metadata: { labels },
            spec: {
              containers: [
                {
                  name: "zigbee2mqtt",
                  image: "ghcr.io/koenkk/zigbee2mqtt:2.6.3",
                  ports: [{ containerPort: 8080, name: "http" }],
                  volumeMounts: [zigbeeDataVolume],
                  env: [{ name: "TZ", value: config.require("timezone") }],
                },
              ],
              volumes: [...this.volumeManager.getVolumes([zigbeeDataVolume])],
            },
          },
        },
      },
      { parent: this }
    );

    this.createVPA({ workload: z2mDeployment });

    this.createHttpIngress({
      labels,
      appName: "zigbee2mqtt",
      subdomain: "zigbee2mqtt",
      port: 8080,
      public: false,
      auth: true,
    });
  }
}
