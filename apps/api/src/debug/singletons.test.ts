// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "bun:test"
import { createAgent } from "./singletons"

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

describe("createAgent mTLS policy", () => {
  afterEach(() => {
    restoreEnv()
  })

  it("fails closed in production when TCP agent mTLS files are incomplete", () => {
    process.env["NODE_ENV"] = "production"
    process.env["PLOYDOK_AGENT_ADDR"] = "agent:50051"
    delete process.env["PLOYDOK_AGENT_CA"]
    delete process.env["PLOYDOK_AGENT_CLIENT_CERT"]
    delete process.env["PLOYDOK_AGENT_CLIENT_KEY"]

    expect(() => createAgent()).toThrow("PLOYDOK_AGENT_ADDR uses TCP")
  })

  it("keeps insecure TCP fallback available in development", () => {
    process.env["NODE_ENV"] = "development"
    process.env["PLOYDOK_AGENT_ADDR"] = "agent:50051"
    process.env["PLOYDOK_AGENT_INSECURE"] = "1"
    delete process.env["PLOYDOK_AGENT_CA"]
    delete process.env["PLOYDOK_AGENT_CLIENT_CERT"]
    delete process.env["PLOYDOK_AGENT_CLIENT_KEY"]

    const agent = createAgent()
    expect(agent).toBeTruthy()
    agent.close()
  })
})
