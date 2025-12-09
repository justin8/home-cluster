import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import {
  DEFAULT_TLS_SECRET,
  PUBLIC_INGRESS_CLASS,
  SHARED_SECRETS_NAMESPACE,
} from "../../constants";
import { TauSecret } from "../../constructs";
import { reflectorAnnotationsForNamespaces } from "../../utils";

export const DEFAULT_CERT_SECRET_NAME = DEFAULT_TLS_SECRET;

export enum CertIssuerType {
  PROD = "letsencrypt-prod",
  STAGING = "letsencrypt-staging",
}

export interface CertManagerArgs {
  email: pulumi.Input<string>;
  cloudflareSecret: TauSecret;
  domain: pulumi.Input<string>;
  defaultCertAllowedNamespaces?: string[];
  defaultCertIssuer?: pulumi.Input<CertIssuerType>;
  namespace?: pulumi.Input<string>;
  ingressClass?: pulumi.Input<string>;
}

export class CertManager extends pulumi.ComponentResource {
  constructor(appName: string, args: CertManagerArgs, opts?: pulumi.ComponentResourceOptions) {
    super(appName, appName, {}, opts);

    const config: pulumi.Config = new pulumi.Config(appName);

    const email = args.email;
    const domain = args.domain;
    const namespace = args.namespace || "cert-manager";
    const ingressClass = args.ingressClass || PUBLIC_INGRESS_CLASS;
    const cloudflareSecret = args.cloudflareSecret;
    const defaultCertAllowedNamespaces = args.defaultCertAllowedNamespaces || [
      "kube-system",
      "shared-secrets",
      "cert-manager",
      "traefik-private",
      "traefik-public",
    ];
    const defaultCertIssuer = args.defaultCertIssuer || CertIssuerType.PROD;

    const ns = new k8s.core.v1.Namespace(
      `${appName}-ns`,
      {
        metadata: {
          name: namespace,
        },
      },
      { parent: this }
    );

    const certManager = new k8s.helm.v3.Release(
      "certmanager",
      {
        chart: "cert-manager",
        version: "v1.19.2",
        repositoryOpts: {
          repo: "https://charts.jetstack.io",
        },
        namespace: ns.metadata.name,
        values: {
          extraArgs: [
            "--dns01-recursive-nameservers-only",
            "--dns01-recursive-nameservers=1.1.1.1:53,1.0.0.1:53",
          ],
          installCRDs: true,
        },
      },
      { parent: this }
    );

    const prodClusterIssuer = ClusterIssuer(
      {
        appName,
        namespace,
        email,
        domain,
        ingressClass,
        cloudflareSecret,
        prod: true,
      },
      { parent: this, dependsOn: [certManager] }
    );

    ClusterIssuer(
      {
        appName,
        namespace,
        email,
        domain,
        ingressClass,
        cloudflareSecret,
        prod: false,
      },
      { parent: this, dependsOn: [certManager] }
    );

    new k8s.apiextensions.CustomResource(
      `${appName}-default-certificate`,
      {
        kind: "Certificate",
        apiVersion: "cert-manager.io/v1",
        metadata: {
          name: "default",
          namespace: SHARED_SECRETS_NAMESPACE,
        },
        spec: {
          secretName: DEFAULT_TLS_SECRET,
          issuerRef: {
            name: defaultCertIssuer,
            kind: "ClusterIssuer",
          },
          commonName: `*.${domain}`,
          dnsNames: [`*.${domain}`],
          secretTemplate: {
            annotations: {
              ...reflectorAnnotationsForNamespaces([]),
            },
          },
        },
      },
      {
        parent: this,
        dependsOn: [certManager, prodClusterIssuer],
      }
    );
  }
}

interface ClusterIssuerArgs {
  appName: pulumi.Input<string>;
  namespace: pulumi.Input<string>;
  email: pulumi.Input<string>;
  domain: pulumi.Input<string>;
  ingressClass: pulumi.Input<string>;
  cloudflareSecret: TauSecret;
  prod: boolean;
}

function ClusterIssuer(
  args: ClusterIssuerArgs,
  opts?: pulumi.ComponentResourceOptions
): k8s.apiextensions.CustomResource {
  const { appName, namespace, email, domain, ingressClass, cloudflareSecret, prod } = args;
  let server, name, privateKeySecretName;
  if (prod) {
    server = "https://acme-v02.api.letsencrypt.org/directory";
    name = CertIssuerType.PROD;
    privateKeySecretName = "letsencrypt-prod-account-key";
  } else {
    server = "https://acme-staging-v02.api.letsencrypt.org/directory";
    name = CertIssuerType.STAGING;
    privateKeySecretName = "letsencrypt-staging-account-key";
  }

  return new k8s.apiextensions.CustomResource(
    `${appName}-letsencrypt-${prod ? "prod" : "staging"}-issuer`,
    {
      kind: "ClusterIssuer",
      apiVersion: "cert-manager.io/v1",
      metadata: {
        name,
        namespace: namespace,
      },
      spec: {
        acme: {
          server: server,
          email: email,
          privateKeySecretRef: {
            name: privateKeySecretName,
          },
          solvers: [
            {
              http01: {
                ingress: { class: ingressClass },
              },
            },
            {
              selector: {
                dnsZones: [domain],
              },
              dns01: {
                cloudflare: {
                  apiTokenSecretRef: {
                    name: cloudflareSecret.name,
                    key: "api-token",
                  },
                },
              },
            },
          ],
        },
      },
    },
    {
      dependsOn: [cloudflareSecret],
      ...opts,
    }
  );
}
