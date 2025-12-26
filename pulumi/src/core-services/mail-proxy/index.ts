import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauApplication } from "../../constructs";

const config = new pulumi.Config();

export class MailProxy extends TauApplication {
  constructor(name: string, args = {}, opts?: pulumi.ComponentResourceOptions) {
    super(name, { ...args, namespace: "mail-proxy" }, opts);

    const spoolMount = this.volumeManager.addLonghornVolume("/var/spool/postfix", {
      backupEnabled: false,
      size: "100Mi",
    });

    const mailConfig = config.requireObject<{
      server: string;
      username: string;
      password: string;
    }>("email");
    const domain = config.require("domain");

    const mailSecrets = new k8s.core.v1.Secret(
      `${name}-secrets`,
      {
        metadata: {
          name: `${name}-secrets`,
          namespace: this.namespace,
        },
        stringData: {
          RELAYHOST: mailConfig.server,
          RELAYHOST_USERNAME: mailConfig.username,
          RELAYHOST_PASSWORD: mailConfig.password,
          ALLOWED_SENDER_DOMAINS: domain,
        },
      },
      { parent: this }
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
          strategy: { type: "Recreate" },
          selector: { matchLabels: this.labels },
          template: {
            metadata: { labels: this.labels },
            spec: {
              terminationGracePeriodSeconds: 120, // Give time for mail queue to clear
              containers: [
                {
                  name: "mail",
                  image: "boky/postfix:5.0.1",
                  ports: [{ name: "smtp", containerPort: 587, protocol: "TCP" }],
                  readinessProbe: {
                    exec: { command: ["sh", "-c", "/scripts/healthcheck.sh"] },
                    initialDelaySeconds: 10,
                    periodSeconds: 60,
                    timeoutSeconds: 8,
                  },
                  livenessProbe: {
                    exec: {
                      command: [
                        "sh",
                        "-c",
                        "ps axf | fgrep -v grep | egrep -q '\\{supervisord\\}|/usr/bin/supervisord' && ps axf | fgrep -v grep | egrep -q '(/usr/lib/postfix/sbin/|/usr/libexec/postfix/)master'",
                      ],
                    },
                    initialDelaySeconds: 5,
                  },
                  startupProbe: {
                    exec: {
                      command: [
                        "sh",
                        "-c",
                        "ps axf | fgrep -v grep | egrep -q '\\{supervisord\\}|/usr/bin/supervisord' && ps axf | fgrep -v grep | fgrep -q \"postfix-script\" && ps axf | fgrep -v grep | fgrep -q 'opendkim'",
                      ],
                    },
                    initialDelaySeconds: 5,
                  },
                  lifecycle: {
                    preStop: {
                      exec: {
                        command: [
                          "bash",
                          "-c",
                          'touch /tmp/container_is_terminating && while ! [[ "`mailq`" == *empty* ]]; do echo "Flushing queue..." && postfix flush; sleep 1; done; killall5 -15 supervisord',
                        ],
                      },
                    },
                  },
                  envFrom: [{ secretRef: { name: mailSecrets.metadata.name } }],
                  volumeMounts: [spoolMount],
                },
              ],
              volumes: this.volumeManager.getVolumes([spoolMount]),
            },
          },
        },
      },
      { parent: this }
    );

    const service = new k8s.core.v1.Service(
      `${name}-service`,
      {
        metadata: {
          name: "smtp",
          namespace: this.namespace,
        },
        spec: {
          type: "ClusterIP",
          ports: [{ port: 587, targetPort: "smtp", protocol: "TCP", name: "smtp" }],
          selector: this.labels,
        },
      },
      { parent: this, dependsOn: [deployment] }
    );
  }
}
