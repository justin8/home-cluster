import * as pulumi from "@pulumi/pulumi";

import { DemoApp, PostgresExample } from "./src/applications";
import {
  CertManager,
  CNPGOperator,
  IngressControllers,
  Longhorn,
  MetalLB,
  NFSCSI,
} from "./src/core-services";

const config = new pulumi.Config();

const metallb = new MetalLB("metallb", {
  addresses: [config.require("ip_address_pool")],
});

const certManager = new CertManager("cert-manager", {
  email: config.require("cert_manager_email"),
  cloudflareEmail: config.require("cloudflare_email"),
  cloudflareAPIToken: config.requireSecret("cloudflare_api_token"),
  domain: config.require("domain"),
});

const nfsCsi = new NFSCSI("nfs-csi");

// Ingress controllers depend on MetalLB
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

const cnpgOperator = new CNPGOperator("cnpg-operator", { dependsOn: [longhorn] });

// Core services dependency for all applications
const coreServices = [metallb, certManager, nfsCsi, ingressControllers, longhorn, cnpgOperator];

// Applications depend on all core services
new DemoApp("demo-app", {
  dependsOn: coreServices,
});

new PostgresExample("postgres-example", {
  dependsOn: coreServices,
});
