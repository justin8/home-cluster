import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { CertManager } from "./src/cert-manager";
import { MetalLB } from "./src/metallb";

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

const appName = "nginx";
const appLabels = { app: "foo" };
const deployment = new k8s.apps.v1.Deployment(appName, {
  spec: {
    selector: { matchLabels: appLabels },
    replicas: 1,
    template: {
      metadata: { labels: appLabels },
      spec: { containers: [{ name: appName, image: "nginx" }] },
    },
  },
});

// Allocate an IP to the Deployment.
const frontend = new k8s.core.v1.Service(appName, {
  metadata: { labels: deployment.spec.template.metadata.labels },
  spec: {
    type: "LoadBalancer",
    ports: [{ port: 80, targetPort: 80, protocol: "TCP" }],
    selector: appLabels,
  },
});

export const ip = frontend.status.loadBalancer.apply(
  (lb) => lb.ingress[0].ip || lb.ingress[0].hostname
);
