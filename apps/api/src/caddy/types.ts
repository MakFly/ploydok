// SPDX-License-Identifier: AGPL-3.0-only
// Minimal Caddy admin API types — only what we manipulate

export interface CaddyConfig {
  apps?: {
    http?: {
      servers?: Record<string, CaddyServer>;
    };
  };
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
