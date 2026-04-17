// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test";
import { LogBus } from "./log-bus";

// ---------------------------------------------------------------------------
// Each test gets a fresh isolated LogBus instance.
// ---------------------------------------------------------------------------

let bus: LogBus;
beforeEach(() => {
  bus = new LogBus();
});

// ---------------------------------------------------------------------------
// publish + subscribe
// ---------------------------------------------------------------------------

describe("publish + subscribe", () => {
  it("delivers a published entry to an active subscriber", () => {
    const received: string[] = [];
    bus.subscribe("build:abc", (e) => received.push(e.line));
    bus.publish("build:abc", "hello");
    expect(received).toEqual(["hello"]);
  });

  it("delivers to multiple subscribers on the same channel", () => {
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe("build:x", (e) => a.push(e.line));
    bus.subscribe("build:x", (e) => b.push(e.line));
    bus.publish("build:x", "line1");
    expect(a).toEqual(["line1"]);
    expect(b).toEqual(["line1"]);
  });

  it("does not deliver to subscribers on different channels", () => {
    const received: string[] = [];
    bus.subscribe("runtime:other", (e) => received.push(e.line));
    bus.publish("build:abc", "not-for-you");
    expect(received).toHaveLength(0);
  });

  it("accepts custom timestamp via meta.t", () => {
    const entries: number[] = [];
    bus.subscribe("build:ts", (e) => entries.push(e.t));
    bus.publish("build:ts", "x", { t: 12345 });
    expect(entries).toEqual([12345]);
  });

  it("subscriber errors do not crash the bus", () => {
    bus.subscribe("build:err", () => {
      throw new Error("boom");
    });
    const safe: string[] = [];
    bus.subscribe("build:err", (e) => safe.push(e.line));
    bus.publish("build:err", "after-throw");
    expect(safe).toEqual(["after-throw"]);
  });
});

// ---------------------------------------------------------------------------
// unsubscribe
// ---------------------------------------------------------------------------

describe("unsubscribe", () => {
  it("stops delivering after unsubscribe", () => {
    const received: string[] = [];
    const unsub = bus.subscribe("build:unsub", (e) => received.push(e.line));
    bus.publish("build:unsub", "before");
    unsub();
    bus.publish("build:unsub", "after");
    expect(received).toEqual(["before"]);
  });

  it("unsubscribing twice is safe (no-op)", () => {
    const unsub = bus.subscribe("ch", () => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it("subscriberCount decreases after unsubscribe", () => {
    const unsub = bus.subscribe("ch", () => {});
    expect(bus.subscriberCount).toBe(1);
    unsub();
    expect(bus.subscriberCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

describe("replay", () => {
  it("returns empty array when channel has no history", () => {
    expect(bus.replay("build:unknown")).toEqual([]);
  });

  it("replays all entries when under the limit", () => {
    bus.publish("build:r", "line-1");
    bus.publish("build:r", "line-2");
    bus.publish("build:r", "line-3");
    const entries = bus.replay("build:r");
    expect(entries.map((e) => e.line)).toEqual(["line-1", "line-2", "line-3"]);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) bus.publish("build:lim", `line-${i}`);
    const entries = bus.replay("build:lim", 3);
    expect(entries).toHaveLength(3);
    // Should be the LAST 3 entries (most recent).
    expect(entries.map((e) => e.line)).toEqual(["line-7", "line-8", "line-9"]);
  });

  it("replay returns entries in chronological order", () => {
    bus.publish("build:ord", "a", { t: 100 });
    bus.publish("build:ord", "b", { t: 200 });
    bus.publish("build:ord", "c", { t: 300 });
    const ts = bus.replay("build:ord").map((e) => e.t);
    expect(ts).toEqual([100, 200, 300]);
  });

  it("replay is available even when there are no live subscribers", () => {
    bus.publish("build:nosub", "stored");
    expect(bus.replay("build:nosub").map((e) => e.line)).toEqual(["stored"]);
  });
});

// ---------------------------------------------------------------------------
// Ring-buffer overflow (capacity 2000)
// ---------------------------------------------------------------------------

describe("ring-buffer overflow", () => {
  it("keeps the most recent 2000 entries when more are published", () => {
    for (let i = 0; i < 2500; i++) bus.publish("build:big", `line-${i}`);
    const entries = bus.replay("build:big", 2000);
    expect(entries).toHaveLength(2000);
    // Oldest kept entry should be line-500.
    expect(entries[0]!.line).toBe("line-500");
    // Newest entry should be line-2499.
    expect(entries[entries.length - 1]!.line).toBe("line-2499");
  });
});

// ---------------------------------------------------------------------------
// evict
// ---------------------------------------------------------------------------

describe("evict", () => {
  it("clears stored entries after evict", () => {
    bus.publish("build:ev", "line");
    bus.evict("build:ev");
    expect(bus.replay("build:ev")).toEqual([]);
  });

  it("evict does not affect existing subscribers (they still receive new publishes)", () => {
    const received: string[] = [];
    bus.subscribe("build:ev2", (e) => received.push(e.line));
    bus.publish("build:ev2", "before");
    bus.evict("build:ev2");
    bus.publish("build:ev2", "after");
    // Both received — subscriber was not removed by evict.
    expect(received).toEqual(["before", "after"]);
    // But replay only shows "after" because ring was evicted.
    expect(bus.replay("build:ev2").map((e) => e.line)).toEqual(["after"]);
  });
});

// ---------------------------------------------------------------------------
// Channel naming conventions
// ---------------------------------------------------------------------------

describe("channel naming", () => {
  it("build and runtime channels are independent", () => {
    bus.publish("build:id1", "build-line");
    bus.publish("runtime:id1", "runtime-line");
    expect(bus.replay("build:id1").map((e) => e.line)).toEqual(["build-line"]);
    expect(bus.replay("runtime:id1").map((e) => e.line)).toEqual(["runtime-line"]);
  });
});
