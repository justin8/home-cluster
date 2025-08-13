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

export class Dns extends pulumi.ComponentResource {
  constructor(name: string, args: DnsArgs, opts?: pulumi.ComponentResourceOptions) {
    super("core-services:dns", name, {}, opts);
    const namespace = "dns";
    opts = { ...opts, parent: this };

    new k8s.core.v1.Namespace(namespace, { metadata: { name: namespace } }, { parent: this });

    const piholeSharedLabels = { app: "pihole" };
    const piholeVolumeManager = new VolumeManager("pihole", namespace, { parent: this });
    new PiHole(
      "pihole-primary",
      {
        namespace,
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
    //     namespace,
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
        namespace,
        provider: "pihole",
        ingressClasses: [args.privateIngressClass],
        registry: "noop",
        extraArgs: [
          pulumi.interpolate`--pihole-server=http://${getServiceURL("pihole-web", namespace)}`,
          "--pihole-api-version=6", // v5 is still the deault, but being deprecated soon-ish
        ],
      },
      opts
    );

    new ExternalDns(
      "external-dns-cloudflare",
      {
        namespace,
        provider: "cloudflare",
        ingressClasses: [args.publicIngressClass],
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
          namespace,
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
  }
}
