{{- define "common.longhornVolume" -}}
{{- $ctx := .ctx -}}
{{- $name := .name -}}
{{- $sizeGi := .sizeGi | default 1 | int -}}
{{- $backups := .backups | default "enabled" -}}
{{- $shared := .shared | default false -}}
{{- $dataEngine := .dataEngine | default "v1" -}}
{{- $replicas := .replicas | default 2 | int -}}
{{- if lt $sizeGi 1 -}}
  {{- $sizeGi = 1 -}}
{{- end -}}
apiVersion: longhorn.io/v1beta2
kind: Volume
metadata:
  name: {{ $name }}
  namespace: longhorn-system
  labels:
    recurring-job-group.longhorn.io/fstrim-enabled: enabled
    {{- if ne $backups "disabled" }}
    recurring-job-group.longhorn.io/backups-enabled: enabled
    {{- end }}
spec:
  dataEngine: {{ $dataEngine }}
  size: {{ mul $sizeGi 1024 | mul 1024 | mul 1024 | quote }}
  dataLocality: best-effort
  numberOfReplicas: {{ $replicas }}
  accessMode: {{ if $shared }}rwx{{ else }}rwo{{ end }}
  frontend: blockdev
  {{- if ne $backups "disabled" }}
  backupTargetName: default
  {{- end }}
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: {{ $name }}
spec:
  capacity:
    storage: {{ $sizeGi }}Gi
  accessModes:
    - {{ if $shared }}ReadWriteMany{{ else }}ReadWriteOnce{{ end }}
  persistentVolumeReclaimPolicy: Retain
  storageClassName: longhorn
  csi:
    driver: driver.longhorn.io
    fsType: ext4
    volumeHandle: {{ $name }}
    {{- if $shared }}
    volumeAttributes:
      share: "true"
    {{- end }}
  {{- if $shared }}
  mountOptions:
    - soft
    - timeo=30
    - retrans=2
  {{- end }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ $name }}
  namespace: {{ $ctx.Release.Namespace }}
spec:
  accessModes:
    - {{ if $shared }}ReadWriteMany{{ else }}ReadWriteOnce{{ end }}
  storageClassName: longhorn
  volumeName: {{ $name }}
  resources:
    requests:
      storage: {{ $sizeGi }}Gi
{{- end -}}
