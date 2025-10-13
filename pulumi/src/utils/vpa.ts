import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface VPAContainerPolicy {
  containerName?: string;
  minAllowed?: {
    cpu?: string;
    memory?: string;
  };
  maxAllowed?: {
    cpu?: string;
    memory?: string;
  };
}

export interface CreateVPAArgs {
  workload:
    | k8s.apps.v1.Deployment
    | k8s.apps.v1.ReplicaSet
    | k8s.apps.v1.DaemonSet
    | k8s.apps.v1.StatefulSet
    | k8s.batch.v1.Job
    | k8s.batch.v1.CronJob;
  updateMode?: "Off" | "Initial" | "Recreate" | "InPlaceOrRecreate" | "Auto";
  containerPolicies?: VPAContainerPolicy[];
}

export function createVPA(
  args: CreateVPAArgs,
  opts?: pulumi.ComponentResourceOptions
): pulumi.Output<k8s.apiextensions.CustomResource> {
  const {
    workload,
    updateMode = "InPlaceOrRecreate",
    containerPolicies = [
      {
        containerName: "*",
        minAllowed: { cpu: "10m", memory: "50Mi" },
        maxAllowed: { cpu: "4", memory: "10Gi" },
      },
    ],
  } = args;

  return workload.metadata.name.apply(workloadName => {
    let kind: string;
    let apiVersion: string;

    if (workload instanceof k8s.apps.v1.Deployment) {
      kind = "Deployment";
      apiVersion = "apps/v1";
    } else if (workload instanceof k8s.apps.v1.ReplicaSet) {
      kind = "ReplicaSet";
      apiVersion = "apps/v1";
    } else if (workload instanceof k8s.apps.v1.DaemonSet) {
      kind = "DaemonSet";
      apiVersion = "apps/v1";
    } else if (workload instanceof k8s.apps.v1.StatefulSet) {
      kind = "StatefulSet";
      apiVersion = "apps/v1";
    } else if (workload instanceof k8s.batch.v1.Job) {
      kind = "Job";
      apiVersion = "batch/v1";
    } else if (workload instanceof k8s.batch.v1.CronJob) {
      kind = "CronJob";
      apiVersion = "batch/v1";
    } else {
      throw new Error("Unsupported workload type for VPA");
    }

    return new k8s.apiextensions.CustomResource(
      `${workloadName}-vpa`,
      {
        apiVersion: "autoscaling.k8s.io/v1",
        kind: "VerticalPodAutoscaler",
        metadata: {
          name: `${workloadName}-vpa`,
          namespace: workload.metadata.namespace,
        },
        spec: {
          targetRef: {
            apiVersion,
            kind,
            name: workload.metadata.name,
          },
          updatePolicy: {
            updateMode,
          },
          resourcePolicy: {
            containerPolicies,
          },
        },
      },
      { ...opts, dependsOn: [workload] }
    );
  });
}
