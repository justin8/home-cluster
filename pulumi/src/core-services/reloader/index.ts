import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface ReloaderArgs {
  namespace?: pulumi.Input<string>;
}

export class Reloader extends pulumi.ComponentResource {
  constructor(appName: string, args: ReloaderArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super(appName, appName, {}, opts);

    const namespace = args.namespace || "reloader";

    const ns = new k8s.core.v1.Namespace(
      `${appName}-ns`,
      {
        metadata: {
          name: namespace,
        },
      },
      { parent: this }
    );

    const helm = new k8s.helm.v3.Release(
      "reloader",
      {
        chart: "reloader",
        version: "2.2.3",
        repositoryOpts: {
          repo: "https://stakater.github.io/stakater-charts",
        },
        namespace: ns.metadata.name,
        values: {
          reloader: {
            watchGlobally: true,
            autoReloadAll: true,
          },
        },
      },
      { parent: this }
    );
  }
}
