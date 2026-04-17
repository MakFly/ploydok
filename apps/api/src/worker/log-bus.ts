// SPDX-License-Identifier: AGPL-3.0-only
//
// LogBus — in-memory pub/sub with per-channel ring-buffer replay.
//
// Channels:
//   build:{buildId}    — build stdout/stderr lines
//   runtime:{appId}    — container runtime stdout/stderr
//
// Usage:
//   import { logBus } from "./log-bus";
//   logBus.publish("build:abc123", "Step 1/5 : FROM node:22");
//   const unsub = logBus.subscribe("build:abc123", (entry) => ws.send(JSON.stringify(entry)));
//   const history = logBus.replay("build:abc123", 200);
//   unsub();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogEntry {
  /** Unix timestamp in milliseconds */
  t: number;
  /** The log line (may contain ANSI codes) */
  line: string;
}

type Subscriber = (entry: LogEntry) => void;

// ---------------------------------------------------------------------------
// RingBuffer — fixed-capacity FIFO, overwrites oldest entry when full.
// ---------------------------------------------------------------------------

class RingBuffer {
  private readonly buf: LogEntry[];
  private readonly cap: number;
  private head = 0; // index of next write slot
  private size = 0;

  constructor(capacity: number) {
    this.cap = capacity;
    this.buf = new Array<LogEntry>(capacity);
  }

  push(entry: LogEntry): void {
    this.buf[this.head] = entry;
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
  }

  /** Returns up to `limit` most recent entries in insertion order. */
  snapshot(limit: number): LogEntry[] {
    const count = Math.min(limit, this.size);
    const out: LogEntry[] = new Array(count);
    for (let i = 0; i < count; i++) {
      // Walk backwards from (head - 1), then re-order chronologically.
      const idx = ((this.head - count + i) + this.cap * 2) % this.cap;
      out[i] = this.buf[idx]!;
    }
    return out;
  }

  get length(): number {
    return this.size;
  }
}

// ---------------------------------------------------------------------------
// LogBus
// ---------------------------------------------------------------------------

const RING_CAPACITY = 2_000;

export class LogBus {
  private readonly rings = new Map<string, RingBuffer>();
  private readonly subs = new Map<string, Set<Subscriber>>();

  /**
   * Publish a log line to the given channel.
   * The entry is stored in the ring-buffer and forwarded to all live subscribers.
   */
  publish(channel: string, line: string, meta?: { t?: number }): void {
    const entry: LogEntry = {
      t: meta?.t ?? Date.now(),
      line,
    };

    // Store in ring-buffer (create if missing).
    let ring = this.rings.get(channel);
    if (!ring) {
      ring = new RingBuffer(RING_CAPACITY);
      this.rings.set(channel, ring);
    }
    ring.push(entry);

    // Notify all current subscribers.
    const set = this.subs.get(channel);
    if (set) {
      for (const cb of set) {
        try {
          cb(entry);
        } catch {
          // Individual subscriber errors must not crash the bus.
        }
      }
    }
  }

  /**
   * Subscribe to a channel.
   * Returns an unsubscribe function — always call it when done to avoid memory leaks.
   */
  subscribe(channel: string, cb: Subscriber): () => void {
    let set = this.subs.get(channel);
    if (!set) {
      set = new Set<Subscriber>();
      this.subs.set(channel, set);
    }
    set.add(cb);

    return () => {
      const s = this.subs.get(channel);
      if (s) {
        s.delete(cb);
        if (s.size === 0) this.subs.delete(channel);
      }
    };
  }

  /**
   * Replay the last `limit` entries for a channel.
   * Returns an empty array if no entries have been published on that channel yet.
   */
  replay(channel: string, limit = 1_000): LogEntry[] {
    const ring = this.rings.get(channel);
    if (!ring) return [];
    return ring.snapshot(limit);
  }

  /**
   * Drop the ring-buffer for a channel (e.g. after a build finishes and logs
   * have been persisted to disk).  Existing subscribers are NOT affected.
   */
  evict(channel: string): void {
    this.rings.delete(channel);
  }

  /** Number of active subscribers across all channels. */
  get subscriberCount(): number {
    let n = 0;
    for (const set of this.subs.values()) n += set.size;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const logBus = new LogBus();
