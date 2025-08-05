import * as k8s from "@pulumi/kubernetes";
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

export function getEnvironmentVariablesForDB(
  instance: PostgresInstance
): k8s.types.input.core.v1.EnvVar[] {
  if (!instance) return [];
  const secretName = instance.connectionSecret.metadata.name;
  return [
    {
      name: "DATABASE_URL",
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "url",
        },
      },
    },
    {
      name: "DB_HOST",
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "host",
        },
      },
    },
    {
      name: "DB_PORT",
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "port",
        },
      },
    },
    {
      name: "DB_NAME",
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "database",
        },
      },
    },
    {
      name: "DB_USER",
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "username",
        },
      },
    },
    {
      name: "DB_PASSWORD",
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "password",
        },
      },
    },
  ];
}
