import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { DEFAULT_TLS_SECRET } from "../constants";
import { createIngress, createService } from "../utils";
import { createDatabase, DatabaseOptions, DatabaseResult } from "../utils/database";
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

interface TauApplicationOptions {
  database?: DatabaseOptions;
}

export abstract class TauApplication extends pulumi.ComponentResource {
  public readonly labels: { app: string };
  public readonly volumeManager: VolumeManager;
  public readonly domain: string;
  public readonly applicationDomain: string;
  public readonly defaultTlsSecret: string;
  public readonly namespace: string;
  public readonly name: string;
  protected readonly database?: DatabaseResult;

  constructor(
    name: string,
    options: TauApplicationOptions = {},
    opts?: pulumi.ComponentResourceOptions
  ) {
    const config = new pulumi.Config();
    const labels = { app: name };
    const transformation: pulumi.ResourceTransformation = args => {
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

    this.name = name;
    this.labels = labels;
    this.volumeManager = new VolumeManager(name, this);
    this.domain = config.require("domain");
    this.applicationDomain = `${name}.${this.domain}`;
    this.defaultTlsSecret = DEFAULT_TLS_SECRET;

    // Extract namespace from options or use default
    // For now, we'll use default namespace - this can be enhanced later
    this.namespace = "default";

    // Create database if options are provided
    if (options.database) {
      // Use application name as database name if not specified
      const dbOptions = {
        ...options.database,
        name: options.database.name || name,
        namespace: options.database.namespace || this.namespace,
      };

      this.database = createDatabase(dbOptions, { parent: this });
    }
  }

  /**
   * Get database environment variables for injection into containers
   */
  protected getDatabaseEnvironmentVariables(): k8s.types.input.core.v1.EnvVar[] {
    if (!this.database) return [];

    return [
      {
        name: "DATABASE_URL",
        valueFrom: {
          secretKeyRef: {
            name: this.database.secret.metadata.name,
            key: "url",
          },
        },
      },
      {
        name: "DB_HOST",
        valueFrom: {
          secretKeyRef: {
            name: this.database.secret.metadata.name,
            key: "host",
          },
        },
      },
      {
        name: "DB_PORT",
        valueFrom: {
          secretKeyRef: {
            name: this.database.secret.metadata.name,
            key: "port",
          },
        },
      },
      {
        name: "DB_NAME",
        valueFrom: {
          secretKeyRef: {
            name: this.database.secret.metadata.name,
            key: "database",
          },
        },
      },
      {
        name: "DB_USER",
        valueFrom: {
          secretKeyRef: {
            name: this.database.secret.metadata.name,
            key: "username",
          },
        },
      },
      {
        name: "DB_PASSWORD",
        valueFrom: {
          secretKeyRef: {
            name: this.database.secret.metadata.name,
            key: "password",
          },
        },
      },
    ];
  }

  /**
   * Get all environment variables including database variables
   */
  protected getAllEnvironmentVariables(
    additionalEnvVars: k8s.types.input.core.v1.EnvVar[] = []
  ): k8s.types.input.core.v1.EnvVar[] {
    return [...this.getDatabaseEnvironmentVariables(), ...additionalEnvVars];
  }

  protected createIngress(args: CreateIngressArgs) {
    const { port, targetPort = port, public: isPublic = false, subdomain = this.labels.app } = args;
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
