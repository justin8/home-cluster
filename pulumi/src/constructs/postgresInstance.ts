import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

interface PostgresInstanceArgs {
  namespace?: string;
  storageSize?: string;
  version?: string;
  extensions?: string[];
}

export class PostgresInstance extends pulumi.ComponentResource {
  public readonly connectionSecret: k8s.core.v1.Secret;
  public readonly serviceName: pulumi.Output<string>;
  public readonly host: pulumi.Output<string>;
  public readonly port: pulumi.Output<number>;
  public readonly databaseName: string;
  public readonly username: string;

  constructor(
    name: string,
    args: PostgresInstanceArgs = {},
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("PostgresInstance", name, {}, opts);

    const config = new pulumi.Config();
    const namespace = args.namespace || "default";
    const storageSize = args.storageSize || "10Gi";
    const version = args.version || "15";
    const storageClass = "longhorn";
    const backupNfsPath = config.require("postgres_backup_nfs_path");
    const retentionDays = 7;

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

    // Create the PostgreSQL cluster using CNPG CRD
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
          instances: 1, // Single instance as per requirements

          postgresql: {
            parameters: {
              // Basic PostgreSQL configuration
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

          // Storage configuration using Longhorn
          storage: {
            size: storageSize,
            storageClass: storageClass,
          },

          // Resource limits for low usage
          resources: {
            requests: {
              memory: "256Mi",
              cpu: "100m",
            },
            limits: {
              memory: "512Mi",
              cpu: "500m",
            },
          },

          // Backup configuration (simplified for NFS)
          backup: {
            retentionPolicy: `${retentionDays}d`,
            // Note: Full NFS backup configuration would require additional setup
            // This is a placeholder that can be enhanced based on your NFS configuration
          },

          // Bootstrap configuration
          bootstrap: {
            initdb: {
              database: this.databaseName,
              owner: this.username,
              secret: {
                name: `${name}-credentials`,
              },
            },
          },

          // Monitoring (disabled as per requirements)
          monitoring: {
            enabled: false,
          },
        },
      },
      { parent: this }
    );

    // Create the credentials secret
    this.connectionSecret = new k8s.core.v1.Secret(
      `${name}-credentials`,
      {
        metadata: {
          name: `${name}-credentials`,
          namespace: namespace,
        },
        type: "Opaque",
        stringData: {
          username: this.username,
          password: password.result,
          database: this.databaseName,
        },
      },
      { parent: this }
    );

    // The service name follows CNPG naming convention
    this.serviceName = pulumi.output(`${name}-rw`);
    this.host = pulumi.output(`${name}-rw.${namespace}.svc.cluster.local`);
    this.port = pulumi.output(5432);

    // Create a comprehensive connection secret with all required fields
    const connectionString = pulumi.interpolate`postgresql://${this.username}:${password.result}@${this.serviceName}.${namespace}.svc.cluster.local:5432/${this.databaseName}`;

    const fullConnectionSecret = new k8s.core.v1.Secret(
      `${name}-connection`,
      {
        metadata: {
          name: `${name}-postgres-credentials`,
          namespace: namespace,
        },
        type: "Opaque",
        stringData: {
          DATABASE_URL: connectionString,
          DB_HOST: pulumi.interpolate`${this.serviceName}.${namespace}.svc.cluster.local`,
          DB_PORT: "5432",
          DB_NAME: this.databaseName,
          DB_USER: this.username,
          DB_PASSWORD: password.result,
        },
      },
      { parent: this, dependsOn: [cluster] }
    );

    // Override the connectionSecret to use the full one
    this.connectionSecret = fullConnectionSecret;

    // Register outputs
    this.registerOutputs({
      cluster: cluster,
      connectionSecret: this.connectionSecret,
      serviceName: this.serviceName,
      host: this.host,
      port: this.port,
    });
  }
}
