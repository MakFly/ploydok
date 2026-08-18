// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "bun:test"
import { ContainerCreateRequest, protobufPackage } from "./index"

describe("agent proto exports", () => {
  it("exposes generated package metadata and message codecs", () => {
    expect(protobufPackage).toBe("ploydok.agent.v1")
    expect(ContainerCreateRequest.encode).toBeFunction()
    expect(ContainerCreateRequest.decode).toBeFunction()
  })
})
