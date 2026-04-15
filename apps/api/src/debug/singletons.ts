// SPDX-License-Identifier: AGPL-3.0-only
import * as fs from "node:fs";
import * as grpc from "@grpc/grpc-js";
import { Agent } from "../agent/index.js";
import { CaddyClient } from "../caddy/index.js";

// ---------------------------------------------------------------------------
// Agent singleton
// ---------------------------------------------------------------------------

/**
 * Build gRPC credentials from environment variables.
 *
 * If PLOYDOK_AGENT_CA, PLOYDOK_AGENT_CLIENT_CERT and PLOYDOK_AGENT_CLIENT_KEY
 * are all set, creates an mTLS channel.
 * Otherwise falls back to insecure (dev).
 */
export function createAgent(): Agent {
  const caPath = Bun.env["PLOYDOK_AGENT_CA"];
  const certPath = Bun.env["PLOYDOK_AGENT_CLIENT_CERT"];
  const keyPath = Bun.env["PLOYDOK_AGENT_CLIENT_KEY"];

  if (caPath && certPath && keyPath) {
    const rootCert = fs.readFileSync(caPath);
    const clientKey = fs.readFileSync(keyPath);
    const clientCert = fs.readFileSync(certPath);
    const credentials = grpc.credentials.createSsl(rootCert, clientKey, clientCert);
    return new Agent({ credentials });
  }

  return new Agent();
}

// Lazy singletons — created on first access to avoid top-level side-effects
// during imports (e.g. during test setup where env vars may differ).
let _agent: Agent | null = null;
let _caddy: CaddyClient | null = null;

export function getSharedAgent(): Agent {
  if (!_agent) {
    _agent = createAgent();
  }
  return _agent;
}

export function getSharedCaddy(): CaddyClient {
  if (!_caddy) {
    const adminUrl = Bun.env["CADDY_ADMIN_URL"] ?? "http://127.0.0.1:2020";
    _caddy = new CaddyClient(adminUrl);
  }
  return _caddy;
}
