import * as pulumi from "@pulumi/pulumi";

/**
 * Configuration for Authelia middleware
 */
export interface AutheliaMiddlewareConfig {
  name: string;
  autheliaUrl: string;
  namespace?: string;
  trustForwardHeader?: boolean;
  authResponseHeaders?: string[];
}

/**
 * Configuration for authentication in ingresses
 */
export interface AuthConfig {
  enabled: boolean;
  middleware?: string;
  bypassPaths?: string[];
  requireTwoFactor?: boolean;
}

/**
 * Creates Traefik ForwardAuth middleware configuration for Authelia
 */
export function createAutheliaMiddleware(config: AutheliaMiddlewareConfig): object {
  const {
    name,
    autheliaUrl,
    namespace = "authelia",
    trustForwardHeader = true,
    authResponseHeaders = [
      "Remote-User",
      "Remote-Groups",
      "Remote-Name",
      "Remote-Email"
    ]
  } = config;

  return {
    apiVersion: "traefik.containo.us/v1alpha1",
    kind: "Middleware",
    metadata: {
      name: name,
      namespace: namespace,
    },
    spec: {
      forwardAuth: {
        address: `http://authelia.${namespace}.svc.cluster.local:9091/api/verify?rd=https://${autheliaUrl}/`,
        trustForwardHeader: trustForwardHeader,
        authResponseHeaders: authResponseHeaders,
      },
    },
  };
}

/**
 * Creates a simple ForwardAuth middleware for custom configurations
 */
export function createForwardAuthMiddleware(
  name: string,
  autheliaUrl: string,
  namespace: string = "authelia"
): object {
  return createAutheliaMiddleware({
    name,
    autheliaUrl,
    namespace,
  });
}

/**
 * Generates Traefik annotations for ingresses with Authelia authentication
 */
export function getAutheliaAnnotations(
  middlewareName: string,
  namespace: string = "authelia",
  bypassPaths?: string[]
): Record<string, string> {
  const annotations: Record<string, string> = {
    "traefik.ingress.kubernetes.io/router.middlewares": `${namespace}-${middlewareName}@kubernetescrd`,
  };

  // Add bypass paths if specified
  if (bypassPaths && bypassPaths.length > 0) {
    // Create a bypass middleware for specific paths
    const bypassRule = bypassPaths.map(path => `PathPrefix(\`${path}\`)`).join(" || ");
    annotations["traefik.ingress.kubernetes.io/router.rule.bypass"] = bypassRule;
  }

  return annotations;
}

/**
 * Creates a complete middleware chain including auth and optional bypasses
 */
export function createAuthMiddlewareChain(
  baseName: string,
  autheliaUrl: string,
  namespace: string = "authelia",
  bypassPaths?: string[]
): object[] {
  const middlewares: object[] = [];

  // Main auth middleware
  middlewares.push(createAutheliaMiddleware({
    name: `${baseName}-auth`,
    autheliaUrl,
    namespace,
  }));

  // Bypass middleware for specific paths if needed
  if (bypassPaths && bypassPaths.length > 0) {
    middlewares.push({
      apiVersion: "traefik.containo.us/v1alpha1",
      kind: "Middleware",
      metadata: {
        name: `${baseName}-bypass`,
        namespace: namespace,
      },
      spec: {
        chain: {
          middlewares: [
            {
              name: `${baseName}-auth`,
              namespace: namespace,
            },
          ],
        },
      },
    });
  }

  return middlewares;
}

/**
 * Helper function to determine if authentication should be applied
 */
export function shouldApplyAuth(authConfig?: AuthConfig): boolean {
  return authConfig?.enabled === true;
}

/**
 * Gets the middleware name to use for authentication
 */
export function getAuthMiddlewareName(
  appName: string,
  authConfig?: AuthConfig,
  defaultMiddleware: string = "authelia-auth"
): string {
  if (!shouldApplyAuth(authConfig)) {
    return "";
  }
  
  return authConfig?.middleware || `${appName}-${defaultMiddleware}`;
}

/**
 * Creates access control rules for Authelia configuration
 */
export function createAccessControlRule(
  domain: string,
  policy: "bypass" | "one_factor" | "two_factor" = "two_factor",
  subject?: string[],
  resources?: string[]
): object {
  const rule: any = {
    domain: domain,
    policy: policy,
  };

  if (subject && subject.length > 0) {
    rule.subject = subject;
  }

  if (resources && resources.length > 0) {
    rule.resources = resources;
  }

  return rule;
}

/**
 * Default Authelia constants
 */
export const AUTHELIA_CONSTANTS = {
  DEFAULT_NAMESPACE: "authelia",
  DEFAULT_MIDDLEWARE_NAME: "authelia-auth",
  DEFAULT_SERVICE_NAME: "authelia",
  DEFAULT_PORT: 9091,
  DEFAULT_CONFIG_PATH: "/config/configuration.yml",
  DEFAULT_USERS_PATH: "/config/users_database.yml",
} as const;
