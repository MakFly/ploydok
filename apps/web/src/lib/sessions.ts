// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { ApiError } from "./api";
import type { SessionInfo } from "@ploydok/shared";

interface SessionsResponse {
  sessions: Array<SessionInfo>;
}

export function useSessions() {
  return useQuery<Array<SessionInfo>, ApiError>({
    queryKey: ["sessions"],
    queryFn: async () => {
      const data = await apiFetch<SessionsResponse>("/auth/sessions");
      return data.sessions;
    },
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useRevokeOthers() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiFetch<void>("/auth/sessions/revoke-others", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
