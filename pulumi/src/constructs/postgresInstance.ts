import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { getServiceURL } from "../utils";
import { DatabaseArgs } from "../utils/database";
import { TauSecret } from "./tauSecret";
import { createLonghornPersistentVolume, createLonghornVolumeResource } from "./volumeManager";

function deepMerge<T>(target: T, source: any): T {
  const result = { ...target } as any;

  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }

  return result;
}

export class PostgresInstance extends pulumi.ComponentResource {
  public readonly connectionSecret: TauSecret;
  public readonly serviceName: pulumi.Output<string>;
  public readonly host: pulumi.Output<string>;
  public readonly port: pulumi.Output<string>;
  public readonly databaseName: string;
  public readonly username: string;

  constructor(args: DatabaseArgs, opts?: pulumi.ComponentResourceOptions) {
    super("PostgresInstance", args.name, {}, opts);

    const name = args.name;
    const superuser = args.superUser || false;
    const namespace = args.namespace || "default";
    const storageSize = args.storageSize || "1Gi";
    const version = args.version || "17";
    const image = args.image || `ghcr.io/cloudnative-pg/postgresql:${version}`;

    // The service name follows CNPG naming convention
    this.serviceName = pulumi.output(`${name}-rw`);
    this.host = getServiceURL(this.serviceName, namespace);
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

    this.connectionSecret = new TauSecret(
      `${name}-credentials`,
      {
        namespace: namespace,
        data: {
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

    const longhornVolume = createLonghornVolumeResource({
      identifier: name,
      name: "data",
      size: storageSize,
      backupEnabled: true,
      accessMode: "ReadWriteOnce",
      opts: {
        parent: this,
      },
    });
    const pv = createLonghornPersistentVolume({
      identifier: name,
      name: "data",
      size: storageSize,
      longhornVolume,
      storageClass: "longhorn",
      accessMode: "ReadWriteOnce",
      opts: { parent: this, dependsOn: [longhornVolume] },
    });
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

    const clusterSpec = {
      instances: 1, // Currently only supports a single instance, the PVC selector needs to be updated to support multiple instances
      imageName: image,
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

      managed: {
        roles: [
          {
            name: this.username,
            login: true,
            superuser,
          },
        ],
      },

      storage: {
        size: storageSize,
        storageClass: "longhorn",
        pvcTemplate,
      },

      // No limit for now; once I get vertical auto-scaling working that should take care of this
      // resources: {
      //   requests: {
      //     memory: "256Mi",
      //     cpu: "100m",
      //   },
      //   limits: {
      //     memory: "512Mi",
      //     cpu: "500m",
      //   },
      // },

      bootstrap: {
        initdb: {
          database: this.databaseName,
          owner: this.username,
          secret: { name: this.connectionSecret.name },
        },
      },
    };

    const finalSpec = args.specOverride ? deepMerge(clusterSpec, args.specOverride) : clusterSpec;

    const cluster = new k8s.apiextensions.CustomResource(
      `${name}-cluster`,
      {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "Cluster",
        metadata: {
          name: name,
          namespace: namespace,
          labels: {
            "kube-image-keeper.enix.io/image-caching-policy": "ignore",
          },
        },
        spec: finalSpec,
      },
      { parent: this }
    );
  }
}
