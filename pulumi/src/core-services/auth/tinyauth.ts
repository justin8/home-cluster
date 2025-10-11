import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

import { PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "../../constants";
import { TauApplication, TauApplicationArgs } from "../../constructs";
import { getServiceURL, createVPA } from "../../utils";

const config = new pulumi.Config();

export interface TinyAuthArgs extends TauApplicationArgs {
  namespace: string;
}

export class TinyAuth extends TauApplication {
  constructor(name: string, args: TinyAuthArgs, opts?: pulumi.ComponentResourceOptions) {
    super(name, args, opts);

    const oauth_config_data = {
      GENERIC_CLIENT_ID: config.require("tinyauth_oauth_client_id"),
      GENERIC_CLIENT_SECRET: config.require("tinyauth_oauth_client_secret"),
      GENERIC_AUTH_URL: "https://pocketid.dray.id.au/authorize",
      GENERIC_TOKEN_URL: "https://pocketid.dray.id.au/api/oidc/token",
      GENERIC_USER_URL: "https://pocketid.dray.id.au/api/oidc/userinfo",
      GENERIC_SCOPES: "openid email profile groups",
      GENERIC_NAME: "Pocket ID",
      OAUTH_AUTO_REDIRECT: "generic",
      DISABLE_CONTINUE: "true",
      COOKIE_SECURE: "true",
    };

    const oauth_config = new k8s.core.v1.Secret(
      `${name}-oauth-config`,
      {
        metadata: {
          name: "tinyauth-oauth-config",
          namespace: this.namespace,
        },
        type: "Opaque",
        stringData: oauth_config_data,
      },
      { parent: this, dependsOn: opts?.dependsOn }
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
      { parent: this, dependsOn: opts?.dependsOn }
    );

    const deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: {
          name,
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
                  image: "ghcr.io/steveiliop56/tinyauth:v3.6.2",
                  ports: [
                    {
                      containerPort: 3000,
                    },
                  ],
                  envFrom: [{ secretRef: { name: oauth_config.metadata.name } }],
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
      { parent: this, dependsOn: [secret, oauth_config] }
    );

    // Create HTTP ingress for the application
    this.createHttpIngress(
      { appName: name, port: 3000, labels: this.labels, public: true, auth: false },
      { parent: this, dependsOn: [deployment] }
    );

    createVPA({ workload: deployment }, { parent: this });

    // Create Traefik middleware for forward auth in both ingress controller namespaces
    [PUBLIC_INGRESS_CLASS, PRIVATE_INGRESS_CLASS].forEach(ingressClass => {
      new k8s.apiextensions.CustomResource(
        `${name}-middleware-${ingressClass}`,
        {
          apiVersion: "traefik.io/v1alpha1",
          kind: "Middleware",
          metadata: {
            name,
            namespace: ingressClass,
          },
          spec: {
            forwardAuth: {
              address: pulumi.interpolate`http://${getServiceURL("tinyauth", this.namespace)}:3000/api/auth/traefik`,
              authResponseHeaders: ["remote-user"],
            },
          },
        },
        { parent: this, dependsOn: [deployment] }
      );
    });
  }
}
