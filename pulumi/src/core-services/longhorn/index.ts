import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { applyTimezone, createIngress } from "../../utils";

export const BACKUP_JOB_GROUP: string = "backups-enabled";
export const FSTRIM_JOB_GROUP: string = "fstrim-enabled";

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

    const nfsIp = config.requireSecret("nfs_ip");
    const backupPath = config.requireSecret("longhorn_nfs_backup_path");
    const backupTarget: pulumi.Input<string> = pulumi.interpolate`nfs://${nfsIp}:${backupPath}`;
    const backupTargetCredentialSecret: pulumi.Input<string> | undefined = undefined; // NFS doesn't use this

    // Create namespace for Longhorn
    const ns = new k8s.core.v1.Namespace(
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

    // Install Kubernetes Snapshot CRDs and Controller
    const snapshotCrds = new k8s.kustomize.v2.Directory(
      "snapshot-crds-kustomize",
      {
        directory: "submodules/external-snapshotter/client/config/crd",
      },
      { parent: this }
    );

    const snapshotController = new k8s.kustomize.v2.Directory(
      "snapshot-controller-kustomize",
      {
        directory: "submodules/external-snapshotter/deploy/kubernetes/snapshot-controller",
        namespace: "kube-system",
      },
      { parent: this, dependsOn: [snapshotCrds] }
    );

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
            storageReservedPercentageForDefaultDisk: "10", // Reserve space to prevent disk full conditions
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
            // CSI sidecars need at least 2 replicas, otherwise it will prevent maintenance such as draining
            attacherReplicaCount: 2,
            provisionerReplicaCount: 2,
            resizerReplicaCount: 2,
            snapshotterReplicaCount: 2,
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
      { parent: this, dependsOn: [ns, snapshotController] }
    );

    // Create ingress for Longhorn UI
    createIngress(
      {
        namespace,
        subdomain: "longhorn",
        serviceName: "longhorn-frontend",
        port: 80,
        isPublic: false,
      },
      { parent: this, dependsOn: [longhornChart] }
    );

    new k8s.apiextensions.CustomResource(
      FSTRIM_JOB_GROUP,
      {
        apiVersion: "longhorn.io/v1beta2",
        kind: "RecurringJob",
        metadata: {
          name: FSTRIM_JOB_GROUP,
          namespace: this.namespace,
        },
        spec: {
          name: FSTRIM_JOB_GROUP,
          task: "filesystem-trim",
          cron: `0 ${applyTimezone(2)} * * *`,
          retain: 0,
          concurrency: 1,
          groups: [FSTRIM_JOB_GROUP],
          labels: {},
        },
      },
      { dependsOn: [longhornChart], parent: this }
    );

    new k8s.apiextensions.CustomResource(
      BACKUP_JOB_GROUP,
      {
        apiVersion: "longhorn.io/v1beta2",
        kind: "RecurringJob",
        metadata: {
          name: BACKUP_JOB_GROUP,
          namespace: this.namespace,
        },
        spec: {
          name: BACKUP_JOB_GROUP,
          task: "backup",
          cron: `0 ${applyTimezone(3)} * * *`,
          retain: 7,
          concurrency: 2,
          groups: [BACKUP_JOB_GROUP],
          labels: {},
        },
      },
      { dependsOn: [longhornChart], parent: this }
    );

    new k8s.apiextensions.CustomResource(
      "system-backup",
      {
        apiVersion: "longhorn.io/v1beta2",
        kind: "RecurringJob",
        metadata: {
          name: "system-backup",
          namespace: this.namespace,
        },
        spec: {
          name: "system-backup",
          task: "system-backup",
          cron: `0 ${applyTimezone(4)} * * *`,
          retain: 1,
          parameters: {
            "volume-backup-policy": "if-not-present",
          },
        },
      },
      { dependsOn: [longhornChart], parent: this }
    );

    // Register outputs
    this.registerOutputs({
      namespace: namespace,
    });
  }
}
