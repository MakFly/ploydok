// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from "@tanstack/react-router";
import { apiFetch } from "../lib/api";
import type { Me } from "@ploydok/shared";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    try {
      await apiFetch<Me>("/me");
      throw redirect({ to: "/dashboard" });
    } catch (err) {
      // If it's a redirect, re-throw it
      if (err && typeof err === "object" && "href" in err) throw err;
      // Otherwise redirect to login
      throw redirect({ to: "/login" });
    }
  },
  component: () => null,
});
