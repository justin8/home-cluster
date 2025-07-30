import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauApplication } from "../../constructs";

export class DemoApp extends TauApplication {
  public readonly service: k8s.core.v1.Service;
  public readonly deployment: k8s.apps.v1.Deployment;

  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(name, opts);

    const gamesMount = this.volumeManager.addNFSMount("/storage/games");
    const moviesMount = this.volumeManager.addNFSMount("/storage/movies");

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
                  volumeMounts: [gamesMount, moviesMount],
                },
              ],
              volumes: this.volumeManager.getVolumes(),
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
