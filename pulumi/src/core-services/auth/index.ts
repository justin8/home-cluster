import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { PocketId } from "./pocketid";
import { TinyAuth } from "./tinyauth";

export interface AuthArgs {
  namespace?: string;
}

export class Auth extends pulumi.ComponentResource {
  constructor(name: string, args: AuthArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super("core-services:auth", name, {}, opts);
    const namespace = args.namespace || name;
    opts = { ...opts, parent: this };

    const ns = new k8s.core.v1.Namespace(
      namespace,
      { metadata: { name: namespace } },
      { parent: this }
    );

    const pocketid = new PocketId(
      "pocketid",
      { namespace, createNamespace: false },
      { ...opts, dependsOn: [ns] }
    );

    const tinyauth = new TinyAuth(
      "tinyauth",
      { namespace, createNamespace: false },
      { ...opts, dependsOn: [ns] }
    );
  }
}
