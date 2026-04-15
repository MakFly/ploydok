// SPDX-License-Identifier: AGPL-3.0-only
import { app } from "./app";
import { env } from "./env";
import { getSharedCaddy, getSharedAgent } from "./debug/singletons.js";
import { AgentError, GrpcStatus } from "./agent/index.js";
import { childLogger } from "./logger";

const log = childLogger("boot");

export function createApp() {
  return app;
}

async function bootInfra(): Promise<void> {
  const caddy = getSharedCaddy();
  const agent = getSharedAgent();

  try {
    await caddy.ensureBootstrap();
    log.info("Caddy bootstrap OK");
  } catch (err) {
    log.warn({ err }, "Caddy bootstrap failed (non-fatal)");
  }

  try {
    await agent.networkCreate({ name: "ploydok-public", driver: "bridge", labels: {} });
    log.info("réseau ploydok-public créé");
  } catch (err) {
    if (err instanceof AgentError && err.code === GrpcStatus.ALREADY_EXISTS) {
      log.info("réseau ploydok-public déjà existant");
    } else {
      log.warn({ err }, "networkCreate ploydok-public failed (non-fatal)");
    }
  }
}

if (import.meta.main) {
  Bun.serve({ port: env.PORT, fetch: app.fetch });
  log.info({ port: env.PORT }, `api listening on :${env.PORT}`);

  // En dev : bootInfra skippé par défaut (évite warn Caddy/agent absents).
  // Activer explicitement via PLOYDOK_BOOT_INFRA=1 (ou via NODE_ENV=prod/test).
  const shouldBoot =
    env.NODE_ENV !== "dev" || Bun.env["PLOYDOK_BOOT_INFRA"] === "1";
  if (shouldBoot) {
    bootInfra().catch((err) => {
      log.error({ err }, "erreur inattendue au boot");
    });
  } else {
    log.debug("bootInfra skippé en dev (set PLOYDOK_BOOT_INFRA=1 pour l'activer)");
  }
}
