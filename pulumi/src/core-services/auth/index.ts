import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TinyAuth } from "./tinyauth";

export interface AuthArgs {
  namespace?: string;
}

export class Auth extends pulumi.ComponentResource {
  constructor(name: string, args: AuthArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super("core-services:auth", name, {}, opts);
    const namespace = args.namespace || name;
    console.log(`fooo:${namespace}`);
    opts = { ...opts, parent: this };

    const ns = new k8s.core.v1.Namespace(
      namespace,
      { metadata: { name: namespace } },
      { parent: this }
    );

    const tinyauth = new TinyAuth(
      "tinyauth",
      {
        namespace,
      },
      { ...opts, dependsOn: [ns] }
    );
  }
}
