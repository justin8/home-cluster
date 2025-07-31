import * as pulumi from "@pulumi/pulumi";

import { DemoApp } from "./src/applications/demo-app";
import { CertManager } from "./src/core-services/cert-manager";
import { IngressControllers } from "./src/core-services/ingress-controllers";
import { MetalLB } from "./src/core-services/metallb";
import { NFSCSI } from "./src/core-services/nfs-csi";

const config = new pulumi.Config();

new MetalLB("metallb", {
  addresses: [config.require("ip_address_pool")],
});

new CertManager("cert-manager", {
  email: config.require("cert_manager_email"),
  cloudflareEmail: config.require("cloudflare_email"),
  cloudflareAPIToken: config.requireSecret("cloudflare_api_token"),
  domain: config.require("domain"),
});

new NFSCSI("nfs-csi");

new IngressControllers("ingress-controllers", {});

new DemoApp("demo-app");
