import * as pulumi from "@pulumi/pulumi";

import { DemoApp, PostgresExample } from "./src/applications";
import { PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "./src/constants";
import {
  CertManager,
  CNPGOperator,
  ExternalDNS,
  IngressControllers,
  Longhorn,
  MetalLB,
  NFSCSI,
  SharedSecrets,
} from "./src/core-services";

const config = new pulumi.Config();

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

const externalDNS = new ExternalDNS("external-dns", {
  publicIngressClass: PUBLIC_INGRESS_CLASS,
  privateIngressClass: PRIVATE_INGRESS_CLASS,
  cloudflareSecret: sharedSecrets.cloudflareSecret,
  // piholeSecret: sharedSecrets.piholeSecret,
});

const longhorn = new Longhorn(
  "longhorn",
  {},
  {
    dependsOn: [ingressControllers],
  }
);

const cnpgOperator = new CNPGOperator("cnpg-operator", { dependsOn: [longhorn] });

// Core services dependency for all applications
const coreServices = [
  metallb,
  sharedSecrets,
  certManager,
  nfsCsi,
  ingressControllers,
  longhorn,
  cnpgOperator,
];

// Applications depend on all core services
new DemoApp("demo-app", {
  dependsOn: coreServices,
});

new PostgresExample("postgres-example", {
  dependsOn: coreServices,
});
