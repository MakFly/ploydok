// SPDX-License-Identifier: AGPL-3.0-only
// Minimal Caddy admin API types — only what we manipulate

export interface CaddyTlsOptions {
  mode: "http01" | "dns01"
  // DNS-01 specific: provider module name (e.g. "cloudflare", "route53")
  provider?: string
  // Arbitrary provider credentials passed as-is into Caddy TLS policy
  providerConfig?: Record<string, string>
}

export interface CaddyConfig {
  apps?: {
    http?: {
      servers?: Record<string, CaddyServer>;
    };
    tls?: {
      automation?: {
        policies?: CaddyTlsPolicy[]
      }
    }
  };
}

export interface CaddyTlsPolicy {
  subjects?: string[]
  issuers?: Array<{
    module?: string
    challenges?: {
      dns?: {
        provider?: Record<string, unknown>
      }
    }
  }>
}

export interface CaddyServer {
  listen?: string[];
  routes?: CaddyRoute[];
  automatic_https?: {
    disable?: boolean;
    skip?: string[];
  };
}

export interface CaddyRoute {
  "@id"?: string;
  match?: CaddyMatch[];
  handle?: CaddyHandler[];
  terminal?: boolean;
}

export interface CaddyMatch {
  host?: string[];
}

export type CaddyHandler = CaddyReverseProxyHandler | CaddyStaticResponseHandler;

export interface CaddyReverseProxyHandler {
  handler: "reverse_proxy";
  upstreams: Array<{ dial: string }>;
}

export interface CaddyStaticResponseHandler {
  handler: "static_response";
  status_code?: number;
  body?: string;
}
