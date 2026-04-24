// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from "node:crypto";
import { describe, expect, it, mock } from "bun:test";
import { verifySignature, handleWebhook } from "./webhook";
import type { Db } from "@ploydok/db";
import type { WebhookDeps } from "./webhook";

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------

describe("verifySignature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ ref: "refs/heads/main", after: "abc123" });

  function makeSignature(b: string, s: string): string {
    return "sha256=" + createHmac("sha256", s).update(b).digest("hex");
  }

  it("returns true for a valid signature", () => {
    const sig = makeSignature(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it("returns false for a null signature", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
  });

  it("returns false for a signature without sha256= prefix", () => {
    const raw = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, raw, secret)).toBe(false);
  });

  it("returns false for a tampered body", () => {
    const sig = makeSignature(body, secret);
    expect(verifySignature(body + "x", sig, secret)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const sig = makeSignature(body, "wrong-secret");
    expect(verifySignature(body, sig, secret)).toBe(false);
  });

  it("returns false for a signature of different length", () => {
    // Truncated signature — should fail length check before timingSafeEqual
    expect(verifySignature(body, "sha256=abc", secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleWebhook — installation + installation_repositories
// Spies are injected via deps.queries — no mock.module pollution.
// ---------------------------------------------------------------------------

const db = {} as Db;

function makeDeps(): {
  enqueue: ReturnType<typeof mock>;
  upsertInstallation: ReturnType<typeof mock>;
  deleteInstallation: ReturnType<typeof mock>;
  upsertRepos: ReturnType<typeof mock>;
  deleteRepos: ReturnType<typeof mock>;
  deps: WebhookDeps;
} {
  const enqueue = mock(async () => {});
  const upsertInstallation = mock(async () => {});
  const deleteInstallation = mock(async () => {});
  const upsertRepos = mock(async () => {});
  const deleteRepos = mock(async () => {});

  const deps = {
    enqueue,
    queries: { upsertInstallation, deleteInstallation, upsertRepos, deleteRepos },
  } as unknown as WebhookDeps;

  return { enqueue, upsertInstallation, deleteInstallation, upsertRepos, deleteRepos, deps };
}

// Helper to extract call args from bun mock (calls typed as [] but populated at runtime).
function callArgs(fn: ReturnType<typeof mock>, callIdx: number): unknown[] {
  return (fn.mock.calls as unknown as unknown[][])[callIdx] ?? [];
}

const baseInstallation = {
  id: 42,
  account: {
    login: "acme",
    type: "Organization",
    avatar_url: "https://gh/avatar",
    html_url: "https://gh/acme",
  },
  repository_selection: "all",
  suspended_at: null,
  html_url: "https://github.com/apps/ploydok/installations/42",
};

describe("handleWebhook — installation.created", () => {
  it("upserts installation and enqueues sync", async () => {
    const { enqueue, upsertInstallation, deps } = makeDeps();
    const payload = { action: "created", installation: baseInstallation };
    await handleWebhook(db, "installation", payload, "del-1", undefined, deps);
    expect(upsertInstallation).toHaveBeenCalledTimes(1);
    const row = callArgs(upsertInstallation, 0)[1] as Record<string, unknown>;
    expect(row.id).toBe("github:42");
    expect(row.provider).toBe("github");
    expect(row.suspended_at).toBeNull();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("handleWebhook — installation.deleted", () => {
  it("deletes installation by composite id", async () => {
    const { enqueue, deleteInstallation, deps } = makeDeps();
    const payload = { action: "deleted", installation: baseInstallation };
    await handleWebhook(db, "installation", payload, "del-2", undefined, deps);
    expect(deleteInstallation).toHaveBeenCalledTimes(1);
    expect(callArgs(deleteInstallation, 0)[1]).toBe("github:42");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("handleWebhook — installation.suspend", () => {
  it("upserts installation with suspended_at set", async () => {
    const { upsertInstallation, deps } = makeDeps();
    const payload = {
      action: "suspend",
      installation: { ...baseInstallation, suspended_at: "2025-01-01T00:00:00Z" },
    };
    await handleWebhook(db, "installation", payload, "del-3", undefined, deps);
    expect(upsertInstallation).toHaveBeenCalledTimes(1);
    const row = callArgs(upsertInstallation, 0)[1] as Record<string, unknown>;
    expect(row.suspended_at).toBeInstanceOf(Date);
  });
});

describe("handleWebhook — installation.unsuspend", () => {
  it("upserts installation with suspended_at null", async () => {
    const { upsertInstallation, deps } = makeDeps();
    const payload = {
      action: "unsuspend",
      installation: { ...baseInstallation, suspended_at: "2025-01-01T00:00:00Z" },
    };
    await handleWebhook(db, "installation", payload, "del-4", undefined, deps);
    expect(upsertInstallation).toHaveBeenCalledTimes(1);
    const row = callArgs(upsertInstallation, 0)[1] as Record<string, unknown>;
    expect(row.suspended_at).toBeNull();
  });
});

describe("handleWebhook — installation unknown action", () => {
  it("is a no-op and does not throw", async () => {
    const { enqueue, upsertInstallation, deps } = makeDeps();
    const payload = { action: "new_permissions_accepted", installation: baseInstallation };
    await expect(
      handleWebhook(db, "installation", payload, "del-5", undefined, deps),
    ).resolves.toBeUndefined();
    expect(upsertInstallation).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("handleWebhook — installation_repositories.added", () => {
  it("upserts repos and enqueues sync", async () => {
    const { enqueue, upsertRepos, deps } = makeDeps();
    const payload = {
      action: "added",
      installation: baseInstallation,
      repositories_added: [
        { id: 101, name: "my-repo", full_name: "acme/my-repo", private: false },
      ],
      repositories_removed: [],
    };
    await handleWebhook(db, "installation_repositories", payload, "del-6", undefined, deps);
    expect(upsertRepos).toHaveBeenCalledTimes(1);
    const repos = callArgs(upsertRepos, 0)[1] as Array<Record<string, unknown>>;
    expect(repos).toHaveLength(1);
    expect(repos[0]?.id).toBe("github:101");
    expect(repos[0]?.installation_id).toBe("github:42");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("handleWebhook — installation_repositories.removed", () => {
  it("deletes repos by composite ids", async () => {
    const { enqueue, deleteRepos, deps } = makeDeps();
    const payload = {
      action: "removed",
      installation: baseInstallation,
      repositories_added: [],
      repositories_removed: [
        { id: 101, name: "my-repo", full_name: "acme/my-repo", private: false },
        { id: 202, name: "other", full_name: "acme/other", private: true },
      ],
    };
    await handleWebhook(db, "installation_repositories", payload, "del-7", undefined, deps);
    expect(deleteRepos).toHaveBeenCalledTimes(1);
    const ids = callArgs(deleteRepos, 0)[1] as string[];
    expect(ids).toEqual(["github:101", "github:202"]);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("handleWebhook — installation_repositories unknown action", () => {
  it("is a no-op and does not throw", async () => {
    const { upsertRepos, deleteRepos, deps } = makeDeps();
    const payload = {
      action: "future_action",
      installation: baseInstallation,
    };
    await expect(
      handleWebhook(db, "installation_repositories", payload, "del-8", undefined, deps),
    ).resolves.toBeUndefined();
    expect(upsertRepos).not.toHaveBeenCalled();
    expect(deleteRepos).not.toHaveBeenCalled();
  });
});
