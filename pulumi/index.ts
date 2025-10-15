import * as pulumi from "@pulumi/pulumi";
import { Downloads, Immich, Jellyfin, Kavita, Plex, Syncthing } from "./src/applications";

import { PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "./src/constants";
import {
  Auth,
  CertManager,
  CNPGOperator,
  Dns,
  IngressControllers,
  IntelGPU,
  Longhorn,
  MailProxy,
  MetalLB,
  NFD,
  NFSCSI,
  Reloader,
  SharedSecrets,
} from "./src/core-services";

/**
 * Initializes all core services required by applications
 *
 * @returns Array of initialized core service resources
 */
function initializeCoreServices(): pulumi.Resource[] {
  const sharedSecrets = new SharedSecrets("secrets");

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

  const mailProxy = new MailProxy("mail-proxy", {}, { dependsOn: [longhorn] });

  const dns = new Dns(
    "dns",
    {
      publicIngressClass: PUBLIC_INGRESS_CLASS,
      privateIngressClass: PRIVATE_INGRESS_CLASS,
      cloudflareSecret: sharedSecrets.cloudflareSecret,
    },
    { dependsOn: [longhorn, metallb] }
  );

  const cnpgOperator = new CNPGOperator("cnpg-operator", { dependsOn: [longhorn] });

  const auth = new Auth(
    "auth",
    {},
    {
      dependsOn: [sharedSecrets, ingressControllers, longhorn],
    }
  );

  // Enable Reloader to auto-update deployments on secret/configmap changes
  const reloader = new Reloader("reloader");

  // Enable Node Feature Discovery for hardware feature detection
  const nfd = new NFD("nfd");

  // Enable Intel GPU device plugins
  const intelGpu = new IntelGPU("intel-gpu", { dependsOn: [certManager, nfd] });

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
    reloader,
    nfd,
    intelGpu,
  ];
}

const config = new pulumi.Config();

// Initialize core services and load applications
const coreServices = initializeCoreServices();
const opts: pulumi.ResourceOptions = { dependsOn: coreServices };

new Kavita("kavita", {}, opts);

new Downloads("downloads", opts);

new Immich("immich", {}, opts);

new Jellyfin("jellyfin", {}, opts);

new Plex("plex", {}, opts);

new Syncthing("syncthing", {}, opts);
