{{- define "common.vpa" -}}
{{- $ctx := .ctx -}}
{{- $name := .name | default $ctx.Chart.Name -}}
{{- $targetKind := .targetKind | default "Deployment" -}}
{{- $targetName := .targetName | default $name -}}
{{- $targetApiVersion := .targetApiVersion | default "apps/v1" -}}
{{- $updateMode := .updateMode | default "InPlaceOrRecreate" -}}
{{- $minReplicas := .minReplicas | default 1 | int -}}
{{- $maxAllowed := .maxAllowed -}}
{{- $minAllowed := .minAllowed -}}
{{- $containerName := .containerName | default "*" -}}
{{- $resourcePolicy := .resourcePolicy -}}
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
  {{- if or $resourcePolicy $maxAllowed $minAllowed }}
  resourcePolicy:
    {{- if $resourcePolicy }}
    {{- toYaml $resourcePolicy | nindent 4 }}
    {{- else }}
    containerPolicies:
      - containerName: {{ $containerName | quote }}
        {{- if $maxAllowed }}
        maxAllowed:
          {{- toYaml $maxAllowed | nindent 10 }}
        {{- end }}
        {{- if $minAllowed }}
        minAllowed:
          {{- toYaml $minAllowed | nindent 10 }}
        {{- end }}
    {{- end }}
  {{- end }}
{{- end -}}
