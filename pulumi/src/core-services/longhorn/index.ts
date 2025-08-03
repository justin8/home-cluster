import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { createIngress } from "../../utils";

export interface LonghornArgs {
  /** @default "longhorn-system" */
  namespace?: pulumi.Input<string>;
  version?: pulumi.Input<string>;
  /** @default "/var/lib/longhorn" */
  dataPath?: pulumi.Input<string>;
  /** @default 2 */
  defaultReplicaCount?: pulumi.Input<number>;
  backupTarget?: pulumi.Input<string>;
  backupTargetCredentialSecret?: pulumi.Input<string>;
}

export class Longhorn extends pulumi.ComponentResource {
  public readonly namespace: pulumi.Input<string>;

  constructor(name: string, args: LonghornArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super("tau:core-services:longhorn", name, {}, opts);

    // Set up defaults
    const version: pulumi.Input<string> = args.version || "1.9.1";
    const namespace: pulumi.Input<string> = args.namespace || "longhorn-system";
    const dataPath: pulumi.Input<string> = args.dataPath || "/var/lib/longhorn";
    const defaultReplicaCount: pulumi.Input<number> = args.defaultReplicaCount || 2;
    const dataLocality: string = "best-effort";

    const config = new pulumi.Config();
    const domain = config.require("domain");

    const nfsServer = config.requireSecret("nfs_hostname");
    const backupPath = config.requireSecret("longhorn_nfs_backup_path");
    const backupTarget: pulumi.Input<string> = pulumi.interpolate`nfs://${nfsServer}:${backupPath}`;
    const backupTargetCredentialSecret: pulumi.Input<string> | undefined = undefined; // NFS doesn't use this

    // Create namespace for Longhorn
    const longhornNamespace = new k8s.core.v1.Namespace(
      "longhorn-system",
      {
        metadata: {
          name: namespace,
          labels: {
            "pod-security.kubernetes.io/enforce": "privileged",
            "pod-security.kubernetes.io/audit": "privileged",
            "pod-security.kubernetes.io/warn": "privileged",
          },
        },
      },
      { parent: this }
    );

    this.namespace = namespace;

    // Deploy Longhorn via Helm chart
    const longhornChart = new k8s.helm.v3.Release(
      "longhorn",
      {
        chart: "longhorn",
        version: version,
        repositoryOpts: {
          repo: "https://charts.longhorn.io",
        },
        namespace: namespace,
        values: {
          defaultSettings: {
            defaultReplicaCount: defaultReplicaCount,
            storageMinimalAvailablePercentage: 10,
            createDefaultDiskLabeledNodes: true,
            defaultDataPath: dataPath,
            defaultDataLocality: dataLocality,
            guaranteedEngineManagerCPU: 0.15,
            guaranteedReplicaManagerCPU: 0.15,
            concurrentReplicaRebuildPerNodeLimit: 1,
            replicaSoftAntiAffinity: "false", // REQUIRE different nodes for replicas
            replicaZoneSoftAntiAffinity: "true", // Prefer different zones if available
            replicaDiskSoftAntiAffinity: "false", // REQUIRE different disks for replicas
            upgradeChecker: "false",
            // storageNetwork: "", // Use default network for storage traffic
            autoSalvage: "true", // Enable auto salvage to recover from unexpected failures

            // Settings for Talos Linux control plane nodes
            systemManagedComponentsNodeSelector: "false",
            taintToleration:
              "node-role.kubernetes.io/control-plane:NoSchedule;node-role.kubernetes.io/master:NoSchedule",
            disableSchedulingOnCordonedNode: "true", // Prevent scheduling on cordoned nodes
            replicaReplenishmentWaitInterval: "300", // Delay replica creation to prevent thrashing
            storageReservedPercentageForDefaultDisk: "30", // Reserve space to prevent disk full conditions
            kubernetesClusterAutoscalerEnabled: "false", // Disable since not using cluster autoscaler
            nodeDownPodDeletionPolicy: "delete-both-statefulset-and-deployment-pod", // Ensure pods are rescheduled when a node is down
          },
          defaultBackupStore: {
            backupTarget: backupTarget,
            backupTargetCredentialSecret: backupTargetCredentialSecret,
          },
          persistence: {
            defaultClass: true,
            defaultClassReplicaCount: defaultReplicaCount,
            defaultDataLocality: dataLocality,
            reclaimPolicy: "Retain", // TODO: Maybe set this to delete after testing backups more
            defaultFsType: "ext4",
          },
          preUpgradeChecker: {
            jobEnabled: false,
          },
          csi: {
            // CSI sidecars can use a single replica to reduce resource usage
            attacherReplicaCount: 1,
            provisionerReplicaCount: 1,
            resizerReplicaCount: 1,
            snapshotterReplicaCount: 1,
          },
          longhornUI: {
            replicas: 1, // UI can use single replica as it's non-critical
            tolerations: [
              {
                key: "node-role.kubernetes.io/control-plane",
                operator: "Exists",
                effect: "NoSchedule",
              },
              {
                key: "node-role.kubernetes.io/master",
                operator: "Exists",
                effect: "NoSchedule",
              },
            ],
          },
          longhornManager: {
            tolerations: [
              {
                key: "node-role.kubernetes.io/control-plane",
                operator: "Exists",
                effect: "NoSchedule",
              },
              {
                key: "node-role.kubernetes.io/master",
                operator: "Exists",
                effect: "NoSchedule",
              },
            ],
            nodeSelector: {}, // Run on any available node
          },
          longhornDriverDeployer: {
            tolerations: [
              {
                key: "node-role.kubernetes.io/control-plane",
                operator: "Exists",
                effect: "NoSchedule",
              },
              {
                key: "node-role.kubernetes.io/master",
                operator: "Exists",
                effect: "NoSchedule",
              },
            ],
            nodeSelector: {}, // Run on any available node
          },
          longhornDriver: {
            tolerations: [
              {
                key: "node-role.kubernetes.io/control-plane",
                operator: "Exists",
                effect: "NoSchedule",
              },
              {
                key: "node-role.kubernetes.io/master",
                operator: "Exists",
                effect: "NoSchedule",
              },
            ],
            nodeSelector: {}, // Run on any available node
          },
        },
        skipAwait: false,
        createNamespace: false,
      },
      { parent: this, dependsOn: [longhornNamespace] }
    );

    // Create ingress for Longhorn UI
    createIngress({
      name: "longhorn-ui-ingress",
      namespace: namespace as string,
      host: pulumi.interpolate`longhorn.${domain}`,
      serviceName: "longhorn-frontend",
      servicePort: 80,
      public: false,
      parent: this,
    });

    // Register outputs
    this.registerOutputs({
      namespace: namespace,
    });
  }
}
