// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { Db } from "@ploydok/db";

const fakeUser = {
  id: "user-1",
  email: "test@example.com",
  display_name: "Test User",
  session_id: "session-1",
};

let createCalls = 0;
let createOrganizationImpl: (
  db: Db,
  userId: string,
  name: string,
  displayName?: string | null,
) => Promise<Record<string, unknown>> = async () => ({
  id: "org-2",
  name: "Acme",
  slug: "acme",
  is_default: false,
  created_at: new Date().toISOString(),
});

mock.module("../organizations", () => ({
  createOrganizationForUser: async (
    db: Db,
    userId: string,
    name: string,
    displayName?: string | null,
  ) => {
    createCalls += 1;
    return createOrganizationImpl(db, userId, name, displayName);
  },
  listOrganizationsForUser: async () => [],
  getDefaultOrganizationForUser: async () => ({
    id: "org-1",
    name: "Test User",
    slug: "test-user",
    is_default: true,
    created_at: new Date().toISOString(),
  }),
  getOrganizationBySlugForUser: async () => null,
}));

function buildApp(router: Hono) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).set("user", fakeUser);
    await next();
  });
  app.route("/organizations", router);
  return app;
}

describe("POST /organizations", () => {
  it("returns 400 on invalid payload", async () => {
    createCalls = 0;
    const { createOrganizationsRouter } = await import("./organizations");
    const app = buildApp(createOrganizationsRouter({} as Db));

    const res = await app.request("/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });

    expect(res.status).toBe(400);
    expect(createCalls).toBe(0);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates a workspace and returns 201", async () => {
    createCalls = 0;
    createOrganizationImpl = async (_db, userId, name, displayName) => ({
      id: "org-2",
      name,
      slug: "acme",
      is_default: false,
      created_at: new Date().toISOString(),
      _userId: userId,
      _displayName: displayName,
    });

    const { createOrganizationsRouter } = await import("./organizations");
    const app = buildApp(createOrganizationsRouter({} as Db));

    const res = await app.request("/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme" }),
    });

    expect(res.status).toBe(201);
    expect(createCalls).toBe(1);
    const data = await res.json() as {
      organization: {
        name: string;
        slug: string;
        is_default: boolean;
        _userId: string;
        _displayName: string | null | undefined;
      };
    };
    expect(data.organization.name).toBe("Acme");
    expect(data.organization.slug).toBe("acme");
    expect(data.organization.is_default).toBe(false);
    expect(data.organization._userId).toBe(fakeUser.id);
    expect(data.organization._displayName).toBe(fakeUser.display_name);
  });
});
