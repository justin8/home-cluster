import * as pulumi from "@pulumi/pulumi";

export function reflectorAnnotation(
  key: pulumi.Input<string>,
  value: pulumi.Input<string>
) {
  return {
    [`reflector.v1.k8s.emberstack.com/reflection-${key}`]: value,
  };
}

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

// Export Authelia utilities
export * from "./authelia";
