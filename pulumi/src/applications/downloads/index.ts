import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import { Prowlarr } from "./prowlarr";
import { Radarr } from "./radarr";
import { Sabnzbd } from "./sabnzbd";
import { Sonarr } from "./sonarr";
import { Seerr } from "./seerr";
import { QBittorrent } from "./qbittorrent";

export class Downloads extends pulumi.ComponentResource {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super("Downloads", name, {}, opts);

    const namespace = name;
    const ns = new k8s.core.v1.Namespace(
      namespace,
      {
        metadata: {
          name: name,
          labels: {
            app: name,
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
    new QBittorrent(
      "qbittorrent",
      { namespace, createNamespace: false },
      { parent: this, dependsOn: [ns] }
    );
    new Seerr("seerr", { namespace, createNamespace: false }, { parent: this, dependsOn: [ns] });
  }
}
