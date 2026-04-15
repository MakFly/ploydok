import type { CaddyConfig, CaddyRoute } from "./types.js";

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
  async upsertRoute({
    host,
    upstream,
    appId,
  }: {
    host: string;
    upstream: string;
    appId: string;
  }): Promise<void> {
    const routeId = `ploydok-${appId}`;

    // Idempotent : garantit que la structure srv0 existe avant PATCH/POST.
    // Sans ça, Caddy renvoie "invalid traversal path" au premier upsert.
    await this.ensureBootstrap();

    const route: CaddyRoute = {
      "@id": routeId,
      match: [{ host: [host] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: upstream }],
        },
      ],
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

    // srv0 sur :80 avec auto_https désactivé — dev HTTP pur.
    // En prod une autre config l'upgrade vers :443 avec ACME.
    // IMPORTANT : PATCH /config/apps au lieu de POST /config/ — sinon on écrase
    // le bloc admin root et on perd l'accès à l'admin API.
    const appsConfig = {
      http: {
        servers: {
          srv0: {
            listen: [":80"],
            routes: [],
            automatic_https: { disable: true },
          },
        },
      },
    };

    const patchRes = await fetch(`${this.baseUrl}/config/apps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appsConfig),
    });

    // Si /config/apps n'existe pas encore, PATCH retourne 404/500 → fallback
    // vers POST avec la clé "apps" explicite (toujours sans toucher à admin).
    if (!patchRes.ok) {
      const postRes = await fetch(`${this.baseUrl}/config/apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appsConfig),
      });
      if (!postRes.ok) {
        throw new Error(
          `CaddyClient.ensureBootstrap failed: PATCH ${patchRes.status} + POST ${postRes.status} ${await postRes.text()}`,
        );
      }
    }
  }
}
