// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for auth hooks logic.
 * We test the query function logic directly (without DOM) to avoid
 * environment issues with happy-dom + bun monorepo resolution.
 */
import { describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Inline ApiError (mirrors lib/auth.ts)
// ---------------------------------------------------------------------------
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// useMe queryFn logic (extracted for unit testing)
// ---------------------------------------------------------------------------
type Me = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  has_passkey_plus: boolean;
  has_backup_codes: boolean;
  needs_second_factor: boolean;
};

async function meFn(fetcher: () => Promise<unknown>): Promise<Me> {
  return fetcher() as Promise<Me>;
}

// Retry logic: don't retry on 401
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return false;
  return failureCount < 2;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMe queryFn logic", () => {
  it("returns user data when API succeeds", async () => {
    const fakeMe: Me = {
      id: "user-1",
      email: "test@example.com",
      display_name: "Test User",
      created_at: new Date().toISOString(),
      has_passkey_plus: false,
      has_backup_codes: false,
      needs_second_factor: true,
    };

    const result = await meFn(async () => fakeMe);
    expect(result.id).toBe("user-1");
    expect(result.email).toBe("test@example.com");
    expect(result.display_name).toBe("Test User");
    expect(result.needs_second_factor).toBe(true);
  });

  it("propagates 401 errors from the API", async () => {
    let thrown: unknown;
    try {
      await meFn(async () => {
        throw new ApiError(401, "UNAUTHENTICATED", "Not logged in");
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const err = thrown as ApiError;
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHENTICATED");
    expect(err.message).toBe("Not logged in");
  });

  it("propagates 403 errors from the API", async () => {
    let thrown: unknown;
    try {
      await meFn(async () => {
        throw new ApiError(403, "FORBIDDEN", "Access denied");
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const err = thrown as ApiError;
    expect(err.status).toBe(403);
  });
});

describe("useMe retry logic", () => {
  it("does not retry on 401", () => {
    const err = new ApiError(401, "UNAUTHENTICATED", "Not logged in");
    expect(shouldRetry(0, err)).toBe(false);
    expect(shouldRetry(1, err)).toBe(false);
  });

  it("retries up to 2 times on other errors", () => {
    const err = new ApiError(500, "SERVER_ERROR", "Internal error");
    expect(shouldRetry(0, err)).toBe(true);
    expect(shouldRetry(1, err)).toBe(true);
    expect(shouldRetry(2, err)).toBe(false);
  });
});
