import * as pulumi from "@pulumi/pulumi";
import { Kavita, Sabnzbd } from "./src/applications";

import { PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "./src/constants";
import {
  Auth,
  CertManager,
  CNPGOperator,
  Dns,
  IngressControllers,
  Longhorn,
  MailProxy,
  MetalLB,
  NFSCSI,
  SharedSecrets,
} from "./src/core-services";

/**
 * Initializes all core services required by applications
 *
 * @returns Array of initialized core service resources
 */
function initializeCoreServices(): pulumi.Resource[] {
  const sharedSecrets = new SharedSecrets("secrets");

  const mailProxy = new MailProxy("mail-proxy");

  const metallb = new MetalLB("metallb", {
    addresses: [config.require("ip_address_pool")],
  });

  const certManager = new CertManager(
    "cert-manager",
    {
      email: config.require("cert_manager_email"),
      cloudflareSecret: sharedSecrets.cloudflareSecret,
      domain: config.require("domain"),
    },
    {
      dependsOn: [sharedSecrets],
    }
  );

  const nfsCsi = new NFSCSI("nfs-csi");

  const ingressControllers = new IngressControllers(
    "ingress-controllers",
    {},
    {
      dependsOn: [metallb],
    }
  );

  const longhorn = new Longhorn(
    "longhorn",
    {},
    {
      dependsOn: [ingressControllers],
    }
  );

  const dns = new Dns(
    "dns",
    {
      publicIngressClass: PUBLIC_INGRESS_CLASS,
      privateIngressClass: PRIVATE_INGRESS_CLASS,
      cloudflareSecret: sharedSecrets.cloudflareSecret,
    },
    { dependsOn: [longhorn] }
  );

  const cnpgOperator = new CNPGOperator("cnpg-operator", { dependsOn: [longhorn] });

  const auth = new Auth("auth", {}, { dependsOn: [sharedSecrets] });

  // Return array of all core services
  return [
    sharedSecrets,
    mailProxy,
    metallb,
    certManager,
    nfsCsi,
    ingressControllers,
    longhorn,
    dns,
    cnpgOperator,
    auth,
  ];
}

const config = new pulumi.Config();

// Initialize core services and load applications
const coreServices = initializeCoreServices();
const opts: pulumi.ResourceOptions = { dependsOn: coreServices };

new Kavita({}, opts);
new Sabnzbd({}, opts);
