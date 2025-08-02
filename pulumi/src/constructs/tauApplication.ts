import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DEFAULT_TLS_SECRET, PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "../constants";
import { VolumeManager } from "./volumeManager";
import { AuthConfig, getAutheliaAnnotations, shouldApplyAuth, getAuthMiddlewareName } from "../utils";

interface CreateIngressArgs {
  port: number;
  /** @default port */
  targetPort?: number;
  /** @default false */
  public?: boolean;
  /** @default name */
  subdomain?: string;
  /** Authentication configuration */
  auth?: AuthConfig;
}

export abstract class TauApplication extends pulumi.ComponentResource {
  public readonly labels: { app: string };
  public readonly volumeManager: VolumeManager;
  public readonly domain: string;
  public readonly applicationDomain: string;
  public readonly defaultTlsSecret: string;

  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    const config = new pulumi.Config();
    const labels = { app: name };
    const transformation: pulumi.ResourceTransformation = (args) => {
      if (args.type.startsWith("kubernetes:")) {
        return {
          props: {
            ...args.props,
            metadata: {
              ...args.props.metadata,
              labels: {
                ...labels,
                ...args.props.metadata?.labels,
              },
            },
          },
          opts: args.opts,
        };
      }
      return undefined;
    };

    super(
      "TauApplication",
      name,
      {},
      {
        ...opts,
        transformations: [...(opts?.transformations || []), transformation],
      }
    );

    this.labels = labels;
    this.volumeManager = new VolumeManager(this);
    this.domain = config.require("domain");
    this.applicationDomain = `${name}.${this.domain}`;
    this.defaultTlsSecret = DEFAULT_TLS_SECRET;
  }

  protected createIngress(args: CreateIngressArgs) {
    const { port, targetPort = port, public: isPublic = false, subdomain = this.labels.app, auth } = args;
    const ingressClass = isPublic ? PUBLIC_INGRESS_CLASS : PRIVATE_INGRESS_CLASS;
    const appDomain = `${subdomain}.${this.domain}`;
    
    const service = new k8s.core.v1.Service(
      `${this.labels.app}-service`,
      {
        spec: {
          type: "ClusterIP",
          ports: [{ port, targetPort, protocol: "TCP" }],
          selector: this.labels,
        },
      },
      { parent: this }
    );

    // Build ingress annotations
    const annotations: Record<string, string> = {
      "pulumi.com/skipAwait": "true",
    };

    // Add authentication annotations if auth is enabled
    if (shouldApplyAuth(auth)) {
      const middlewareName = getAuthMiddlewareName(this.labels.app, auth);
      const authAnnotations = getAutheliaAnnotations(middlewareName, "authelia", auth?.bypassPaths);
      Object.assign(annotations, authAnnotations);
    }

    const ingress = new k8s.networking.v1.Ingress(
      `${this.labels.app}-ingress`,
      {
        metadata: {
          annotations,
        },
        spec: {
          ingressClassName: ingressClass,
          tls: [
            {
              hosts: [appDomain],
              secretName: this.defaultTlsSecret,
            },
          ],
          rules: [
            {
              host: appDomain,
              http: {
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                    backend: {
                      service: {
                        name: service.metadata.name,
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
      { parent: this }
    );

    // Create auth middleware if needed
    if (shouldApplyAuth(auth)) {
      this.createAuthMiddleware(auth, appDomain);
    }
  }

  /**
   * Creates Authelia middleware for this application
   */
  private createAuthMiddleware(auth: AuthConfig, appDomain: string) {
    const middlewareName = getAuthMiddlewareName(this.labels.app, auth);
    const autheliaUrl = `auth.${this.domain}`;

    new k8s.apiextensions.CustomResource(
      `${this.labels.app}-auth-middleware`,
      {
        apiVersion: "traefik.containo.us/v1alpha1",
        kind: "Middleware",
        metadata: {
          name: middlewareName,
          namespace: "authelia",
        },
        spec: {
          forwardAuth: {
            address: `http://authelia.authelia.svc.cluster.local:9091/api/verify?rd=https://${autheliaUrl}/`,
            trustForwardHeader: true,
            authResponseHeaders: [
              "Remote-User",
              "Remote-Groups",
              "Remote-Name",
              "Remote-Email"
            ],
          },
        },
      },
      { parent: this }
    );
  }

  /**
   * Helper method to enable authentication for this application
   */
  protected enableAuth(config?: Partial<AuthConfig>): AuthConfig {
    return {
      enabled: true,
      ...config,
    };
  }

  /**
   * Helper method to disable authentication for this application
   */
  protected disableAuth(): AuthConfig {
    return {
      enabled: false,
    };
  }
}
