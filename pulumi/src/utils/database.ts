import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { PostgresInstance } from "../constructs/postgresInstance";

/**
 * Unified interface for database configuration options
 * This is used across tauApplication, database utils, and postgresInstance
 */
export interface DatabaseOptions {
  name: string;
  namespace?: string;
  extensions?: string[];
  storageSize?: string;
  version?: string;
  resources?: k8s.types.input.core.v1.ResourceRequirements;
}

export interface DatabaseResult {
  connectionString: pulumi.Output<string>;
  host: pulumi.Output<string>;
  port: pulumi.Output<number>;
  database: string;
  username: pulumi.Output<string>;
  password: pulumi.Output<string>;
  secret: k8s.core.v1.Secret;
  instance: PostgresInstance;
}

export function createDatabase(
  config: DatabaseOptions,
  opts?: pulumi.ComponentResourceOptions
): DatabaseResult {
  const instanceName = `postgres-${config.name}`;

  // Create PostgreSQL instance with all options passed through
  const instance = new PostgresInstance(
    {
      ...config,
      name: instanceName,
    },
    opts
  );

  // Extract connection details from the instance
  const connectionString = instance.connectionSecret.stringData.apply(
    data => data!["DATABASE_URL"]
  );
  const password = instance.connectionSecret.stringData.apply(data => data!["DB_PASSWORD"]);
  const username = pulumi.output(instance.username);

  // Convert port to number
  const portNumber = instance.port.apply(p => parseInt(p, 10));

  return {
    connectionString: connectionString,
    host: instance.host,
    port: portNumber,
    database: config.name,
    username: username,
    password: password,
    secret: instance.connectionSecret,
    instance: instance,
  };
}
