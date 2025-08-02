import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { PostgresInstance } from "../constructs/postgresInstance";

export interface DatabaseConfig {
  name: string;
  namespace?: string;
  owner?: string;
  instance?: string;
  extensions?: string[];
  storageSize?: string;
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
  config: DatabaseConfig,
  parent?: pulumi.ComponentResource
): DatabaseResult {
  const namespace = config.namespace || "default";
  const instanceName = config.instance || `postgres-${config.name}`;

  // Create PostgreSQL instance
  const instance = new PostgresInstance(
    instanceName,
    {
      namespace: namespace,
      storageSize: config.storageSize,
      extensions: config.extensions,
    },
    { parent: parent }
  );

  // Extract connection details from the instance
  const connectionString = instance.connectionSecret.stringData.apply(
    data => data!["DATABASE_URL"]
  );
  const password = instance.connectionSecret.stringData.apply(data => data!["DB_PASSWORD"]);
  const username = pulumi.output(instance.username);

  return {
    connectionString: connectionString,
    host: instance.host,
    port: instance.port,
    database: config.name,
    username: username,
    password: password,
    secret: instance.connectionSecret,
    instance: instance,
  };
}

/**
 * Creates a database for a TauApplication with automatic naming conventions
 */
export function createDatabaseForApp(
  appName: string,
  namespace: string,
  options: Omit<DatabaseConfig, "name" | "namespace"> = {},
  parent?: pulumi.ComponentResource
): DatabaseResult {
  return createDatabase(
    {
      name: appName,
      namespace: namespace,
      ...options,
    },
    parent
  );
}
