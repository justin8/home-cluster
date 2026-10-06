{{- define "common.vpa" -}}
{{- $ctx := .ctx -}}
{{- $name := .name | default $ctx.Chart.Name -}}
{{- $targetKind := .targetKind | default "Deployment" -}}
{{- $targetName := .targetName | default $name -}}
{{- $targetApiVersion := .targetApiVersion | default "apps/v1" -}}
{{- $updateMode := .updateMode | default "InPlaceOrRecreate" -}}
{{- $minReplicas := .minReplicas | default 1 | int -}}
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: {{ $name }}
  namespace: {{ $ctx.Release.Namespace }}
spec:
  targetRef:
    apiVersion: {{ $targetApiVersion }}
    kind: {{ $targetKind }}
    name: {{ $targetName }}
  updatePolicy:
    updateMode: {{ $updateMode | quote }}
    minReplicas: {{ $minReplicas }}
{{- end -}}
