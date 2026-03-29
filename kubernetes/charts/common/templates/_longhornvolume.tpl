{{- define "common.longhornVolume" -}}
{{- $ctx := .ctx -}}
{{- $name := .name -}}
{{- $sizeGi := .sizeGi | default 1 | int -}}
{{- $backupsEnabled := .backupsEnabled | default "enabled" -}}
{{- if lt $sizeGi 1 -}}
  {{- $sizeGi = 1 -}}
{{- end -}}
apiVersion: longhorn.io/v1beta2
kind: Volume
metadata:
  name: {{ $name }}
  namespace: longhorn-system
  labels:
    recurring-job-group.longhorn.io/backups-enabled: {{ $backupsEnabled }}
    recurring-job-group.longhorn.io/fstrim-enabled: enabled
spec:
  size: {{ mul $sizeGi 1024 | mul 1024 | mul 1024 | quote }}
  dataLocality: best-effort
  numberOfReplicas: 2
  accessMode: rwo
  frontend: blockdev
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: {{ $name }}
spec:
  capacity:
    storage: {{ $sizeGi }}Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: longhorn
  csi:
    driver: driver.longhorn.io
    fsType: ext4
    volumeHandle: {{ $name }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ $name }}
  namespace: {{ $ctx.Release.Namespace }}
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: longhorn
  volumeName: {{ $name }}
  resources:
    requests:
      storage: {{ $sizeGi }}Gi
{{- end -}}
