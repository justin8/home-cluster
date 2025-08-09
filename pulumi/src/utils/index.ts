import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DEFAULT_TLS_SECRET, PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "../constants";

export { DatabaseOptions } from "./database";

export type KubernetesSecretData = { [key: string]: string };

const config = new pulumi.Config();

/**
 * Generates a reflector annotation for a given key and value.
 */
export function reflectorAnnotation(key: pulumi.Input<string>, value: pulumi.Input<string>) {
  return {
    [`reflector.v1.k8s.emberstack.com/reflection-${key}`]: value,
  };
}

/**
 * Generates all reflector annotations for a list of namespaces.
 */
export function reflectorAnnotationsForNamespaces(namespaces: string[]) {
  return {
    ...reflectorAnnotation("allowed", "true"),
    ...reflectorAnnotation("allowed-namespaces", namespaces.join(",")),
    ...reflectorAnnotation("auto-enabled", "true"),
    ...reflectorAnnotation("auto-namespaces", namespaces.join(",")),
  };
}

/**
 * Converts an hour (0-23) by the timezone_offset Pulumi config variable. Mostly because Talos only supports UTC.
 * This allows us to convert the hour to the local timezone for scheduling jobs.
 * @param hour The hour to convert (0-23)
 * @returns The converted hour (0-23)
 */
export function applyTimezone(hour: number): number {
  const config = new pulumi.Config();
  const offset = config.getNumber("timezone_offset") || 0;
  return (hour + offset + 24) % 24;
}

/**
 * Parses an IP range string (e.g. "192.168.1.10-192.168.1.20") into an array of IP addresses.
 * Only supports ranges within the last octet.
 * @param range The IP range string
 * @returns Array of IP addresses in the range
 */
export function parseIPRange(range: string): string[] {
  const [start, end] = range.split("-");
  const startParts = start.split(".").map(Number);
  const endParts = end.split(".").map(Number);
  const ips: string[] = [];

  for (let i = startParts[3]; i <= endParts[3]; i++) {
    ips.push(`${startParts.slice(0, 3).join(".")}.${i}`);
  }

  return ips;
}

export function getServiceURL(
  serviceName: pulumi.Input<string>,
  namespace: pulumi.Input<string> = "default"
): pulumi.Output<string> {
  return pulumi.interpolate`http://${serviceName}.${namespace}.svc.cluster.local`;
}

/**
 * Arguments for creating an HTTP ingress and service for an application.
 */
export interface CreateHttpIngressOptions {
  appName: string;
  port: number;
  labels?: Record<string, string>;
  targetPort?: number;
  public?: boolean;
  subdomain?: string;
  path?: pulumi.Input<string>;
  pathType?: pulumi.Input<string>;
  namespace?: pulumi.Input<string>;
}

/**
 * The result of createHttpIngress, containing both the ingress and service resources.
 */
export interface CreateHttpIngressResult {
  ingress: k8s.networking.v1.Ingress;
  service: k8s.core.v1.Service;
}

/**
 * Creates a Kubernetes Service and Ingress for HTTP traffic for an application.
 * Returns both resources for further use.
 * @param options Arguments for HTTP ingress and service creation
 * @returns CreateHttpIngressResult containing the ingress and service
 */
export function createHttpIngress(
  options: CreateHttpIngressOptions,
  opts?: pulumi.ComponentResourceOptions
): CreateHttpIngressResult {
  const appName = options.appName;
  const labels = options.labels ?? {};
  const port = options.port ?? 80;
  const targetPort = options.targetPort ?? 80;
  const isPublic = options.public ?? false;
  const subdomain = options.subdomain ?? options.appName;
  const path = options.path ?? "/";
  const pathType = options.pathType ?? "Prefix";
  const namespace = options.namespace ?? "default";

  // Create the service
  const service = createService(
    {
      appName,
      labels,
      port,
      targetPort,
      namespace,
    },
    opts
  );

  // Create the Ingress resource
  const ingress = createIngress(
    {
      port,
      namespace,
      isPublic,
      subdomain,
      path,
      pathType,
      serviceName: service.metadata.name,
    },
    opts
  );

  return { ingress: ingress, service: service };
}

export interface createServiceOptions {
  appName: string;
  labels?: Record<string, string>;
  port?: number;
  targetPort?: number;
  namespace?: pulumi.Input<string>;
}

export function createService(
  options: createServiceOptions,
  opts?: pulumi.ComponentResourceOptions
): k8s.core.v1.Service {
  const appName = options.appName;
  const labels = options.labels ?? {};
  const port = options.port ?? 80;
  const targetPort = options.targetPort ?? 80;
  const namespace = options.namespace || "default";

  return new k8s.core.v1.Service(
    `${appName}-service`,
    {
      metadata: {
        name: appName,
        ...(namespace && { namespace }),
      },
      spec: {
        type: "ClusterIP",
        ports: [{ port, targetPort, protocol: "TCP" }],
        selector: labels,
      },
    },
    opts
  );
}

export interface CreateIngressOptions {
  serviceName: pulumi.Input<string>;
  port: number;
  subdomain?: string;
  namespace?: pulumi.Input<string>;
  isPublic?: boolean;
  path?: pulumi.Input<string>;
  pathType?: pulumi.Input<string>;
}

export function createIngress(
  options: CreateIngressOptions,
  opts?: pulumi.ComponentResourceOptions
): k8s.networking.v1.Ingress {
  const port = options.port;
  const namespace = options.namespace || "default";
  const isPublic = options.isPublic ?? false;
  const subdomain = options.subdomain;
  const path = options.path || "/";
  const pathType = options.pathType || "Prefix";
  const serviceName = options.serviceName;

  const domain = config.require("domain");
  const appDomain = subdomain ? `${subdomain}.${domain}` : domain;

  return new k8s.networking.v1.Ingress(
    `${appDomain}-ingress`,
    {
      metadata: {
        ...(namespace && { namespace }),
        annotations: {
          "pulumi.com/skipAwait": "true",
          ...(isPublic && {
            "external-dns.alpha.kubernetes.io/target": config.require("real_external_ip"),
          }),
        },
      },
      spec: {
        ingressClassName: isPublic ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS,
        tls: [
          {
            hosts: [appDomain],
            secretName: DEFAULT_TLS_SECRET,
          },
        ],
        rules: [
          {
            host: appDomain,
            http: {
              paths: [
                {
                  path,
                  pathType,
                  backend: {
                    service: {
                      name: serviceName,
                      port: { number: port },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
    opts
  );
}
