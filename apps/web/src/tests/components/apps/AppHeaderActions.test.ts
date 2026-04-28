// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  canStopRuntime,
  shouldUseDeployLabel,
} from "../../../components/apps/AppHeaderActions"

describe("AppHeaderActions runtime controls", () => {
  it("keeps the Stop action available for failed apps", () => {
    expect(shouldUseDeployLabel("failed")).toBe(true)
    expect(canStopRuntime("failed")).toBe(true)
  })

  it("hides Stop only when there is no runtime to kill", () => {
    expect(canStopRuntime("stopped")).toBe(false)
    expect(canStopRuntime("created")).toBe(false)
  })
})
