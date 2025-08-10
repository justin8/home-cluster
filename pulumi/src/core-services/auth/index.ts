import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "../../constants";
import { TauApplication } from "../../constructs";
import { getServiceURL } from "../../utils";

export interface AuthArgs {
  namespace?: string;
}

export class Auth extends TauApplication {
  constructor(name: string, args: AuthArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const namespace = args.namespace || name;
    super(name, { namespace }, opts);

    const users = "justin:$2a$10$WfYZfPzxKD7GnLTsCz2u.uV/NTts.kAcGGWqKjTTtaVS3FnBOhYXC";

    const ns = new k8s.core.v1.Namespace(
      namespace,
      {
        metadata: {
          name: namespace,
        },
      },
      { parent: this }
    );

    // Generate a random secret key
    const secretKey = new random.RandomPassword(
      `${name}-secret`,
      {
        length: 32,
        special: true,
      },
      { parent: this }
    );

    const secret = new k8s.core.v1.Secret(
      `${name}-secret`,
      {
        metadata: {
          name: "tinyauth-secret",
          namespace: this.namespace,
        },
        type: "Opaque",
        stringData: {
          secretKey: secretKey.result,
        },
      },
      { parent: this, dependsOn: [ns] }
    );

    const deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: {
          name: "tinyauth",
          namespace: this.namespace,
        },
        spec: {
          replicas: 1,
          selector: {
            matchLabels: this.labels,
          },
          template: {
            metadata: {
              labels: this.labels,
            },
            spec: {
              containers: [
                {
                  name: "tinyauth",
                  image: "ghcr.io/steveiliop56/tinyauth:v3",
                  ports: [
                    {
                      containerPort: 3000,
                    },
                  ],
                  env: [
                    {
                      name: "APP_URL",
                      value: pulumi.interpolate`https://${this.applicationDomain}`,
                    },
                    {
                      name: "SECRET",
                      valueFrom: {
                        secretKeyRef: {
                          name: secret.metadata.name,
                          key: "secretKey",
                        },
                      },
                    },
                    {
                      name: "USERS",
                      value: users,
                    },
                  ],
                  livenessProbe: {
                    httpGet: {
                      path: "/api/healthcheck",
                      port: 3000,
                    },
                  },
                  readinessProbe: {
                    httpGet: {
                      path: "/api/healthcheck",
                      port: 3000,
                    },
                  },
                },
              ],
            },
          },
        },
      },
      { parent: this, dependsOn: [ns, secret] }
    );

    // Create HTTP ingress for the application
    const ingress = this.createHttpIngress(
      { appName: name, port: 3000, labels: this.labels, public: true },
      { parent: this, dependsOn: [ns, deployment] }
    );

    // Create Traefik middleware for forward auth in both ingress controller namespaces
    [PUBLIC_INGRESS_CLASS, PRIVATE_INGRESS_CLASS].forEach(ingressClass => {
      new k8s.apiextensions.CustomResource(
        `${name}-middleware-${ingressClass}`,
        {
          apiVersion: "traefik.io/v1alpha1",
          kind: "Middleware",
          metadata: {
            name: "tinyauth",
            namespace: ingressClass,
          },
          spec: {
            forwardAuth: {
              address: pulumi.interpolate`${getServiceURL(name, this.namespace)}:3000/api/auth/traefik`,
            },
          },
        },
        { parent: this, dependsOn: [ingress.service] }
      );
    });
  }
}
