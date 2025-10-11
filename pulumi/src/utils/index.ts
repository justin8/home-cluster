import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import {
  DEFAULT_TLS_SECRET,
  PRIVATE_AUTH_MIDDLEWARE,
  PRIVATE_INGRESS_CLASS,
  PUBLIC_AUTH_MIDDLEWARE,
  PUBLIC_INGRESS_CLASS,
} from "../constants";

export { DatabaseArgs as DatabaseOptions } from "./database";
export { createIpAddressPool } from "./networking";
export { createVPA, CreateVPAArgs, VPAContainerPolicy } from "./vpa";

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
 * Converts an hour (0-23) by the timezone Pulumi config variable. Mostly because Talos only supports UTC.
 * This allows us to convert the hour to the local timezone for scheduling jobs.
 * @param hour The hour to convert (0-23)
 * @returns The converted hour (0-23)
 */
export function applyTimezone(hour: number): number {
  const config = new pulumi.Config();
  const timezone = config.get("timezone") || "UTC";
  const now = new Date();
  const utcHour = now.getUTCHours();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const localHour = localTime.getHours();
  const offset = localHour - utcHour;
  return (hour + offset + 24) % 24;
}

export function getServiceURL(
  serviceName: pulumi.Input<string>,
  namespace: pulumi.Input<string> = "default"
): pulumi.Output<string> {
  return pulumi.interpolate`${serviceName}.${namespace}.svc.cluster.local`;
}

/**
 * Arguments for creating an HTTP ingress and service for an application.
 */
export interface CreateHttpIngressArgs {
  appName: string;
  port: number;
  labels?: Record<string, string>;
  targetPort?: number;
  public?: boolean;
  subdomain?: string;
  path?: pulumi.Input<string>;
  pathType?: pulumi.Input<string>;
  namespace?: pulumi.Input<string>;
  auth?: boolean;
}

/**
 * The result of createHttpIngress, containing both the ingress and service resources.
 */
export interface CreateHttpIngressResult {
  ingresses: k8s.networking.v1.Ingress[];
  service: k8s.core.v1.Service;
}

/**
 * Creates a Kubernetes Service and Ingress for HTTP traffic for an application.
 * Returns both resources for further use.
 * @param args Arguments for HTTP ingress and service creation
 * @returns CreateHttpIngressResult containing the ingress and service
 */
export function createHttpIngress(
  args: CreateHttpIngressArgs,
  opts?: pulumi.ComponentResourceOptions
): CreateHttpIngressResult {
  const appName = args.appName;
  const labels = args.labels ?? {};
  const port = args.port ?? 80;
  const targetPort = args.targetPort ?? port;
  const isPublic = args.public ?? false;
  const subdomain = args.subdomain ?? args.appName;
  const path = args.path ?? "/";
  const pathType = args.pathType ?? "Prefix";
  const namespace = args.namespace ?? "default";
  const auth = args.auth ?? true;

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

  // Create the private Ingress resource
  let ingresses: k8s.networking.v1.Ingress[] = [];
  ingresses.push(
    createIngress(
      {
        port,
        namespace,
        isPublic: false,
        subdomain,
        path,
        pathType,
        serviceName: service.metadata.name,
        auth,
      },
      opts
    )
  );

  if (isPublic) {
    ingresses.push(
      createIngress(
        {
          port,
          namespace,
          isPublic: true,
          subdomain,
          path,
          pathType,
          serviceName: service.metadata.name,
          auth,
        },
        opts
      )
    );
  }

  return { ingresses, service: service };
}

export interface createServiceArgs {
  appName: string;
  labels?: Record<string, string>;
  port?: number;
  targetPort?: number;
  namespace?: pulumi.Input<string>;
}

export function createService(
  args: createServiceArgs,
  opts?: pulumi.ComponentResourceOptions
): k8s.core.v1.Service {
  const appName = args.appName;
  const labels = args.labels ?? {};
  const port = args.port ?? 80;
  const targetPort = args.targetPort || port;
  const namespace = args.namespace || "default";

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

export interface CreateIngressArgs {
  serviceName: pulumi.Input<string>;
  port: number;
  subdomain?: string;
  namespace?: pulumi.Input<string>;
  isPublic?: boolean;
  path?: pulumi.Input<string>;
  pathType?: pulumi.Input<string>;
  auth?: boolean;
}

export function createIngress(
  args: CreateIngressArgs,
  opts?: pulumi.ComponentResourceOptions
): k8s.networking.v1.Ingress {
  const port = args.port;
  const namespace = args.namespace || "default";
  const isPublic = args.isPublic ?? false;
  const subdomain = args.subdomain;
  const path = args.path || "/";
  const pathType = args.pathType || "Prefix";
  const serviceName = args.serviceName;
  const auth = args.auth ?? true;

  const domain = config.require("domain");
  const appDomain = subdomain ? `${subdomain}.${domain}` : domain;

  return new k8s.networking.v1.Ingress(
    `${appDomain}-ingress-${isPublic ? "public" : "private"}`,
    {
      metadata: {
        ...(namespace && { namespace }),
        annotations: {
          "pulumi.com/skipAwait": "true",
          ...(isPublic && {
            "external-dns.alpha.kubernetes.io/target": config.require("real_external_ip"),
          }),
          ...(auth && {
            "traefik.ingress.kubernetes.io/router.middlewares": isPublic
              ? PUBLIC_AUTH_MIDDLEWARE
              : PRIVATE_AUTH_MIDDLEWARE,
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
