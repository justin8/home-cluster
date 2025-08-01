import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DEFAULT_TLS_SECRET, PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "../constants";
import { VolumeManager } from "./volumeManager";

interface CreateIngressArgs {
  port: number;
  /** @default port */
  targetPort?: number;
  /** @default false */
  public?: boolean;
  /** @default name */
  subdomain?: string;
}

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

  protected createIngress(args: CreateIngressArgs) {
    const { port, targetPort = port, public: isPublic = false, subdomain = this.labels.app } = args;
    const ingressClass = isPublic ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS;
    const appDomain = `${subdomain}.${this.domain}`;
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
        metadata: {
          annotations: {
            "pulumi.com/skipAwait": "true",
          },
        },
        spec: {
          ingressClassName: ingressClass,
          tls: [
            {
              hosts: [appDomain],
              secretName: this.defaultTlsSecret,
            },
          ],
          rules: [
            {
              host: appDomain,
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
