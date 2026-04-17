// SPDX-License-Identifier: AGPL-3.0-only
import * as grpc from "@grpc/grpc-js";
import { AgentClient } from "@ploydok/agent-proto";

export interface AgentClientOptions {
  /**
   * Chemin vers le socket Unix de l'agent Rust.
   * Par défaut : process.env.PLOYDOK_AGENT_SOCKET, sinon
   *   - `/tmp/ploydok-agent.sock` hors prod (aligné sur `make dev-agent`)
   *   - `/run/ploydok/agent.sock` en prod
   */
  socketPath?: string;
  /**
   * Credentials gRPC.
   * Par défaut : insecure.
   * TODO(2.3): injecter ici les credentials mTLS via grpc.credentials.createSsl(...)
   */
  credentials?: grpc.ChannelCredentials;
}

function defaultSocketPath(): string {
  const env = process.env["PLOYDOK_AGENT_SOCKET"];
  if (env) return env;
  return process.env["NODE_ENV"] === "prod"
    ? "/run/ploydok/agent.sock"
    : "/tmp/ploydok-agent.sock";
}

/**
 * Crée un AgentClient gRPC connecté au socket Unix de l'agent.
 *
 * Hook mTLS (tâche 2.3) :
 *   const creds = grpc.credentials.createSsl(rootCert, clientKey, clientCert);
 *   createAgentClient({ credentials: creds });
 */
export function createAgentClient(opts: AgentClientOptions = {}): AgentClient {
  const socketPath = opts.socketPath ?? defaultSocketPath();

  const address = `unix://${socketPath}`;

  const credentials = opts.credentials ?? grpc.credentials.createInsecure();

  const channelOptions: grpc.ClientOptions = {
    // Large receive buffer for build context / image pull streams
    "grpc.max_receive_message_length": 256 * 1024 * 1024, // 256 MiB
    "grpc.max_send_message_length": 256 * 1024 * 1024, // 256 MiB
  };

  return new AgentClient(address, credentials, channelOptions);
}
