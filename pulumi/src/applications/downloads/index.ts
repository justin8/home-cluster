import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { Prowlarr } from "./prowlarr";
import { Radarr } from "./radarr";
import { Sabnzbd } from "./sabnzbd";
import { Sonarr } from "./sonarr";
import { Transmission } from "./transmission";

export class Downloads extends pulumi.ComponentResource {
  constructor(opts?: pulumi.ComponentResourceOptions) {
    super("Downloads", "downloads", {}, opts);

    const namespace = "downloads";
    const ns = new k8s.core.v1.Namespace(
      namespace,
      {
        metadata: {
          name: "downloads",
          labels: {
            app: "downloads",
            "pod-security.kubernetes.io/enforce": "privileged",
            "pod-security.kubernetes.io/audit": "privileged",
            "pod-security.kubernetes.io/warn": "privileged",
          },
        },
      },
      { parent: this }
    );

    new Radarr("radarr", { namespace, createNamespace: false }, { parent: this, dependsOn: [ns] });
    new Sonarr("sonarr", { namespace, createNamespace: false }, { parent: this, dependsOn: [ns] });
    new Prowlarr(
      "prowlarr",
      { namespace, createNamespace: false },
      { parent: this, dependsOn: [ns] }
    );
    new Sabnzbd(
      "sabnzbd",
      { namespace, createNamespace: false },
      { parent: this, dependsOn: [ns] }
    );
    new Transmission(
      "transmission",
      { namespace, createNamespace: false },
      { parent: this, dependsOn: [ns] }
    );
  }
}
