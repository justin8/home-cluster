import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauApplication, createNFSStorage } from "../../constructs";

export class DemoApp extends TauApplication {
  public readonly service: k8s.core.v1.Service;
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly pv: k8s.core.v1.PersistentVolume;
  public readonly pvc: k8s.core.v1.PersistentVolumeClaim;

  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(name, opts);

    const storage = createNFSStorage(name, "/storage/games", { parent: this });
    this.pv = storage.pv;
    this.pvc = storage.pvc;

    this.deployment = new k8s.apps.v1.Deployment(
      name,
      {
        spec: {
          selector: { matchLabels: this.labels },
          replicas: 1,
          template: {
            metadata: { labels: this.labels },
            spec: {
              containers: [
                {
                  name: name,
                  image: "nginx",
                  ports: [{ containerPort: 80, protocol: "TCP" }],
                  volumeMounts: [
                    {
                      name: "games-storage",
                      mountPath: "/storage/games",
                    },
                  ],
                },
              ],
              volumes: [
                {
                  name: "games-storage",
                  persistentVolumeClaim: { claimName: this.pvc.metadata.name },
                },
              ],
            },
          },
        },
      },
      { parent: this }
    );

    this.service = new k8s.core.v1.Service(
      name,
      {
        spec: {
          type: "LoadBalancer",
          ports: [{ port: 80, targetPort: 80, protocol: "TCP" }],
          selector: this.labels,
        },
      },
      { parent: this }
    );
  }

  public get hostname() {
    return this.service.status.loadBalancer.apply(
      (lb) => lb.ingress[0].hostname || lb.ingress[0].ip
    );
  }
}
