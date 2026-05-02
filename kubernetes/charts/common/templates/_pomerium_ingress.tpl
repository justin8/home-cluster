{{- define "common.pomeriumIngress" -}}
{{- $ctx := .ctx -}}
{{- $name := .name | default $ctx.Chart.Name -}}
{{- $serviceName := .serviceName | default $name -}}
{{- $subdomain := .subdomain | default $name -}}
{{- $port := .port | default 80 -}}
{{- $path := .path | default "/" -}}
{{- $type := .type | default "private" -}}
{{- $allowedUsers := .allowedUsers | default "authed" -}}
{{- $isPublic := eq $type "public" -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ $name }}
  namespace: {{ $ctx.Release.Namespace }}
  annotations:
    {{- if $isPublic }}
    dns.external/enabled: "true"
    dns.external/target: home.{{ $ctx.Values.domain }}
    {{- end }}
    ingress.pomerium.io/preserve_host_header: "true"
    ingress.pomerium.io/pass_identity_headers: "true"
    ingress.pomerium.io/allow_websockets: "true"
    ingress.pomerium.io/timeout: "0s"
    ingress.pomerium.io/policy: |
      - allow:
          and:
            {{- if eq $allowedUsers "all" }}
            - accept: true
            {{- else if eq $allowedUsers "authed" }}
            - authenticated_user: true
            {{- else if eq $allowedUsers "private" }}
            - user:
                in: {{ $ctx.Values.userGroups.private }}
            {{- else if eq $allowedUsers "admin" }}
            - user:
                in: {{ $ctx.Values.userGroups.admin }}
            {{- end }}
      {{- if not $isPublic }}
      - deny:  
          not:
            - source_ip: ["{{ $ctx.Values.network.lanIpRange }}", "{{ $ctx.Values.network.tailscaleIpRange }}", "{{ $ctx.Values.network.clusterPodNet }}"]
      {{- end }}
spec:
  ingressClassName: pomerium
  rules:
    - host: {{ $subdomain }}.{{ $ctx.Values.domain }}
      http:
        paths:
          - path: {{ $path }}
            pathType: Prefix
            backend:
              service:
                name: {{ $serviceName }}
                port:
                  number: {{ $port }}
{{- end }}
