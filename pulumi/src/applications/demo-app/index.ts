import * as k8s from "@pulumi/kubernetes";

export class DemoApp {
  public readonly service: k8s.core.v1.Service;
  public readonly deployment: k8s.apps.v1.Deployment;

  constructor(name: string) {
    const appLabels = { app: name };

    this.deployment = new k8s.apps.v1.Deployment(name, {
      metadata: { labels: appLabels },
      spec: {
        selector: { matchLabels: appLabels },
        replicas: 1,
        template: {
          metadata: { labels: appLabels },
          spec: {
            containers: [{
              name: name, image: "nginx", ports: [
                { containerPort: 80, protocol: "TCP" }
              ],
            }],
          },
        },
      },
    });

    this.service = new k8s.core.v1.Service(name, {
      metadata: { labels: this.deployment.spec.template.metadata.labels },
      spec: {
        type: "LoadBalancer",
        ports: [{ port: 80, targetPort: 80, protocol: "TCP" }],
        selector: appLabels,
      },
    });
  }

  public get hostname() {
    return this.service.status.loadBalancer.apply(
      (lb) => lb.ingress[0].hostname || lb.ingress[0].ip
    );
  }
}