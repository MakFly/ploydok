// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  getRestartProgress,
  getRestartStageLabel,
} from "../../../components/databases/RestartDatabaseDialog"

describe("RestartDatabaseDialog progress model", () => {
  it("starts with a visible non-zero progress value", () => {
    expect(getRestartProgress(0)).toBe(8)
  })

  it("caps pending progress below completion", () => {
    expect(getRestartProgress(999_999)).toBe(94)
  })

  it("moves through the expected restart stages", () => {
    expect(getRestartStageLabel(0)).toBe("Stop current runtime")
    expect(getRestartStageLabel(2_000)).toBe("Provision fresh container")
    expect(getRestartStageLabel(6_000)).toBe("Run health probes")
    expect(getRestartStageLabel(20_000)).toBe("Reattach network path")
  })
})
