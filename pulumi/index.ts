import * as pulumi from "@pulumi/pulumi";

import { DemoApp } from "./src/applications/demo-app";
import { CertManager } from "./src/core-services/cert-manager";
import { MetalLB } from "./src/core-services/metallb";

const config = new pulumi.Config();

const metallb = new MetalLB("metallb", {
  addresses: config.requireObject<string[]>("metallb_addresses"),
});

const certManager = new CertManager("cert-manager", {
  email: config.require("cert_manager_email"),
  cloudflareEmail: config.require("cloudflare_email"),
  cloudflareAPIToken: config.requireSecret("cloudflare_api_token"),
  domain: config.require("domain"),
});

const demoApp = new DemoApp("demo-app");

export const demoHostname = demoApp.hostname;
