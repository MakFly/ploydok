// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as scheduler from "../../../lib/api/scheduler";

interface DocumentLike {
  visibilityState: "visible" | "hidden"
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener: (type: string, fn: () => void) => void
  __dispatchVisibility?: () => void
}

let fakeDoc: DocumentLike;
let visListener: (() => void) | null;

beforeEach(() => {
  visListener = null;
  fakeDoc = {
    visibilityState: "visible",
    addEventListener: (type, fn) => {
      if (type === "visibilitychange") visListener = fn;
    },
    removeEventListener: (type, fn) => {
      if (type === "visibilitychange" && visListener === fn) visListener = null;
    },
    __dispatchVisibility: () => {
      if (visListener) visListener();
    },
  };

  (globalThis as any).window = globalThis;

  (globalThis as any).document = fakeDoc;
});

afterEach(() => {
   
  delete (globalThis as any).window;
   
  delete (globalThis as any).document;
});

describe("scheduler — proactive refresh", () => {
  it("triggers a refresh when the access token is already past leeway", async () => {
    let refreshCount = 0;
    const handle = scheduler.startProactiveRefresh({
      // expiry is now + 30s, leeway is 60s → delay would be -30s → fire immediately
      getAccessExpiry: () => 100,
      now: () => 70,
      triggerRefresh: async () => {
        refreshCount++;
        return { ok: true };
      },
    });

    // Wait one microtask flush so the synchronous fire() resolves
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(refreshCount).toBe(1);
    handle.stop();
  });

  it("does not fire when the document is hidden", async () => {
    fakeDoc.visibilityState = "hidden";
    let refreshCount = 0;
    const handle = scheduler.startProactiveRefresh({
      getAccessExpiry: () => 100,
      now: () => 50,
      triggerRefresh: async () => {
        refreshCount++;
        return { ok: true };
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(refreshCount).toBe(0);
    handle.stop();
  });

  it("fires when the tab becomes visible again", async () => {
    fakeDoc.visibilityState = "hidden";
    let refreshCount = 0;
    const handle = scheduler.startProactiveRefresh({
      getAccessExpiry: () => 100,
      now: () => 70,
      triggerRefresh: async () => {
        refreshCount++;
        return { ok: true };
      },
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(refreshCount).toBe(0);

    // Simulate the user focusing the tab
    fakeDoc.visibilityState = "visible";
    fakeDoc.__dispatchVisibility?.();

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(refreshCount).toBe(1);
    handle.stop();
  });

  it("schedules a future fire when expiry is far away (no immediate refresh)", async () => {
    let refreshCount = 0;
    const handle = scheduler.startProactiveRefresh({
      // expiry far in the future → delay >> 0 → setTimeout but no immediate fire
      getAccessExpiry: () => 200,
      now: () => 0,
      triggerRefresh: async () => {
        refreshCount++;
        return { ok: true };
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(refreshCount).toBe(0);
    handle.stop();
  });

  it("reschedule clears the previous timer and re-evaluates", async () => {
    let currentExpiry = 200;
    let refreshCount = 0;
    const handle = scheduler.startProactiveRefresh({
      getAccessExpiry: () => currentExpiry,
      now: () => 0,
      triggerRefresh: async () => {
        refreshCount++;
        return { ok: true };
      },
    });

    // No immediate fire (timer scheduled far away)
    await new Promise((r) => setTimeout(r, 5));
    expect(refreshCount).toBe(0);

    // Now mark the token as expired and reschedule
    currentExpiry = 50;
    handle.reschedule();

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    expect(refreshCount).toBe(1);

    handle.stop();
  });

  it("stop() prevents further fires", async () => {
    let refreshCount = 0;
    const handle = scheduler.startProactiveRefresh({
      getAccessExpiry: () => 200,
      now: () => 0,
      triggerRefresh: async () => {
        refreshCount++;
        return { ok: true };
      },
    });

    handle.stop();

    // After stop, no listener should remain
    expect(visListener).toBeNull();

    // And calling reschedule on a stopped handle still works (timer set), but
    // we never trigger it because we cleanup right after.
    await new Promise((r) => setTimeout(r, 5));
    expect(refreshCount).toBe(0);
  });

  it("noop when window is undefined (SSR safety)", async () => {

    delete (globalThis as any).window;
    let refreshCount = 0;
    const handle = scheduler.startProactiveRefresh({
      getAccessExpiry: () => 0,
      now: () => 0,
      triggerRefresh: async () => {
        refreshCount++;
        return { ok: true };
      },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(refreshCount).toBe(0);
    handle.stop();
  });
});
