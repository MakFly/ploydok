// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as broadcastMod from "../../../lib/api/broadcast";

interface FakeListener {
  (e: { data: unknown }): void
}

class FakeBroadcastChannel {
  static instances: Array<FakeBroadcastChannel> = [];
  name: string;
  listeners: Array<FakeListener> = [];
  closed = false;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(_type: "message", fn: FakeListener): void {
    this.listeners.push(fn);
  }

  removeEventListener(_type: "message", fn: FakeListener): void {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }

  // The real BroadcastChannel does NOT deliver to the sender. Other instances
  // with the same name receive it.
  postMessage(data: unknown): void {
    if (this.closed) return;
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer === this || peer.closed || peer.name !== this.name) continue;
      for (const l of peer.listeners) l({ data });
    }
  }

  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  FakeBroadcastChannel.instances = [];

  (globalThis as any).window = globalThis;

  (globalThis as any).BroadcastChannel = FakeBroadcastChannel;
  broadcastMod.__resetChannelForTests();
});

afterEach(() => {
  broadcastMod.__resetChannelForTests();
   
  delete (globalThis as any).BroadcastChannel;
   
  delete (globalThis as any).window;
});

describe("broadcast — multi-tab auth events", () => {
  it("delivers token_refreshed to a peer tab", () => {
    let refreshedCount = 0;
    let loggedOutCount = 0;

    // Tab B subscribes
    const unsubscribe = broadcastMod.subscribeAuthEvents({
      onTokenRefreshed: () => refreshedCount++,
      onLoggedOut: () => loggedOutCount++,
    });

    // Tab A creates a separate channel and broadcasts
    const tabA = new FakeBroadcastChannel("ploydok-auth");
    tabA.postMessage({ type: "token_refreshed" });

    expect(refreshedCount).toBe(1);
    expect(loggedOutCount).toBe(0);

    unsubscribe();
  });

  it("delivers logged_out to a peer tab", () => {
    let refreshedCount = 0;
    let loggedOutCount = 0;

    broadcastMod.subscribeAuthEvents({
      onTokenRefreshed: () => refreshedCount++,
      onLoggedOut: () => loggedOutCount++,
    });

    const tabA = new FakeBroadcastChannel("ploydok-auth");
    tabA.postMessage({ type: "logged_out" });

    expect(loggedOutCount).toBe(1);
    expect(refreshedCount).toBe(0);
  });

  it("does not deliver an event to the sender itself", () => {
    let count = 0;
    broadcastMod.subscribeAuthEvents({
      onTokenRefreshed: () => count++,
      onLoggedOut: () => count++,
    });

    // Sender == this tab
    broadcastMod.broadcastAuthEvent({ type: "token_refreshed" });

    expect(count).toBe(0);
  });

  it("ignores malformed messages", () => {
    let count = 0;
    broadcastMod.subscribeAuthEvents({
      onTokenRefreshed: () => count++,
      onLoggedOut: () => count++,
    });

    const tabA = new FakeBroadcastChannel("ploydok-auth");
    tabA.postMessage(null);
    tabA.postMessage({ type: "unknown_event" });
    tabA.postMessage("not an object");

    expect(count).toBe(0);
  });

  it("cleanup function unsubscribes the listener", () => {
    let count = 0;
    const unsubscribe = broadcastMod.subscribeAuthEvents({
      onTokenRefreshed: () => count++,
      onLoggedOut: () => count++,
    });

    unsubscribe();

    const tabA = new FakeBroadcastChannel("ploydok-auth");
    tabA.postMessage({ type: "token_refreshed" });

    expect(count).toBe(0);
  });
});
