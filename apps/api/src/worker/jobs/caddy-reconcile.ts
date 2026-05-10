// SPDX-License-Identifier: AGPL-3.0-only
//
// Caddy self-heal cron. Runs reconcileIngressOnce every TICK_MS and re-pushes
// any user-app/service/DB-proxy route that disappeared from Caddy's runtime
// state.
//
// Why we need this: the boot reconcile (apps/api/src/index.ts:bootInfra)
// only runs once at API startup. If Caddy is restarted, force-recreated, or
// loses its in-memory config later (e.g. an admin runs
// `docker compose up -d --force-recreate caddy` without restarting the API),
// nothing detects the drift. User apps become unreachable until somebody
// notices and restarts the API. This cron closes that window: at the next
// tick (≤ 60 s), reconcileIngressOnce finds the missing routes and pushes
// them back.
//
// The function is idempotent: when Caddy already has every expected route,
// reconcileCaddyRoutes does GETs only and returns synced=0. We log INFO when
// totalSynced > 0 (drift detected and self-healed — this is the actionable
// signal you want to grep for) and DEBUG when everything was already in
// place (the steady-state quiet path).

import type { Db } from "@ploydok/db"
import { childLogger } from "../../logger"
import { getSharedAgent, getSharedCaddy } from "../../debug/singletons.js"
import { reconcileIngressOnce } from "../../services/ingress-reconcile.js"

const log = childLogger("cron.caddy.reconcile")

const TICK_MS = 60 * 1000

let _timer: ReturnType<typeof setInterval> | null = null

export async function caddyReconcileTick(db: Db): Promise<void> {
  const caddy = getSharedCaddy()
  const agent = getSharedAgent()

  try {
    const result = await reconcileIngressOnce({ db, caddy, agent, logger: log })

    if (result.totalSynced > 0) {
      // Drift detected and self-healed — surface this loudly so it shows up
      // in `docker logs ploydok-api-1 | grep self-heal` and operators know
      // an out-of-band Caddy event happened.
      log.info(
        {
          event: "caddy.self_heal",
          appRoutes: result.appRoutes,
          serviceRoutes: result.serviceRoutes,
          databaseProxies: result.databaseProxies,
          attachments: result.attachments,
          totalSynced: result.totalSynced,
        },
        "caddy reconcile: drift detected — re-pushed missing routes (self-heal)"
      )
    } else if (result.totalFailed > 0) {
      log.warn(
        {
          event: "caddy.reconcile_partial",
          totalFailed: result.totalFailed,
          appRoutes: result.appRoutes,
          serviceRoutes: result.serviceRoutes,
          databaseProxies: result.databaseProxies,
          attachments: result.attachments,
        },
        "caddy reconcile tick: some routes failed — will retry next tick"
      )
    } else {
      log.debug(
        {
          appRoutes: result.appRoutes,
          serviceRoutes: result.serviceRoutes,
          databaseProxies: result.databaseProxies,
        },
        "caddy reconcile tick: no drift"
      )
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, "caddy reconcile tick failed")
  }
}

export function startCaddyReconcileCron(db: Db): void {
  stopCaddyReconcileCron()
  _timer = setInterval(() => {
    void caddyReconcileTick(db)
  }, TICK_MS)
  log.info(
    { intervalSec: TICK_MS / 1_000 },
    "caddy reconcile cron scheduled (self-heal Caddy drift)"
  )
}

export function stopCaddyReconcileCron(): void {
  if (_timer !== null) {
    clearInterval(_timer)
    _timer = null
  }
}
