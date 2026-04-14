{{- define "common.ingress" -}}
{{- $ctx := .ctx -}}
{{- $type := .type | default "traefik-private" -}}
{{- $name := .name | default $ctx.Chart.Name -}}
{{- $subdomain := .subdomain | default $name -}}
{{- $port := .port | default 80 -}}
{{- $auth := .auth | default false -}}
{{- $extraAnnotations := .annotations | default (dict) -}}

{{- $isPublic := eq $type "traefik-public" -}}
{{- $ingressSuffix := "" -}}
{{- if $isPublic }}{{ $ingressSuffix = "-public" }}{{ end -}}
{{- $ingressName := printf "%s%s" $name $ingressSuffix -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ $ingressName }}
  namespace: {{ $ctx.Release.Namespace }}
  annotations:
    {{- if $auth }}
    traefik.ingress.kubernetes.io/router.middlewares: {{ $type }}-tinyauth@kubernetescrd
    {{- end }}
    {{- if $isPublic }}
    external-dns.alpha.kubernetes.io/target: home.{{ $ctx.Values.domain }}
    {{- end }}
    {{- with $extraAnnotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  ingressClassName: {{ $type }}
  rules:
    - host: {{ $subdomain }}.{{ $ctx.Values.domain }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ $name }}
                port:
                  number: {{ $port }}
  tls:
    - hosts:
        - {{ $subdomain }}.{{ $ctx.Values.domain }}
{{- end }}
