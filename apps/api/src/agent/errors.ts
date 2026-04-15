// SPDX-License-Identifier: AGPL-3.0-only
import { status as GrpcStatus, type ServiceError, type Metadata } from "@grpc/grpc-js";

/** Messages lisibles pour les codes gRPC les plus fréquents. */
const CODE_MESSAGES: Partial<Record<number, string>> = {
  [GrpcStatus.UNAVAILABLE]: "agent injoignable",
  [GrpcStatus.PERMISSION_DENIED]: "action refusée par allowlist",
  [GrpcStatus.NOT_FOUND]: "ressource introuvable",
  [GrpcStatus.ALREADY_EXISTS]: "la ressource existe déjà",
  [GrpcStatus.DEADLINE_EXCEEDED]: "délai d'attente dépassé",
  [GrpcStatus.RESOURCE_EXHAUSTED]: "ressources épuisées",
  [GrpcStatus.INTERNAL]: "erreur interne de l'agent",
  [GrpcStatus.UNAUTHENTICATED]: "authentification requise",
  [GrpcStatus.UNIMPLEMENTED]: "RPC non implémentée",
  [GrpcStatus.CANCELLED]: "appel annulé",
};

/**
 * Erreur typée wrappant un ServiceError gRPC.
 *
 * Usage :
 *   try { await agent.containerCreate(...) }
 *   catch (e) {
 *     if (e instanceof AgentError && e.code === status.PERMISSION_DENIED) { ... }
 *   }
 */
export class AgentError extends Error {
  readonly code: number;
  readonly details: string;
  readonly metadata: Metadata;

  constructor(cause: ServiceError) {
    const readable = CODE_MESSAGES[cause.code] ?? `code gRPC ${cause.code}`;
    super(`[agent] ${readable}${cause.details ? ` : ${cause.details}` : ""}`);
    this.name = "AgentError";
    this.code = cause.code;
    this.details = cause.details;
    this.metadata = cause.metadata;
    // Préserve la stack de l'erreur origine
    if (cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }

  /**
   * Vrai si l'erreur est potentiellement transitoire (retry possible).
   * DEADLINE_EXCEEDED est intentionnellement exclu : la deadline a expiré,
   * retenter sans nouvelle deadline n'a pas de sens.
   */
  get isTransient(): boolean {
    return this.code === GrpcStatus.UNAVAILABLE;
  }

  /** Vrai si l'erreur vient d'une règle de sécurité. */
  get isForbidden(): boolean {
    return this.code === GrpcStatus.PERMISSION_DENIED || this.code === GrpcStatus.UNAUTHENTICATED;
  }
}

/** Type guard : convertit n'importe quelle erreur en AgentError si c'est un ServiceError gRPC. */
export function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  const se = err as ServiceError;
  if (typeof se?.code === "number" && typeof se?.details === "string") {
    return new AgentError(se);
  }
  // Erreur non-gRPC : on la wrap quand même
  const fallback: ServiceError = Object.assign(new Error(String(err)) as Error & ServiceError, {
    code: GrpcStatus.INTERNAL,
    details: String(err),
    metadata: { getMap: () => ({}) } as unknown as Metadata,
  });
  return new AgentError(fallback);
}

export { GrpcStatus };
