import * as pulumi from "@pulumi/pulumi";
import { createIngress, createService } from "../utils";
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
      },
    );

    this.labels = labels;
    this.volumeManager = new VolumeManager(this);
    this.domain = config.require("domain");
    this.applicationDomain = `${name}.${this.domain}`;
  }

  protected createIngress(args: CreateIngressArgs) {
    const {
      port,
      targetPort = port,
      public: isPublic = false,
      subdomain = this.labels.app,
    } = args;
    const appDomain = `${subdomain}.${this.domain}`;

    const service = createService({
      name: `${this.labels.app}-service`,
      port,
      targetPort,
      selector: this.labels,
      parent: this,
    });

    createIngress({
      name: `${this.labels.app}-ingress`,
      host: appDomain,
      serviceName: service.metadata.name,
      servicePort: port,
      public: isPublic,
      parent: this,
    });
  }
}
