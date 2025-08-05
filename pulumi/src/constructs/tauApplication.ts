import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { DatabaseOptions, getEnvironmentVariablesForDB } from "../utils/database";
import { PostgresInstance } from "./postgresInstance";
import { VolumeManager } from "./volumeManager";

interface TauApplicationOptions {
  database?: DatabaseOptions;
  namespace?: string;
}

export abstract class TauApplication extends pulumi.ComponentResource {
  public readonly labels: { app: string };
  public readonly volumeManager: VolumeManager;
  public readonly domain: string;
  public readonly applicationDomain: string;
  public readonly namespace: string;
  public readonly name: string;
  protected readonly database?: PostgresInstance;

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
    this.namespace = options.namespace || "default";

    // Create database if options are provided
    if (options.database) {
      // Use application name as database name if not specified
      const dbOptions = {
        ...options.database,
        namespace: options.database.namespace || this.namespace,
      };

      this.database = new PostgresInstance(dbOptions, { parent: this });
    }
  }

  /**
   * Get all environment variables including database variables
   */
  protected getAllEnvironmentVariables(
    additionalEnvVars: k8s.types.input.core.v1.EnvVar[] = []
  ): k8s.types.input.core.v1.EnvVar[] {
    return [
      ...(this.database ? getEnvironmentVariablesForDB(this.database) : []),
      ...additionalEnvVars,
    ];
  }
}
