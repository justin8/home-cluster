import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauSecret, VolumeManager } from "../../constructs";
import { createIpAddressPool, getServiceURL } from "../../utils";
import { ExternalDns } from "./external-dns";
import { PiHole } from "./pihole";

const config = new pulumi.Config();
export interface DnsArgs {
  publicIngressClass: string;
  privateIngressClass: string;
  cloudflareSecret: TauSecret;
  dnsServerIP?: pulumi.Input<string>;
}

export interface CustomDnsRecordArgs {
  hostname: string;
  ip: pulumi.Input<string>;
  namespace?: string;
}

export class Dns extends pulumi.ComponentResource {
  private namespace: string;

  constructor(name: string, args: DnsArgs, opts?: pulumi.ComponentResourceOptions) {
    super("core-services:dns", name, {}, opts);
    this.namespace = "dns";
    opts = { ...opts, parent: this };

    new k8s.core.v1.Namespace(
      this.namespace,
      { metadata: { name: this.namespace } },
      { parent: this }
    );

    const piholeSharedLabels = { app: "pihole" };
    const piholeVolumeManager = new VolumeManager("pihole", this.namespace, { parent: this });
    new PiHole(
      "pihole-primary",
      {
        namespace: this.namespace,
        createNamespace: false,
        labels: piholeSharedLabels,
        type: "primary",
        volumeManager: piholeVolumeManager,
      },
      opts
    );

    // new PiHole(
    //   "pihole-secondary",
    //   {
    //     namespace: this.namespace,
    //     createNamespace: false,
    //     labels: piholeSharedLabels,
    //     type: "secondary",
    //     volumeManager: piholeVolumeManager,
    //   },
    //   opts
    // );

    new ExternalDns(
      "external-dns-pihole",
      {
        namespace: this.namespace,
        provider: "pihole",
        ingressClasses: [args.privateIngressClass],
        registry: "noop",
        sources: ["ingress", "traefik-proxy", "service"], // Include services for custom DNS records on internal DNS only
        extraArgs: [
          pulumi.interpolate`--pihole-server=http://${getServiceURL("pihole-web", this.namespace)}`,
          "--pihole-api-version=6", // v5 is still the deault, but being deprecated soon-ish
        ],
      },
      opts
    );

    new ExternalDns(
      "external-dns-cloudflare",
      {
        namespace: this.namespace,
        provider: "cloudflare",
        ingressClasses: [args.publicIngressClass],
        sources: ["ingress", "traefik-proxy"], // Only ingress sources for external DNS
        env: [
          {
            name: "CF_API_TOKEN",
            valueFrom: {
              secretKeyRef: {
                name: args.cloudflareSecret.name,
                key: "api-token",
              },
            },
          },
        ],
      },
      opts
    );

    const piholeIP = args.dnsServerIP || config.require("dns_server_ip");
    const piholeIpAddressPoolName = createIpAddressPool(
      {
        name: name,
        ipAddresses: [pulumi.interpolate`${piholeIP}/32`],
      },
      {
        parent: this,
      }
    );

    new k8s.core.v1.Service(
      name,
      {
        metadata: {
          name,
          namespace: this.namespace,
          labels: piholeSharedLabels,
          annotations: {
            "metallb.io/address-pool": piholeIpAddressPoolName,
          },
        },
        spec: {
          type: "LoadBalancer",
          ports: [
            { name: "dns-udp", port: 53, targetPort: 53, protocol: "UDP" },
            { name: "dns-tcp", port: 53, targetPort: 53, protocol: "TCP" },
          ],
          selector: { ...piholeSharedLabels, "pihole/type": "primary" },
        },
      },
      { parent: this }
    );

    // Create custom DNS record for storage.dray.id.au
    const nfsIP = config.require("nfs_ip");
    this.createCustomDnsRecord("storage-nfs", {
      hostname: "storage.dray.id.au",
      ip: nfsIP,
      namespace: this.namespace,
    });
  }

  /**
   * Creates a custom DNS record using service annotations
   * This allows mapping custom hostnames to IP addresses in the internal DNS
   */
  createCustomDnsRecord(
    name: string,
    args: CustomDnsRecordArgs,
    opts?: pulumi.ComponentResourceOptions
  ): void {
    const resourceOpts = { ...opts, parent: this };
    const targetNamespace = args.namespace || this.namespace;
    const serviceName = args.hostname.replace(/\./g, "-");

    // Create service with external-dns annotations
    new k8s.core.v1.Service(
      serviceName,
      {
        metadata: {
          name: serviceName,
          namespace: targetNamespace,
          annotations: {
            "external-dns.alpha.kubernetes.io/hostname": args.hostname,
            "external-dns.alpha.kubernetes.io/target": args.ip,
          },
        },
        spec: {
          type: "ClusterIP",
          clusterIP: "None", // Headless service
          ports: [
            {
              name: "http",
              port: 80,
              targetPort: 80,
            },
          ],
        },
      },
      resourceOpts
    );
  }
}
