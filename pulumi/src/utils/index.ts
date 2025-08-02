import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DEFAULT_TLS_SECRET, PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "../constants";

export { createDatabase, createDatabaseForApp, DatabaseConfig, DatabaseResult } from "./database";

export function reflectorAnnotation(key: pulumi.Input<string>, value: pulumi.Input<string>) {
  return {
    [`reflector.v1.k8s.emberstack.com/reflection-${key}`]: value,
  };
}

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

export interface CreateIngressArgs {
  name: string;
  namespace?: pulumi.Input<string>;
  host: pulumi.Input<string>;
  serviceName: pulumi.Input<string>;
  servicePort: pulumi.Input<number>;
  path?: pulumi.Input<string>;
  pathType?: pulumi.Input<string>;
  public?: boolean;
  parent?: pulumi.Resource;
}

export function createIngress(args: CreateIngressArgs): k8s.networking.v1.Ingress {
  const {
    name,
    namespace,
    host,
    serviceName,
    servicePort,
    path = "/",
    pathType = "Prefix",
    public: isPublic = false,
    parent,
  } = args;

  const ingressClass = isPublic ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS;

  return new k8s.networking.v1.Ingress(
    name,
    {
      metadata: {
        ...(namespace && { namespace }),
        annotations: {
          "pulumi.com/skipAwait": "true",
        },
      },
      spec: {
        ingressClassName: ingressClass,
        tls: [
          {
            hosts: [host],
            secretName: DEFAULT_TLS_SECRET,
          },
        ],
        rules: [
          {
            host,
            http: {
              paths: [
                {
                  path,
                  pathType,
                  backend: {
                    service: {
                      name: serviceName,
                      port: { number: servicePort },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
    { ...(parent && { parent }) }
  );
}

export interface CreateServiceArgs {
  name: string;
  namespace?: pulumi.Input<string>;
  port: pulumi.Input<number>;
  targetPort?: pulumi.Input<number>;
  selector: Record<string, string>;
  parent?: pulumi.Resource;
}

export function createService(args: CreateServiceArgs): k8s.core.v1.Service {
  const { name, namespace, port, targetPort = port, selector, parent } = args;

  return new k8s.core.v1.Service(
    name,
    {
      metadata: {
        ...(namespace && { namespace }),
      },
      spec: {
        type: "ClusterIP",
        ports: [{ port, targetPort, protocol: "TCP" }],
        selector,
      },
    },
    { ...(parent && { parent }) }
  );
}
