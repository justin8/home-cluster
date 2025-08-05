import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

interface PostgresInstanceArgs {
  /** @default "default" */
  namespace?: string;
  /** @default "1Gi" */
  storageSize?: string;
  /** Can be a major version (17) or a specific minor (16.3) */
  version?: string;
  /** @default [] */
  extensions?: string[];
  resources?: k8s.types.input.core.v1.ResourceRequirements;
}

export class PostgresInstance extends pulumi.ComponentResource {
  public readonly connectionSecret: k8s.core.v1.Secret;
  public readonly serviceName: pulumi.Output<string>;
  public readonly host: pulumi.Output<string>;
  public readonly port: pulumi.Output<string>;
  public readonly databaseName: string;
  public readonly username: string;

  constructor(
    name: string,
    args: PostgresInstanceArgs = {},
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("PostgresInstance", name, {}, opts);

    // const config = new pulumi.Config();
    const namespace = args.namespace || "default";
    const storageSize = args.storageSize || "1Gi";
    const version = args.version || "17";
    // const backupNfsPath = config.require("postgres_backup_nfs_path");
    const retentionDays = 7;

    // The service name follows CNPG naming convention
    this.serviceName = pulumi.output(`${name}-rw`);
    this.host = pulumi.interpolate`${this.serviceName}.${namespace}.svc.cluster.local`;
    this.port = pulumi.output("5432");

    this.databaseName = name;
    this.username = `${name}_user`;

    // Generate secure password for the database user
    const password = new random.RandomPassword(
      `${name}-password`,
      {
        length: 32,
        special: true,
      },
      { parent: this }
    );

    // Create a comprehensive connection secret with all required fields
    const connectionString = pulumi.interpolate`postgresql://${this.username}:${password.result}@${this.host}:${this.port}/${this.databaseName}`;

    this.connectionSecret = new k8s.core.v1.Secret(
      `${name}-credentials`,
      {
        metadata: {
          name: `${name}-credentials`,
          namespace: namespace,
        },
        type: "Opaque",
        stringData: {
          url: connectionString,
          host: this.host,
          port: this.port,
          database: this.databaseName,
          username: this.username,
          password: password.result,
        },
      },
      { parent: this }
    );

    const cluster = new k8s.apiextensions.CustomResource(
      `${name}-cluster`,
      {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "Cluster",
        metadata: {
          name: name,
          namespace: namespace,
        },
        spec: {
          instances: 1,
          imageName: `ghcr.io/cloudnative-pg/postgresql:${version}`,

          postgresql: {
            parameters: {
              max_connections: "100",
              shared_buffers: "128MB",
              effective_cache_size: "512MB",
              maintenance_work_mem: "64MB",
              checkpoint_completion_target: "0.9",
              wal_buffers: "16MB",
              default_statistics_target: "100",
              random_page_cost: "1.1",
              effective_io_concurrency: "200",
            },
          },

          // TODO: Change to using a PVC selector and statically created longhorn volume + PV
          storage: {
            size: storageSize,
            storageClass: "longhorn",
          },

          resources: {
            requests: {
              memory: "256Mi",
              cpu: "100m",
            },
            limits: {
              memory: "512Mi",
              cpu: "500m",
            },
            ...args.resources,
          },

          // backup: {
          //   retentionPolicy: `${retentionDays}d`,
          //  This only supports S3-like object stores, so I need one before doing this
          // },

          bootstrap: {
            initdb: {
              database: this.databaseName,
              owner: this.username,
              secret: {
                name: this.connectionSecret.metadata.name,
              },
            },
          },
        },
      },
      { parent: this }
    );
  }
}
