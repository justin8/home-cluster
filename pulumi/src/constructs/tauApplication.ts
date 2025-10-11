import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import {
  createHttpIngress,
  CreateHttpIngressArgs,
  CreateHttpIngressResult,
  createVPA,
  CreateVPAArgs,
} from "../utils";
import { DatabaseArgs, getEnvironmentVariablesForDB } from "../utils/database";
import { PostgresInstance } from "./postgresInstance";
import { VolumeManager } from "./volumeManager";

export interface TauApplicationArgs {
  database?: DatabaseArgs;
  namespace?: string;
  createNamespace?: boolean;
  namespaceLabels?: Record<string, string>;
}

export abstract class TauApplication extends pulumi.ComponentResource {
  public readonly labels: { app: string };
  public readonly volumeManager: VolumeManager;
  public readonly domain: string;
  public readonly subdomain: string;
  public readonly applicationDomain: string;
  public readonly namespace: string;
  public readonly ns: k8s.core.v1.Namespace | undefined;
  public readonly name: string;
  protected readonly database?: PostgresInstance;

  constructor(name: string, args: TauApplicationArgs = {}, opts?: pulumi.ComponentResourceOptions) {
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
    this.domain = config.require("domain");
    this.subdomain = name;
    this.applicationDomain = `${this.subdomain}.${this.domain}`;
    this.namespace = args.namespace || "default";

    // Create namespaces by default, unless it is 'default' or 'kube-system'
    const createNamespace =
      args.createNamespace ?? !["default", "kube-system"].includes(this.namespace);
    if (createNamespace) {
      this.ns = new k8s.core.v1.Namespace(
        this.namespace,
        {
          metadata: {
            name: this.namespace,
            labels: {
              ...labels,
              ...args.namespaceLabels,
            },
          },
        },
        { parent: this }
      );
    }

    this.volumeManager = new VolumeManager(name, this.namespace, {
      parent: this,
      dependsOn: this.ns ? [this.ns] : [],
    });

    // Create database if options are provided
    if (args.database) {
      // Use application name as database name if not specified
      const dbArgs = {
        ...args.database,
        namespace: args.database.namespace || this.namespace,
      };

      this.database = new PostgresInstance(dbArgs, { parent: this });
    }
  }

  protected createHttpIngress(
    args: CreateHttpIngressArgs,
    opts?: pulumi.ComponentResourceOptions
  ): CreateHttpIngressResult {
    return createHttpIngress(
      { namespace: this.namespace, subdomain: this.subdomain, labels: this.labels, ...args },
      { ...opts, parent: this }
    );
  }

  protected createVPA(
    args: CreateVPAArgs,
    opts?: pulumi.ComponentResourceOptions
  ): pulumi.Output<k8s.apiextensions.CustomResource> {
    return createVPA(args, { ...opts, parent: this });
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
