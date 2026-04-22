// SPDX-License-Identifier: AGPL-3.0-only
import * as grpc from "@grpc/grpc-js";
import { type ServiceError, status as GrpcStatus } from "@grpc/grpc-js";
import { childLogger } from "../logger";
import type {
  AgentClient,
  ContainerCreateRequest,
  ContainerCreateResponse,
  ContainerStartRequest,
  ContainerStartResponse,
  ContainerStopRequest,
  ContainerStopResponse,
  ContainerRemoveRequest,
  ContainerRemoveResponse,
  ContainerLogsRequest,
  LogLine,
  ContainerStatsRequest,
  StatsFrame,
  ImagePullRequest,
  PullProgress,
  ImageBuildRequest,
  BuildProgress,
  NetworkCreateRequest,
  NetworkCreateResponse,
  NetworkRemoveRequest,
  NetworkRemoveResponse,
  NetworkConnectRequest,
  NetworkConnectResponse,
  NetworkDisconnectRequest,
  NetworkDisconnectResponse,
  ListContainersRequest,
  ListContainersResponse,
  PingContainerRequest,
  PingContainerResponse,
  ExecFrame,
} from "@ploydok/agent-proto";
import { createAgentClient, type AgentClientOptions } from "./client.js";
import { AgentError, toAgentError } from "./errors.js";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = childLogger("agent");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;

/**
 * Promisifie un appel gRPC unary avec timeout et 1 retry sur UNAVAILABLE.
 */
function callUnary<Req, Res>(
  fn: (
    req: Req,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    cb: (err: ServiceError | null, res: Res) => void,
  ) => void,
  req: Req,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  retries: number = MAX_RETRIES,
): Promise<Res> {
  return new Promise<Res>((resolve, reject) => {
    const attempt = (remaining: number) => {
      const deadline = new Date(Date.now() + timeoutMs);
      fn(req, new grpc.Metadata(), { deadline }, (err, res) => {
        if (err) {
          const agentErr = toAgentError(err);
          if (agentErr.isTransient && remaining > 0) {
            log.warn({ code: agentErr.code, remaining }, "appel gRPC échoué, nouvelle tentative");
            // Retry immédiat — back-off plus sophistiqué peut être ajouté ici
            attempt(remaining - 1);
          } else {
            reject(agentErr);
          }
        } else {
          resolve(res);
        }
      });
    };
    attempt(retries);
  });
}

/**
 * Transforme un ClientReadableStream en AsyncIterable.
 */
function streamToAsyncIterable<T>(
  stream: import("@grpc/grpc-js").ClientReadableStream<T>,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const queue: Array<{ value?: T; done: boolean; error?: unknown }> = [];
      let resolveNext: (() => void) | null = null;
      let finished = false;

      stream.on("data", (chunk: T) => {
        queue.push({ value: chunk, done: false });
        resolveNext?.();
        resolveNext = null;
      });
      stream.on("end", () => {
        finished = true;
        queue.push({ done: true });
        resolveNext?.();
        resolveNext = null;
      });
      stream.on("error", (err: unknown) => {
        finished = true;
        queue.push({ done: true, error: toAgentError(err) });
        resolveNext?.();
        resolveNext = null;
      });

      return {
        async next(): Promise<IteratorResult<T>> {
          // Attendre qu'un item soit disponible
          while (queue.length === 0 && !finished) {
            await new Promise<void>((r) => {
              resolveNext = r;
            });
          }
          const item = queue.shift();
          if (!item) return { done: true, value: undefined as unknown as T };
          if (item.error) throw item.error;
          if (item.done) return { done: true, value: undefined as unknown as T };
          return { done: false, value: item.value as T };
        },
        return(): Promise<IteratorResult<T>> {
          stream.destroy();
          return Promise.resolve({ done: true, value: undefined as unknown as T });
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Classe principale
// ---------------------------------------------------------------------------

/**
 * Wrapper haut-niveau autour de AgentClient.
 *
 * Utilisation (tâche 2.6) :
 *   const agent = new Agent();
 *   const { containerId } = await agent.containerCreate({ name: "ploydok-web", image: "nginx:alpine", ... });
 *
 *   for await (const line of agent.containerLogs({ containerId, follow: true, sinceUnix: 0, tail: 100 })) {
 *     console.log(line.stream, line.line);
 *   }
 */
export class Agent {
  private readonly client: AgentClient;

  constructor(opts: AgentClientOptions = {}) {
    this.client = createAgentClient(opts);
    log.debug({ socketPath: opts.socketPath }, "Agent initialisé");
  }

  // -------------------------------------------------------------------------
  // RPCs unary
  // -------------------------------------------------------------------------

  containerCreate(req: ContainerCreateRequest, timeoutMs?: number): Promise<ContainerCreateResponse> {
    log.debug({ name: req.name, image: req.image }, "containerCreate");
    return callUnary(
      (r, m, opts, cb) => this.client.containerCreate(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  containerStart(req: ContainerStartRequest, timeoutMs?: number): Promise<ContainerStartResponse> {
    log.debug({ containerId: req.containerId }, "containerStart");
    return callUnary(
      (r, m, opts, cb) => this.client.containerStart(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  containerStop(req: ContainerStopRequest, timeoutMs?: number): Promise<ContainerStopResponse> {
    log.debug({ containerId: req.containerId }, "containerStop");
    return callUnary(
      (r, m, opts, cb) => this.client.containerStop(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  containerRemove(req: ContainerRemoveRequest, timeoutMs?: number): Promise<ContainerRemoveResponse> {
    log.debug({ containerId: req.containerId }, "containerRemove");
    return callUnary(
      (r, m, opts, cb) => this.client.containerRemove(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  networkCreate(req: NetworkCreateRequest, timeoutMs?: number): Promise<NetworkCreateResponse> {
    log.debug({ name: req.name }, "networkCreate");
    return callUnary(
      (r, m, opts, cb) => this.client.networkCreate(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  networkRemove(req: NetworkRemoveRequest, timeoutMs?: number): Promise<NetworkRemoveResponse> {
    log.debug({ networkId: req.networkId }, "networkRemove");
    return callUnary(
      (r, m, opts, cb) => this.client.networkRemove(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  networkConnect(req: NetworkConnectRequest, timeoutMs?: number): Promise<NetworkConnectResponse> {
    log.debug(
      { networkId: req.networkId, containerId: req.containerId, aliases: req.aliases },
      "networkConnect",
    );
    return callUnary(
      (r, m, opts, cb) => this.client.networkConnect(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  networkDisconnect(
    req: NetworkDisconnectRequest,
    timeoutMs?: number,
  ): Promise<NetworkDisconnectResponse> {
    log.debug(
      { networkId: req.networkId, containerId: req.containerId, force: req.force },
      "networkDisconnect",
    );
    return callUnary(
      (r, m, opts, cb) => this.client.networkDisconnect(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  listContainers(req: ListContainersRequest, timeoutMs?: number): Promise<ListContainersResponse> {
    log.debug({ kindFilter: req.kindFilter }, "listContainers");
    return callUnary(
      (r, m, opts, cb) => this.client.listContainers(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  pingContainer(req: PingContainerRequest, timeoutMs?: number): Promise<PingContainerResponse> {
    log.debug({ containerId: req.containerId, path: req.path, port: req.port }, "pingContainer");
    return callUnary(
      (r, m, opts, cb) => this.client.pingContainer(r, m, opts, cb),
      req,
      timeoutMs,
    );
  }

  // -------------------------------------------------------------------------
  // RPCs streaming (server-streaming → AsyncIterable)
  // -------------------------------------------------------------------------

  containerLogs(req: ContainerLogsRequest): AsyncIterable<LogLine> {
    log.debug({ containerId: req.containerId, follow: req.follow }, "containerLogs stream");
    return streamToAsyncIterable(this.client.containerLogs(req));
  }

  containerStats(req: ContainerStatsRequest): AsyncIterable<StatsFrame> {
    log.debug({ containerId: req.containerId }, "containerStats stream");
    return streamToAsyncIterable(this.client.containerStats(req));
  }

  imagePull(req: ImagePullRequest): AsyncIterable<PullProgress> {
    log.debug({ image: req.image }, "imagePull stream");
    return streamToAsyncIterable(this.client.imagePull(req));
  }

  imageBuild(req: ImageBuildRequest): AsyncIterable<BuildProgress> {
    log.debug({ tag: req.tag }, "imageBuild stream");
    return streamToAsyncIterable(this.client.imageBuild(req));
  }

  // -------------------------------------------------------------------------
  // RPC bidi-streaming — ContainerExec
  // -------------------------------------------------------------------------

  /**
   * Ouvre un stream bidi ContainerExec vers l'agent Rust.
   *
   * TODO: quand @ploydok/agent-proto sera régénéré avec ContainerExec,
   *       remplacer le cast `any` par le type généré et typer `stream`
   *       via `ClientDuplexStream<ExecFrame, ExecFrame>`.
   *
   * @returns { send, events, close }
   *   - send(frame)  : envoie un ExecFrame vers l'agent
   *   - events       : AsyncIterable<ExecFrame> des frames reçus
   *   - close()      : met fin au stream client-side (half-close)
   */
  containerExec(): {
    send(frame: ExecFrame): void
    events: AsyncIterable<ExecFrame>
    close(): void
  } {
    log.debug("containerExec: ouverture stream bidi")

    const stream: import("@grpc/grpc-js").ClientDuplexStream<ExecFrame, ExecFrame> =
      this.client.containerExec(new grpc.Metadata())

    const queue: Array<{ value?: ExecFrame; done: boolean; error?: unknown }> = []
    let resolveNext: (() => void) | null = null
    let finished = false

    stream.on("data", (frame: ExecFrame) => {
      queue.push({ value: frame, done: false })
      resolveNext?.()
      resolveNext = null
    })
    stream.on("end", () => {
      finished = true
      queue.push({ done: true })
      resolveNext?.()
      resolveNext = null
    })
    stream.on("error", (err: unknown) => {
      finished = true
      queue.push({ done: true, error: toAgentError(err) })
      resolveNext?.()
      resolveNext = null
    })

    const events: AsyncIterable<ExecFrame> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ExecFrame>> {
            while (queue.length === 0 && !finished) {
              await new Promise<void>((r) => {
                resolveNext = r
              })
            }
            const item = queue.shift()
            if (!item) return { done: true, value: undefined as unknown as ExecFrame }
            if (item.error) throw item.error
            if (item.done) return { done: true, value: undefined as unknown as ExecFrame }
            return { done: false, value: item.value as ExecFrame }
          },
          return(): Promise<IteratorResult<ExecFrame>> {
            stream.destroy()
            return Promise.resolve({ done: true, value: undefined as unknown as ExecFrame })
          },
        }
      },
    }

    return {
      send(frame: ExecFrame): void {
        stream.write(frame)
      },
      events,
      close(): void {
        stream.end()
      },
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Ferme le canal gRPC proprement.
   * À appeler lors du shutdown de l'application.
   */
  close(): void {
    this.client.close();
    log.debug("Agent fermé");
  }
}
