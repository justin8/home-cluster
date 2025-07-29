import * as pulumi from "@pulumi/pulumi";

export function reflectorAnnotation(key: pulumi.Input<string>, value: pulumi.Input<string>) {
  return {
    [`reflector.v1.k8s.emberstack.com/reflection-${key}`]: value,
  };
}