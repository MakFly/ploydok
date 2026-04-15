// SPDX-License-Identifier: AGPL-3.0-only
import { app } from "./app";
import { env } from "./env";

export function createApp() {
  return app;
}

if (import.meta.main) {
  Bun.serve({ port: env.PORT, fetch: app.fetch });
  console.log(`api listening on :${env.PORT}`);
}
