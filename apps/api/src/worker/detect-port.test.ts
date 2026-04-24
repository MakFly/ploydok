// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { detectDockerfilePortFromString } from "./detect-port";

describe("detectDockerfilePortFromString", () => {
  it("returns the first numeric port", () => {
    expect(detectDockerfilePortFromString("FROM x\nEXPOSE 8080\n")).toBe(8080);
  });

  it("handles /tcp suffix", () => {
    expect(detectDockerfilePortFromString("EXPOSE 80/tcp")).toBe(80);
  });

  it("handles /udp suffix", () => {
    expect(detectDockerfilePortFromString("EXPOSE 5353/udp")).toBe(5353);
  });

  it("picks first of multiple ports on one line", () => {
    expect(detectDockerfilePortFromString("EXPOSE 80 443")).toBe(80);
  });

  it("skips variable interpolation", () => {
    expect(
      detectDockerfilePortFromString("FROM x\nEXPOSE ${PORT}\nEXPOSE 3000\n"),
    ).toBe(3000);
  });

  it("is case-insensitive on EXPOSE keyword", () => {
    expect(detectDockerfilePortFromString("expose 9000")).toBe(9000);
  });

  it("returns null when no EXPOSE line is present", () => {
    expect(
      detectDockerfilePortFromString("FROM alpine\nRUN echo hi\nCMD ['sh']\n"),
    ).toBe(null);
  });

  it("ignores comments", () => {
    expect(
      detectDockerfilePortFromString("# EXPOSE 1234 — old\nEXPOSE 9000"),
    ).toBe(9000);
  });

  it("rejects out-of-range ports", () => {
    expect(detectDockerfilePortFromString("EXPOSE 70000")).toBe(null);
    expect(detectDockerfilePortFromString("EXPOSE 0")).toBe(null);
  });
});
