// SPDX-License-Identifier: AGPL-3.0-only
import type {
  CaddyConfig,
  CaddyHandler,
  CaddyMiddlewares,
  CaddyRoute,
  CaddyTlsOptions,
} from "./types.js";

export class CaddyClient {
  private readonly baseUrl: string;

  constructor(baseUrl = "http://127.0.0.1:2020") {
    // Remove trailing slash for consistent URL building
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * GET /config/ — returns the full Caddy runtime config.
   */
  async getConfig(): Promise<CaddyConfig> {
    const res = await fetch(`${this.baseUrl}/config/`);
    if (!res.ok) {
      throw new Error(`CaddyClient.getConfig failed: ${res.status} ${await res.text()}`);
    }
    // Caddy returns null when config is empty
    const body = (await res.json()) as CaddyConfig | null;
    return body ?? {};
  }

  /**
   * Upsert a reverse-proxy route.
   * - If a route with @id `ploydok-{appId}` already exists → PATCH to replace it.
   * - Otherwise → POST to append it to srv0 routes.
   */
  /**
   * Build the handler array for a route, injecting middlewares before reverse_proxy.
   * Order: rate_limit → ip_allowlist (subroute) → basicauth → reverse_proxy
   */
  buildHandlers(upstream: string, middlewares?: CaddyMiddlewares): CaddyHandler[] {
    const handlers: CaddyHandler[] = [];

    if (middlewares?.rateLimit && middlewares.rateLimit.rps > 0) {
      handlers.push({
        handler: "rate_limit",
        rate_limits: {
          default: {
            key: "{http.request.remote_ip}",
            window: "1s",
            max_events: middlewares.rateLimit.rps,
          },
        },
      });
    }

    if (middlewares?.ipAllowlist && middlewares.ipAllowlist.length > 0) {
      handlers.push({
        handler: "subroute",
        routes: [
          {
            match: [{ remote_ip: { ranges: middlewares.ipAllowlist } }],
            handle: [],
            terminal: false,
          },
          {
            handle: [{ handler: "static_response", status_code: 403 }],
            terminal: true,
          },
        ],
      });
    }

    if (middlewares?.basicAuth) {
      handlers.push({
        handler: "authentication",
        providers: {
          http_basic: {
            accounts: [
              {
                username: middlewares.basicAuth.user,
                password: middlewares.basicAuth.pass_hash,
              },
            ],
          },
        },
      });
    }

    handlers.push({
      handler: "reverse_proxy",
      upstreams: [{ dial: upstream }],
    });

    return handlers;
  }

  async upsertRoute({
    host,
    upstream,
    appId,
    tls,
    middlewares,
  }: {
    host: string;
    upstream: string;
    appId: string;
    tls?: CaddyTlsOptions;
    middlewares?: CaddyMiddlewares;
  }): Promise<void> {
    const routeId = `ploydok-${appId}`;

    // Idempotent : garantit que la structure srv0 existe avant PATCH/POST.
    // Sans ça, Caddy renvoie "invalid traversal path" au premier upsert.
    await this.ensureBootstrap();

    // When DNS-01 is requested, register the TLS automation policy in Caddy
    // so the ACME client uses the DNS challenge for this hostname.
    if (tls?.mode === "dns01" && tls.provider) {
      await this.upsertDns01TlsPolicy(host, tls.provider, tls.providerConfig ?? {})
    }

    const route: CaddyRoute = {
      "@id": routeId,
      match: [{ host: [host] }],
      handle: this.buildHandlers(upstream, middlewares),
      terminal: true,
    };

    // Try to PATCH an existing route first
    const patchRes = await fetch(`${this.baseUrl}/id/${routeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(route),
    });

    if (patchRes.ok) {
      return;
    }

    // Route not found → POST to append
    if (patchRes.status === 404) {
      const postRes = await fetch(
        `${this.baseUrl}/config/apps/http/servers/srv0/routes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(route),
        },
      );
      if (!postRes.ok) {
        throw new Error(
          `CaddyClient.upsertRoute POST failed: ${postRes.status} ${await postRes.text()}`,
        );
      }
      return;
    }

    throw new Error(
      `CaddyClient.upsertRoute PATCH failed: ${patchRes.status} ${await patchRes.text()}`,
    );
  }

  /**
   * Remove a route by appId. Idempotent: 404 is treated as success.
   */
  async removeRoute(appId: string): Promise<void> {
    const routeId = `ploydok-${appId}`;
    const res = await fetch(`${this.baseUrl}/id/${routeId}`, {
      method: "DELETE",
    });

    if (res.ok || res.status === 404) {
      return;
    }

    throw new Error(
      `CaddyClient.removeRoute failed: ${res.status} ${await res.text()}`,
    );
  }

  // ---------------------------------------------------------------------------
  // M3.3 — upstream management for blue-green deploy
  // ---------------------------------------------------------------------------

  /**
   * Set (upsert) the upstream dial target for an app route.
   * Idempotent: if the route exists, its upstreams array is replaced.
   * If the route does not exist, creates a new one with the given upstream.
   *
   * @param appId   The app id (used as route @id `ploydok-{appId}` and host matcher).
   * @param host    The virtual host the route matches (e.g. "myapp.ploydok.local").
   * @param upstream `{ host, port }` of the target container on the ploydok-public network.
   */
  async setUpstream(
    appId: string,
    host: string,
    upstream: { host: string; port: number },
  ): Promise<void> {
    const dial = `${upstream.host}:${upstream.port}`;
    await this.upsertRoute({ host, upstream: dial, appId });
  }

  /**
   * Get the current upstream dial string for an app route, or null if the route
   * does not exist / has no reverse_proxy handler.
   */
  async getUpstream(
    appId: string,
  ): Promise<{ host: string; port: number } | null> {
    const routeId = `ploydok-${appId}`;

    const res = await fetch(`${this.baseUrl}/id/${routeId}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`CaddyClient.getUpstream failed: ${res.status} ${await res.text()}`);
    }

    let route: CaddyRoute;
    try {
      route = (await res.json()) as CaddyRoute;
    } catch {
      return null;
    }

    // Find the first reverse_proxy handle and extract its first upstream dial.
    for (const handle of route.handle ?? []) {
      if (handle.handler === "reverse_proxy") {
        const dial = handle.upstreams?.[0]?.dial ?? "";
        if (!dial) return null;
        // dial format: "host:port"
        const colonIdx = dial.lastIndexOf(":");
        if (colonIdx === -1) return null;
        const h = dial.slice(0, colonIdx);
        const p = parseInt(dial.slice(colonIdx + 1), 10);
        if (!h || isNaN(p)) return null;
        return { host: h, port: p };
      }
    }
    return null;
  }

  /**
   * Remove the upstream route for an app. Idempotent: 404 is treated as success.
   * Delegates to the existing `removeRoute` method.
   */
  async removeUpstream(appId: string): Promise<void> {
    return this.removeRoute(appId);
  }

  /**
   * Ensure Caddy has a minimal working config with srv0 (`:443`) and srv1 (`:80`).
   * Idempotent: no-op if srv0 already exists.
   */
  async ensureBootstrap(): Promise<void> {
    const config = await this.getConfig();

    // Already bootstrapped
    if (config.apps?.http?.servers?.["srv0"]) {
      return;
    }

    // srv0 sur :80, auto_https off → dev HTTP pur. En prod une config
    // séparée upgrade vers :443 + ACME.
    const srv0 = {
      listen: [":80"],
      routes: [],
      automatic_https: { disable: true },
    };

    // Chirurgical : on remonte progressivement jusqu'au niveau d'ancêtre
    // existant, et on crée srv0 avec le minimum de payload. Aucune requête
    // ne peut écraser un état existant (tous les parents non-existants sont
    // créés via PUT, jamais POST/PATCH sur /config/apps).
    if (config.apps?.http?.servers) {
      // servers existe → on ajoute juste srv0
      await this.putOrFail(`/config/apps/http/servers/srv0`, srv0, "servers.srv0");
      return;
    }
    if (config.apps?.http) {
      // http existe → on crée servers avec srv0
      await this.putOrFail(`/config/apps/http/servers`, { srv0 }, "http.servers");
      return;
    }
    if (config.apps) {
      // apps existe → on crée http avec servers+srv0
      await this.putOrFail(
        `/config/apps/http`,
        { servers: { srv0 } },
        "apps.http",
      );
      return;
    }
    // Config totalement vide → POST /config/apps est sûr (rien à écraser).
    await this.putOrFail(
      `/config/apps`,
      { http: { servers: { srv0 } } },
      "apps",
    );
  }

  /**
   * Upsert a Caddy TLS automation policy for a hostname to use DNS-01 challenge.
   * Idempotent: replaces an existing policy for the same subject if present.
   */
  async upsertDns01TlsPolicy(
    hostname: string,
    provider: string,
    providerConfig: Record<string, string>,
  ): Promise<void> {
    const config = await this.getConfig()
    const existingPolicies = config.apps?.tls?.automation?.policies ?? []

    // Remove any existing policy for this exact hostname to avoid duplicates
    const filtered = existingPolicies.filter(
      (p) => !(p.subjects?.length === 1 && p.subjects[0] === hostname),
    )

    const newPolicy = {
      subjects: [hostname],
      issuers: [
        {
          module: "acme",
          challenges: {
            dns: {
              provider: {
                name: provider,
                ...providerConfig,
              },
            },
          },
        },
      ],
    }

    const updatedPolicies = [...filtered, newPolicy]

    // Ensure apps.tls path exists then PUT policies
    await this.putOrFail("/config/apps/tls/automation/policies", updatedPolicies, "tls.automation.policies")
  }

  /**
   * Build a snapshot of the DNS-01 Caddy TLS policy for a hostname (for testing).
   */
  buildDns01TlsPolicy(
    hostname: string,
    provider: string,
    providerConfig: Record<string, string>,
  ): object {
    return {
      subjects: [hostname],
      issuers: [
        {
          module: "acme",
          challenges: {
            dns: {
              provider: {
                name: provider,
                ...providerConfig,
              },
            },
          },
        },
      ],
    }
  }

  private async putOrFail(path: string, body: unknown, label: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    throw new Error(
      `CaddyClient.ensureBootstrap failed creating ${label}: ${res.status} ${await res.text()}`,
    );
  }
}
