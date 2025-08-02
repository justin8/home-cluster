import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface AutheliaArgs {
  domain: pulumi.Input<string>;
  subdomain?: pulumi.Input<string>;
  namespace?: pulumi.Input<string>;
  sessionStorage?: {
    type: "redis" | "memory";
    host?: pulumi.Input<string>;
    port?: pulumi.Input<number>;
  };
  userStorage?: {
    type: "file" | "postgresql";
    connectionString?: pulumi.Input<string>;
  };
  smtp?: {
    host: pulumi.Input<string>;
    port?: pulumi.Input<number>;
    username: pulumi.Input<string>;
    password: pulumi.Input<string>;
    sender: pulumi.Input<string>;
  };
  jwtSecret?: pulumi.Input<string>;
  sessionSecret?: pulumi.Input<string>;
  storageEncryptionKey?: pulumi.Input<string>;
}

export class Authelia extends pulumi.ComponentResource {
  public readonly namespace: pulumi.Output<string>;
  public readonly domain: pulumi.Output<string>;
  public readonly url: pulumi.Output<string>;

  constructor(
    appName: string,
    args: AutheliaArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("tau:core-services:Authelia", appName, {}, opts);

    const subdomain = args.subdomain || "auth";
    const namespace = args.namespace || "authelia";
    const domain = args.domain;
    const autheliaUrl = pulumi.interpolate`${subdomain}.${domain}`;

    // Create namespace
    const ns = new k8s.core.v1.Namespace(
      `${appName}-ns`,
      {
        metadata: {
          name: namespace,
        },
      },
      { parent: this }
    );

    // Generate secrets if not provided
    const jwtSecret = args.jwtSecret || this.generateSecret("jwt-secret", 64);
    const sessionSecret = args.sessionSecret || this.generateSecret("session-secret", 64);
    const storageEncryptionKey = args.storageEncryptionKey || this.generateSecret("storage-key", 64);

    // Create secrets
    const autheliaSecrets = new k8s.core.v1.Secret(
      `${appName}-secrets`,
      {
        metadata: {
          name: "authelia-secrets",
          namespace: ns.metadata.name,
        },
        stringData: {
          "jwt-secret": jwtSecret,
          "session-secret": sessionSecret,
          "storage-encryption-key": storageEncryptionKey,
          ...(args.smtp && {
            "smtp-password": args.smtp.password,
          }),
        },
      },
      { parent: this }
    );

    // Create Authelia configuration
    const autheliaConfig = this.createAutheliaConfig(args, autheliaUrl, ns.metadata.name);

    const configMap = new k8s.core.v1.ConfigMap(
      `${appName}-config`,
      {
        metadata: {
          name: "authelia-config",
          namespace: ns.metadata.name,
        },
        data: {
          "configuration.yml": autheliaConfig,
        },
      },
      { parent: this }
    );

    // Deploy Redis for session storage if needed
    let redisService;
    if (args.sessionStorage?.type === "redis") {
      redisService = this.createRedisService(appName, ns.metadata.name);
    }

    // Deploy Authelia using Helm
    const authelia = new k8s.helm.v3.Release(
      "authelia",
      {
        chart: "authelia",
        version: "0.9.3",
        repositoryOpts: {
          repo: "https://charts.authelia.com",
        },
        namespace: ns.metadata.name,
        values: {
          domain: autheliaUrl,
          ingress: {
            enabled: true,
            className: "traefik-public",
            annotations: {
              "cert-manager.io/cluster-issuer": "letsencrypt-prod",
              "traefik.ingress.kubernetes.io/router.tls": "true",
            },
            hosts: [
              {
                host: autheliaUrl,
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                  },
                ],
              },
            ],
            tls: [
              {
                secretName: "authelia-tls",
                hosts: [autheliaUrl],
              },
            ],
          },
          configMap: {
            enabled: true,
            existingConfigMap: configMap.metadata.name,
          },
          secret: {
            enabled: true,
            existingSecret: autheliaSecrets.metadata.name,
          },
          persistence: {
            enabled: true,
            size: "1Gi",
            storageClass: "nfs-csi",
          },
        },
      },
      {
        parent: this,
        dependsOn: [configMap, autheliaSecrets, ...(redisService ? [redisService] : [])],
      }
    );

    this.namespace = ns.metadata.name;
    this.domain = pulumi.output(domain);
    this.url = autheliaUrl;
  }

  private generateSecret(name: string, length: number): string {
    // In a real implementation, you'd want to use a proper secret generation
    // For now, using a deterministic but unique string
    const crypto = require("crypto");
    return crypto.randomBytes(length).toString("hex");
  }

  private createAutheliaConfig(
    args: AutheliaArgs,
    autheliaUrl: pulumi.Output<string>,
    namespace: string
  ): string {
    const sessionStorageConfig = args.sessionStorage?.type === "redis" 
      ? `
  redis:
    host: redis-service.${namespace}.svc.cluster.local
    port: ${args.sessionStorage.port || 6379}
    database_index: 0`
      : `
  memory:
    inactivity: 5m
    expiration: 1h`;

    const storageConfig = args.userStorage?.type === "postgresql"
      ? `
  postgres:
    host: postgres-service.${namespace}.svc.cluster.local
    port: 5432
    database: authelia
    schema: public
    username: authelia
    password: $POSTGRES_PASSWORD`
      : `
  local:
    path: /config/users_database.yml`;

    const smtpConfig = args.smtp
      ? `
  smtp:
    host: ${args.smtp.host}
    port: ${args.smtp.port || 587}
    timeout: 5s
    username: ${args.smtp.username}
    password: $SMTP_PASSWORD
    sender: ${args.smtp.sender}
    startup_check_address: test@authelia.com
    disable_require_tls: false
    disable_html_emails: false
    tls:
      skip_verify: false
      minimum_version: TLS1.2`
      : `
  filesystem:
    filename: /config/notification.txt`;

    return `
---
theme: light
jwt_secret: $JWT_SECRET
default_redirection_url: https://${autheliaUrl}

server:
  host: 0.0.0.0
  port: 9091
  path: ""
  enable_pprof: false
  enable_expvars: false
  disable_healthcheck: false
  tls:
    key: ""
    certificate: ""

log:
  level: info
  format: text
  file_path: ""
  keep_stdout: true

totp:
  disable: false
  issuer: authelia.com
  algorithm: sha1
  digits: 6
  period: 30
  skew: 1
  secret_size: 32

authentication_backend:
  password_reset:
    disable: false
  refresh_interval: 5m
  file:
    path: /config/users_database.yml
    password:
      algorithm: argon2id
      iterations: 1
      salt_length: 16
      parallelism: 8
      memory: 64

access_control:
  default_policy: deny
  rules:
    - domain: ${autheliaUrl}
      policy: bypass
    - domain: "*.${args.domain}"
      policy: two_factor

session:
  name: authelia_session
  domain: ${args.domain}
  same_site: lax
  secret: $SESSION_SECRET
  expiration: 1h
  inactivity: 5m
  remember_me_duration: 1M${sessionStorageConfig}

regulation:
  max_retries: 3
  find_time: 2m
  ban_time: 5m

storage:
  encryption_key: $STORAGE_ENCRYPTION_KEY${storageConfig}

notifier:${smtpConfig}
`;
  }

  private createRedisService(appName: string, namespace: string): k8s.helm.v3.Release {
    return new k8s.helm.v3.Release(
      `${appName}-redis`,
      {
        chart: "redis",
        version: "20.2.1",
        repositoryOpts: {
          repo: "https://charts.bitnami.com/bitnami",
        },
        namespace: namespace,
        values: {
          auth: {
            enabled: false,
          },
          master: {
            persistence: {
              enabled: true,
              size: "1Gi",
              storageClass: "nfs-csi",
            },
          },
          replica: {
            replicaCount: 0,
          },
        },
      },
      { parent: this }
    );
  }
}
