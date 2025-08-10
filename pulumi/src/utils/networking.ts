import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export function createIpAddressPool(
  name: string,
  ipAddresses: pulumi.Input<pulumi.Input<string>[]>,
  opts?: pulumi.ComponentResourceOptions
): pulumi.Output<string> {
  const pool = new k8s.apiextensions.CustomResource(
    `${name}-pool`,
    {
      apiVersion: "metallb.io/v1beta1",
      kind: "IPAddressPool",
      metadata: {
        name,
        namespace: "metallb-system",
      },
      spec: {
        addresses: ipAddresses,
        autoAssign: false,
      },
    },
    opts
  );

  new k8s.apiextensions.CustomResource(
    `${name}-l2-advertisement`,
    {
      apiVersion: "metallb.io/v1beta1",
      kind: "L2Advertisement",
      metadata: {
        name,
        namespace: "metallb-system",
      },
      spec: {
        ipAddressPools: [pool.metadata.name],
      },
    },
    { ...opts, dependsOn: [pool] }
  );

  return pool.metadata.name;
}

/**
 * Parses an IP range string (e.g. "192.168.1.10-192.168.1.20") into an array of IP addresses.
 * Only supports ranges within the last octet.
 * @param range The IP range string
 * @returns Array of IP addresses in the range
 */
export function parseIPRange(range: string): string[] {
  const [start, end] = range.split("-");
  const startParts = start.split(".").map(Number);
  const endParts = end.split(".").map(Number);
  const ips: string[] = [];

  for (let i = startParts[3]; i <= endParts[3]; i++) {
    ips.push(`${startParts.slice(0, 3).join(".")}.${i}`);
  }

  return ips;
}
