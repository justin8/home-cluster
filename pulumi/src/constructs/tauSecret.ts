import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { SHARED_SECRETS_NAMESPACE } from "../constants";
import { reflectorAnnotationsForNamespaces } from "../utils";

export interface TauSecretArgs {
  data: { [key: string]: pulumi.Input<string> };
  namespace?: pulumi.Input<string>;
  allowedNamespaces?: string[];
}

export class TauSecret extends pulumi.ComponentResource {
  public readonly name: string;
  public readonly secret: k8s.core.v1.Secret;
  public readonly data: { [key: string]: pulumi.Input<string> };

  constructor(name: string, args: TauSecretArgs, opts?: pulumi.ComponentResourceOptions) {
    super(name, name, {}, opts);
    const namespace = args.namespace || SHARED_SECRETS_NAMESPACE;
    const annotations = args.allowedNamespaces
      ? reflectorAnnotationsForNamespaces(args.allowedNamespaces)
      : {};
    this.name = name;
    this.data = args.data;

    this.secret = new k8s.core.v1.Secret(
      name,
      {
        metadata: {
          name,
          namespace,
          ...(Object.keys(annotations).length > 0 && { annotations }),
        },
        stringData: this.data,
      },
      opts
    );
  }
}
