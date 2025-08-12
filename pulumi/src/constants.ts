import { getServiceURL } from "./utils";

export const DEFAULT_TLS_SECRET = "default-tls";
export const PUBLIC_INGRESS_CLASS = "traefik-public";
export const PRIVATE_INGRESS_CLASS = "traefik-private";
export const SHARED_SECRETS_NAMESPACE = "shared-secrets";
export const PUBLIC_AUTH_MIDDLEWARE = "traefik-public-tinyauth@kubernetescrd";
export const PRIVATE_AUTH_MIDDLEWARE = "traefik-private-tinyauth@kubernetescrd";
export const MAIL_PROXY_ENDPOINT = getServiceURL("smtp", "mail-proxy");
export const MAIL_PROXY_PORT = 587;
export const AUTH_ADMIN_GROUP = "admin";
export const AUTH_PRIVATE_GROUP = "private";
