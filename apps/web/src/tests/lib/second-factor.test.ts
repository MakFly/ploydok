// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "bun:test"
import {
  apiFetch,
  invalidateGetCache,
  resetCsrfToken,
} from "../../lib/api/client"
import {
  ApiError,
  SecondFactorRequiredError,
} from "../../lib/api/errors"

const BASE = "http://localhost:3335"

interface Call {
  url: string
  init?: RequestInit
}

let calls: Array<Call> = []
let queue: Map<string, Array<{ status: number; body: unknown }>>

function enqueue(
  url: string,
  responses: Array<{ status: number; body: unknown }>,
): void {
  queue.set(url, responses)
}

function setup(): void {
  calls = []
  queue = new Map()
  resetCsrfToken()
  invalidateGetCache()
  ;(globalThis as { window?: unknown }).window = {}
  ;(global as unknown as { fetch: unknown }).fetch = (
    input: string | URL | Request,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString()
    calls.push({ url })
    const list = queue.get(url) ?? []
    const resp = list.shift() ?? { status: 200, body: {} }
    if (url === `${BASE}/auth/csrf`) {
      return Promise.resolve(
        new Response(JSON.stringify({ token: "t" }), { status: 200 }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(resp.body), { status: resp.status }),
    )
  }
}

describe("SecondFactorRequiredError — classe", () => {
  it("hérite d'ApiError avec status 403 et code canonique", () => {
    const err = new SecondFactorRequiredError()
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toBeInstanceOf(SecondFactorRequiredError)
    expect(err.status).toBe(403)
    expect(err.code).toBe("SECOND_FACTOR_REQUIRED")
    expect(err.name).toBe("SecondFactorRequiredError")
  })

  it("porte un message par défaut en français et supporte l'override", () => {
    expect(new SecondFactorRequiredError().message).toContain("second facteur")
    expect(new SecondFactorRequiredError("custom").message).toBe("custom")
  })
})

describe("apiFetch — mapping 403 SECOND_FACTOR_REQUIRED", () => {
  beforeEach(setup)

  it("throw SecondFactorRequiredError quand le serveur renvoie ce code", async () => {
    enqueue(`${BASE}/apps/abc/deploy`, [
      {
        status: 403,
        body: {
          error: {
            code: "SECOND_FACTOR_REQUIRED",
            message: "A second factor is required",
          },
        },
      },
    ])

    try {
      await apiFetch(`/apps/abc/deploy`, { method: "POST" })
      expect.unreachable("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(SecondFactorRequiredError)
      expect((err as SecondFactorRequiredError).status).toBe(403)
      expect((err as SecondFactorRequiredError).code).toBe("SECOND_FACTOR_REQUIRED")
    }
  })

  it("throw ApiError générique pour un 403 sans le code spécial", async () => {
    enqueue(`${BASE}/apps/abc/deploy`, [
      {
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "nope" } },
      },
    ])

    try {
      await apiFetch(`/apps/abc/deploy`, { method: "POST" })
      expect.unreachable("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect(err).not.toBeInstanceOf(SecondFactorRequiredError)
      expect((err as ApiError).code).toBe("FORBIDDEN")
    }
  })
})
