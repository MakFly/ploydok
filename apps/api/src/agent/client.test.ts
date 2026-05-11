// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "bun:test"
import * as grpc from "@grpc/grpc-js"
import { createAgentClient } from "./client"

const ORIGINAL_ENV = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value
  }
}

describe("createAgentClient mTLS policy", () => {
  afterEach(() => {
    restoreEnv()
  })

  it("fails closed for TCP agent addresses in production without credentials", () => {
    process.env["NODE_ENV"] = "production"

    expect(() => createAgentClient({ address: "agent:50051" })).toThrow(
      "requires mTLS credentials",
    )
  })

  it("allows production TCP when credentials are supplied", () => {
    process.env["NODE_ENV"] = "production"

    const client = createAgentClient({
      address: "agent:50051",
      credentials: grpc.credentials.createSsl(),
    })
    expect(client).toBeTruthy()
    client.close()
  })

  it("keeps insecure TCP fallback available in development", () => {
    process.env["NODE_ENV"] = "development"
    process.env["PLOYDOK_AGENT_INSECURE"] = "1"

    const client = createAgentClient({ address: "agent:50051" })
    expect(client).toBeTruthy()
    client.close()
  })
})
