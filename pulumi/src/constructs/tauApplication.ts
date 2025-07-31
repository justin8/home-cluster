import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DEFAULT_TLS_SECRET, PRIVATE_INGRESS_CLASS } from "../constants";
import { VolumeManager } from "./volumeManager";

export abstract class TauApplication extends pulumi.ComponentResource {
  public readonly labels: { app: string };
  public readonly volumeManager: VolumeManager;
  public readonly domain: string;
  public readonly applicationDomain: string;
  public readonly defaultTlsSecret: string;

  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    const config = new pulumi.Config();
    const labels = { app: name };
    const transformation: pulumi.ResourceTransformation = (args) => {
      if (args.type.startsWith("kubernetes:")) {
        return {
          props: {
            ...args.props,
            metadata: {
              ...args.props.metadata,
              labels: {
                ...labels,
                ...args.props.metadata?.labels,
              },
            },
          },
          opts: args.opts,
        };
      }
      return undefined;
    };

    super(
      "TauApplication",
      name,
      {},
      {
        ...opts,
        transformations: [...(opts?.transformations || []), transformation],
      }
    );

    this.labels = labels;
    this.volumeManager = new VolumeManager(this);
    this.domain = config.require("domain");
    this.applicationDomain = `${name}.${this.domain}`;
    this.defaultTlsSecret = DEFAULT_TLS_SECRET;
  }

  protected createIngress(
    port: number,
    targetPort: number = port,
    ingressClass: string = PRIVATE_INGRESS_CLASS
  ) {
    const service = new k8s.core.v1.Service(
      `${this.labels.app}-service`,
      {
        spec: {
          type: "ClusterIP",
          ports: [{ port, targetPort, protocol: "TCP" }],
          selector: this.labels,
        },
      },
      { parent: this }
    );

    const ingress = new k8s.networking.v1.Ingress(
      `${this.labels.app}-ingress`,
      {
        spec: {
          ingressClassName: ingressClass,
          tls: [
            {
              hosts: [this.applicationDomain],
              secretName: this.defaultTlsSecret,
            },
          ],
          rules: [
            {
              host: this.applicationDomain,
              http: {
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                    backend: {
                      service: {
                        name: service.metadata.name,
                        port: { number: port },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      { parent: this }
    );
  }
}
