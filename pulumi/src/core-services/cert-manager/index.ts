import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { reflectorAnnotation } from "../../utils";
import { DEFAULT_TLS_SECRET } from "../../constants";

declare var require: any;
export const DEFAULT_CERT_SECRET_NAME = DEFAULT_TLS_SECRET;

export enum CertIssuerType {
  PROD = "letsencrypt-prod",
  STAGING = "letsencrypt-staging"
}

export interface CertManagerArgs {
  email: pulumi.Input<string>;
  cloudflareEmail: pulumi.Input<string>;
  cloudflareAPIToken: pulumi.Input<string>;
  domain: pulumi.Input<string>;
  defaultCertAllowedNamespaces?: pulumi.Input<string>;
  defaultCertIssuer?: pulumi.Input<CertIssuerType>;
  version?: pulumi.Input<string>;
  reflectorVersion?: pulumi.Input<string>;
  namespace?: pulumi.Input<string>;
  ingressClass?: pulumi.Input<string>;
}

export class CertManager extends pulumi.ComponentResource {
  constructor(
    appName: string,
    args: CertManagerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(appName, appName, {}, opts);

    const config: pulumi.Config = new pulumi.Config(appName);

    const email = args.email;
    const cloudflareEmail = args.cloudflareEmail;
    const cloudflareAPIToken = args.cloudflareAPIToken
    const domain = args.domain;
    const version = args.version || "v1.18.2";
    const reflectorVersion = args.reflectorVersion || "9.1.22"
    const namespace = args.namespace || "cert-manager";
    const ingressClass = args.ingressClass || "nginx"
    const defaultCertAllowedNamespaces = args.defaultCertAllowedNamespaces || "default,kube-system,cert-manager";
    const defaultCertIssuer = args.defaultCertIssuer || CertIssuerType.PROD

    const ns = new k8s.core.v1.Namespace(
      `${appName}-ns`,
      {
        metadata: {
          name: namespace,
        },
      },
      { parent: this }
    );

    const reflector = new k8s.helm.v3.Release("reflector", {
      chart: "reflector",
      version: reflectorVersion,
      repositoryOpts: {
        repo: "https://emberstack.github.io/helm-charts",
      },
      namespace: ns.metadata.name,
      values: {
        priorityClassName: "system-cluster-critical",
      }
    }
    )

    const certManager = new k8s.helm.v3.Release("certmanager", {
      chart: "cert-manager",
      version,
      repositoryOpts: {
        repo: "https://charts.jetstack.io",
      },
      namespace: ns.metadata.name,
      values: {
        extraArgs: [
          "--dns01-recursive-nameservers-only",
          "--dns01-recursive-nameservers=1.1.1.1:53,1.0.0.1:53"
        ],
        installCRDs: true,
      }
    });

    const cloudflareSecret = new k8s.core.v1.Secret(`${appName}-cloudflare-api-token`,
      {
        metadata: {
          name: "cloudflare-api-token",
          namespace: namespace,
        },
        stringData: {
          "api-token": cloudflareAPIToken
        },
      },
      {
        parent: this,
        dependsOn: [
          certManager
        ],
      },
    )

    const prodClusterIssuer = ClusterIssuer({
      appName,
      namespace,
      email,
      domain,
      ingressClass,
      cloudflareEmail,
      cloudflareSecret,
      prod: true,
    }
    );

    ClusterIssuer({
      appName,
      namespace,
      email,
      domain,
      ingressClass,
      cloudflareEmail,
      cloudflareSecret,
      prod: false
    }
    );

    new k8s.apiextensions.CustomResource(`${appName}-default-certificate`,
      {
        kind: "Certificate",
        apiVersion: "cert-manager.io/v1",
        metadata: {
          name: "default",
          namespace: namespace,
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
              ...reflectorAnnotation("allowed", "true"),
              ...reflectorAnnotation("allowed-namespaces", defaultCertAllowedNamespaces),
              ...reflectorAnnotation("auto-enabled", "true"),
              ...reflectorAnnotation("auto-namespaces", defaultCertAllowedNamespaces),
            }
          },
        },
      },
      {
        parent: this,
        dependsOn: [
          certManager,
          prodClusterIssuer,
          reflector
        ],
      }
    );
  }
}

interface ClusterIssuerArgs {
  appName: pulumi.Input<string>,
  namespace: pulumi.Input<string>,
  email: pulumi.Input<string>,
  domain: pulumi.Input<string>,
  ingressClass: pulumi.Input<string>,
  cloudflareEmail: pulumi.Input<string>,
  cloudflareSecret: k8s.core.v1.Secret,
  prod: boolean,
}

function ClusterIssuer(
  args: ClusterIssuerArgs
): k8s.apiextensions.CustomResource {
  const { appName, namespace, email, domain, ingressClass, cloudflareEmail, cloudflareSecret, prod } = args;
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

  return new k8s.apiextensions.CustomResource(`${appName}-letsencrypt-${prod ? "prod" : "staging"}-issuer`,
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
                ingress: { class: ingressClass }
              }
            },
            {
              selector: {
                dnsZones: [domain],
              },
              dns01: {
                cloudflare: {
                  email: cloudflareEmail,
                  apiTokenSecretRef: {
                    name: cloudflareSecret.metadata.name,
                    key: "api-token"
                  }
                }
              }
            }
          ]
        },
      }
    },
    {
      dependsOn: [
        cloudflareSecret,
      ]
    }
  )

}

