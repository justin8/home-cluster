{{- define "common.ingress" -}}
{{- $ctx := .ctx -}}
{{- $name := .name | default $ctx.Chart.Name -}}
{{- $subdomain := .subdomain | default $name -}}
{{- $port := .port | default 80 -}}
{{- $path := .path | default "/" -}}
{{- $pathSuffix := eq $path "/" | ternary "" (replace "/" "-" $path) -}}

{{- /* Backward compatibility for 'type' */ -}}
{{- $public := .public | default false -}}
{{- if eq (.type | default "") "traefik-public" -}}
  {{- $public = true -}}
{{- end -}}

{{- /* Backward compatibility for 'auth' boolean */ -}}
{{- $auth := .auth -}}
{{- if eq (kindOf $auth) "bool" -}}
  {{- $auth = $auth | ternary "authenticated" "public" -}}
{{- else -}}
  {{- $auth = $auth | default "authenticated" -}}
{{- end -}}

{{- $group := .group | default "" -}}
{{- $extraAnnotations := .annotations | default (dict) -}}

{{- /* Ingress name suffix for public instances */ -}}
{{- $ingressSuffix := "" -}}
{{- if $public }}{{ $ingressSuffix = "-public" }}{{ end -}}
{{- $ingressName := printf "%s%s%s" $name $pathSuffix $ingressSuffix -}}

apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ $ingressName }}
  namespace: {{ $ctx.Release.Namespace }}
  annotations:
    # 1. DNS Sync (Internal is always on via ExternalDNS Pi-hole, Public is opt-in)
    {{- if $public }}
    dns.external/enabled: "true"
    dns.external/target: home.{{ $ctx.Values.domain }}
    {{- end }}

    # 2. Authentication Strategy
    {{- if eq $auth "public" }}
    ingress.pomerium.io/allow_public_unauthenticated_access: "true"
    {{- else if eq $auth "authenticated" }}
    ingress.pomerium.io/allow_any_authenticated_user: "true"
    {{- end }}

    # 3. Authorization Policy
    ingress.pomerium.io/policy: |
      {{- if $group }}
      - allow:
          and:
            - groups: { has: {{ $group }} }
      {{- end }}
      - deny:
          and:
            - source_ip: {{ $ctx.Values.network.routerIp }}

    {{- with $extraAnnotations }}
    {{- toYaml . | nindent 4 }}
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
                name: {{ $name }}
                port:
                  number: {{ $port }}
  tls:
    - hosts:
        - {{ $subdomain }}.{{ $ctx.Values.domain }}
{{- end }}
