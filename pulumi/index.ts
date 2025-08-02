import * as pulumi from "@pulumi/pulumi";

import { DemoApp } from "./src/applications/demo-app";
import { Authelia } from "./src/core-services/authelia";
import { CertManager } from "./src/core-services/cert-manager";
import { IngressControllers } from "./src/core-services/ingress-controllers";
import { MetalLB } from "./src/core-services/metallb";
import { NFSCSI } from "./src/core-services/nfs-csi";

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
const ingressControllers = new IngressControllers("ingress-controllers", {}, {
  dependsOn: [metallb],
});

// Authelia depends on cert-manager and ingress controllers
const authelia = new Authelia("authelia", {
  domain: config.require("domain"),
  subdomain: "auth",
  sessionStorage: {
    type: "redis",
  },
  userStorage: {
    type: "file",
  },
  // Optional SMTP configuration
  smtp: config.get("smtp_host") ? {
    host: config.require("smtp_host"),
    username: config.require("smtp_username"),
    password: config.requireSecret("smtp_password"),
    sender: config.require("smtp_sender"),
  } : undefined,
}, {
  dependsOn: [certManager, ingressControllers],
});

// Core services dependency for all applications
const coreServices = [metallb, certManager, nfsCsi, ingressControllers, authelia];

// Applications depend on all core services
new DemoApp("demo-app", {
  dependsOn: coreServices,
});

export const publicIngressIP = ingressControllers.publicIP;
export const privateIngressIP = ingressControllers.privateIP;
export const autheliaUrl = authelia.url;
