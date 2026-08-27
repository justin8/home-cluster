{{/*
CNPG Backup & Recovery specification template
Generates both `externalClusters` (for bootstrap recovery) and `backup` (for continuous WAL archiving)
CNPG automatically appends the cluster name to `destinationPath`
Usage:
  {{ include "common.cnpgBackup" (dict "ctx" . "name" "homeassistant-db") }}
*/}}
{{- define "common.cnpgBackup" -}}
{{- $ctx := .ctx -}}
{{- $name := .name -}}
{{- $sourceName := .sourceName | default (printf "%s-b2-backup" $name) -}}
{{- $global := $ctx.Values.global | default dict -}}
{{- $cnpg := $global.cnpg | default $ctx.Values.cnpg | default dict -}}
{{- $backup := $cnpg.backup | default dict -}}
{{- $bucket := $backup.bucket | default "jdray-backup" -}}
{{- $basePath := $backup.basePath | default (printf "s3://%s/cnpg" $bucket) -}}
{{- $endpoint := $backup.endpoint | default "https://s3.us-west-001.backblazeb2.com" -}}
{{- $secretName := $backup.secretName | default "cnpg-b2-credentials" -}}
externalClusters:
  - name: {{ $sourceName }}
    barmanObjectStore:
      destinationPath: {{ $basePath }}
      endpointURL: {{ $endpoint }}
      s3Credentials:
        accessKeyId:
          name: {{ $secretName }}
          key: AWS_ACCESS_KEY_ID
        secretAccessKey:
          name: {{ $secretName }}
          key: AWS_SECRET_ACCESS_KEY

backup:
  barmanObjectStore:
    destinationPath: {{ $basePath }}
    endpointURL: {{ $endpoint }}
    s3Credentials:
      accessKeyId:
        name: {{ $secretName }}
        key: AWS_ACCESS_KEY_ID
      secretAccessKey:
        name: {{ $secretName }}
        key: AWS_SECRET_ACCESS_KEY
    wal:
      compression: gzip
      maxParallel: 2
      archiveAdditionalCommandArgs:
        - "--no-check-wal-archive"
    data:
      compression: gzip
      immediate: true
  retentionPolicy: "30d"
{{- end -}}
