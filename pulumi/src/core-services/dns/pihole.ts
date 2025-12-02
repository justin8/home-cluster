import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauApplication, TauApplicationArgs, VolumeManager } from "../../constructs";
import { createVPA } from "../../utils";

const config = new pulumi.Config();

export interface PiHoleArgs extends TauApplicationArgs {
  namespace: string;
  piholeIP?: string;
  type: "primary" | "secondary";
  labels: Record<string, string>;
  volumeManager: VolumeManager;
}

export class PiHole extends TauApplication {
  constructor(name: string, args: PiHoleArgs, opts?: pulumi.ComponentResourceOptions) {
    super(name, args, opts);
    const { namespace, type, volumeManager } = args;

    const typeLabel = { "pihole/type": type };
    const labels = { ...args.labels, ...typeLabel };

    const env: k8s.types.input.core.v1.EnvVar[] = [
      {
        name: "FTLCONF_webserver_api_password",
        value: "", // Auth will be handled by Ingress
      },
      {
        name: "FTL_CMD",
        value: "no-daemon -- --interface=eth0", // Note to future self: this was a pain in the ass to find, it results in only a single log line, and 100% of queries via the load balancer being dropped 'WARNING: dnsmasq: ignoring query from non-local network 10.244.2.0 (logged only once)'
      },
    ];

    const etcPiholeMount = volumeManager.addLonghornVolume("/etc/pihole", {
      size: "100Mi",
      // accessMode: "ReadWriteMany", // Using single node pihole for now; this was only useful for multi-node as a read-only replica
    });

    const volumeMounts = [etcPiholeMount];
    if (type === "secondary") {
      volumeMounts.forEach(x => (x.readOnly = true));
    }

    const deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: { namespace, labels: { ...labels } },
        spec: {
          selector: { matchLabels: labels },
          replicas: 1,
          strategy: { type: "Recreate" },
          template: {
            metadata: { labels: { ...labels } },
            spec: {
              containers: [
                {
                  name,
                  image: "pihole/pihole",
                  ports: [
                    { name: "dns-tcp", containerPort: 53, protocol: "TCP" },
                    { name: "dns-udp", containerPort: 53, protocol: "UDP" },
                    { name: "http", containerPort: 80, protocol: "TCP" },
                  ],
                  resources: {
                    requests: {
                      cpu: "20m",
                      memory: "256Mi",
                    },
                    limits: {
                      cpu: "200m",
                      memory: "512Mi",
                    },
                  },
                  env,
                  volumeMounts,
                },
              ],
              volumes: volumeManager.getVolumes(volumeMounts),
            },
          },
        },
      },
      { parent: this }
    );

    createVPA({ workload: deployment }, { parent: this });

    if (type === "primary") {
      this.createHttpIngress(
        {
          appName: "pihole-web",
          subdomain: "pihole",
          port: 80,
          labels,
          public: false,
        },
        { parent: this }
      );
    }
  }
}
