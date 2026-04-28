// SPDX-License-Identifier: AGPL-3.0-only
//
// Exec session audit (Sprint 6.5-ter — chiffrement des flux terminal).
//
// Buffer les bytes stdin/stdout/stderr reçus sur la WS terminal et flush ligne
// par ligne (séparateurs CR/LF). Chaque ligne est chiffrée AES-256-GCM via la
// même primitive `encryptField` que les secrets (clé MASTER_KEY) puis insérée
// dans `audit_log`.
//
// Garde-fous :
//  - taille max d'une ligne : 4 KB (drop silencieux au-delà — évite OOM si
//    l'utilisateur cat un binaire ou colle une grosse string).
//  - taille max du buffer en attente : 16 KB (reset si dépassé — protection DoS).
//  - chaque INSERT est best-effort (try/catch) : une erreur DB ne bloque jamais
//    le stream terminal.

import type { Db } from "@ploydok/db"
import { audit_log } from "@ploydok/db"
import { encryptSecret } from "../secrets/crypto"
import { childLogger } from "../logger"

const log = childLogger("exec.audit")

const MAX_LINE_BYTES = 4 * 1024
const MAX_BUFFER_BYTES = 16 * 1024
const LINE_SEPARATORS = new Set([0x0a, 0x0d]) // \n \r

export interface ExecAuditContext {
  userId: string
  appId: string
  containerId: string
  sessionId: string
}

export interface ExecAuditOptions {
  action?: "app.exec.command" | "app.exec.output"
  stream?: "stdin" | "stdout" | "stderr"
}

export class ExecCommandAuditor {
  private buf: number[] = []
  private dropped = 0

  constructor(
    private readonly db: Db,
    private readonly ctx: ExecAuditContext,
    private readonly opts: ExecAuditOptions = {}
  ) {}

  /**
   * Feed un chunk de bytes terminal. Flush immédiat de chaque ligne complète.
   * Best-effort : ne throw jamais, log warn si chiffrement/insert échoue.
   */
  feed(chunk: Uint8Array): void {
    for (const b of chunk) {
      if (LINE_SEPARATORS.has(b)) {
        if (this.buf.length > 0) void this.flushLine()
        continue
      }
      if (this.buf.length >= MAX_LINE_BYTES) {
        // Ligne trop longue — drop silencieux jusqu'au prochain séparateur.
        this.dropped++
        continue
      }
      this.buf.push(b)
    }
    // Protection DoS : si buffer accumule sans jamais voir un \n.
    if (this.buf.length > MAX_BUFFER_BYTES) {
      log.warn(
        { userId: this.ctx.userId, appId: this.ctx.appId },
        "exec.audit.buffer_overflow_reset"
      )
      this.buf = []
      this.dropped++
    }
  }

  /**
   * Flush forcé du buffer courant (à appeler à closeSession pour ne pas perdre
   * un dernier `cmd` sans newline).
   */
  async flushFinal(): Promise<void> {
    if (this.buf.length > 0) {
      await this.flushLine()
    }
    if (this.dropped > 0) {
      log.info(
        {
          userId: this.ctx.userId,
          appId: this.ctx.appId,
          dropped: this.dropped,
        },
        "exec.audit.lines_dropped"
      )
    }
  }

  private async flushLine(): Promise<void> {
    const line = Buffer.from(this.buf).toString("utf8")
    this.buf = []
    try {
      const { enc, nonce } = await encryptSecret(line)
      const action = this.opts.action ?? "app.exec.command"
      const stream = this.opts.stream ?? "stdin"
      await this.db.insert(audit_log).values({
        user_id: this.ctx.userId,
        action,
        target_type: "app",
        target_id: this.ctx.appId,
        metadata: JSON.stringify({
          container_id: this.ctx.containerId,
          session_id: this.ctx.sessionId,
          stream,
          enc: enc.toString("base64"),
          nonce: nonce.toString("base64"),
          alg: "aes-256-gcm",
        }),
        created_at: new Date(),
      })
    } catch (err) {
      log.warn(
        {
          userId: this.ctx.userId,
          appId: this.ctx.appId,
          err: (err as Error).message,
        },
        "exec.audit.flush_failed"
      )
    }
  }
}
