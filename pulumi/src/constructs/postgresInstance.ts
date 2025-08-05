import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { DatabaseOptions } from "../utils/database";
import { createLonghornPersistentVolume, createLonghornVolumeResource } from "./volumeManager";

export class PostgresInstance extends pulumi.ComponentResource {
  public readonly connectionSecret: k8s.core.v1.Secret;
  public readonly serviceName: pulumi.Output<string>;
  public readonly host: pulumi.Output<string>;
  public readonly port: pulumi.Output<string>;
  public readonly databaseName: string;
  public readonly username: string;

  constructor(args: DatabaseOptions, opts?: pulumi.ComponentResourceOptions) {
    super("PostgresInstance", args.name, {}, opts);

    const name = args.name;
    const namespace = args.namespace || "default";
    const storageSize = args.storageSize || "1Gi";
    const version = args.version || "17";

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

    const longhornVolume = createLonghornVolumeResource(name, "data", storageSize, true, {
      parent: this,
    });
    const pv = createLonghornPersistentVolume(
      name,
      "data",
      storageSize,
      ["ReadWriteOnce"],
      "longhorn",
      longhornVolume,
      { parent: this, dependsOn: [longhornVolume] }
    );
    const pvcTemplate = {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "longhorn",
      volumeName: pv.metadata.name,
      resources: {
        requests: {
          storage: storageSize,
        },
      },
    };

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
          instances: 1, // Currently only supports a single instance, the PVC selector needs to be updated to support multiple instances
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

          storage: {
            size: storageSize,
            storageClass: "longhorn",
            pvcTemplate,
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
