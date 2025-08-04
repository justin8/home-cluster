import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauApplication } from "../../constructs";

export class DemoApp extends TauApplication {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(name, {}, opts);

    // Define volumes for the application
    // NFS mounts for shared network storage
    const gamesMount = this.volumeManager.addNFSMount("/storage/games");
    const moviesMount = this.volumeManager.addNFSMount("/storage/movies");

    // Longhorn volumes for persistent block storage
    const dataMount = this.volumeManager.createVolume("/data/demo", {
      size: "5Gi",
      backupEnabled: true,
    });

    // Deploy some resources for the application
    new k8s.apps.v1.Deployment(
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
                  volumeMounts: [gamesMount, moviesMount, dataMount],
                },
              ],
              // Pass the actual volume mounts to get only the volumes we need
              volumes: this.volumeManager.getVolumes([gamesMount, moviesMount, dataMount]),
            },
          },
        },
      },
      { parent: this }
    );

    // Get an external IP for the service
    new k8s.core.v1.Service(
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

    // Create an Ingress resource to expose the application
    this.createIngress({ port: 80 });
  }
}
