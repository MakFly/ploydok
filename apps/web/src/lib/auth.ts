// SPDX-License-Identifier: AGPL-3.0-only
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch, ApiError } from "./api";
import type { Me } from "@ploydok/shared";

// ---------------------------------------------------------------------------
// useMe
// ---------------------------------------------------------------------------

export function useMe(): UseQueryResult<Me, ApiError> {
  return useQuery<Me, ApiError>({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/me"),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
  });
}

// ---------------------------------------------------------------------------
// useLogin — passkey sign-in
// ---------------------------------------------------------------------------

interface LoginPayload {
  credential: unknown;
  _challengeKey: string;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<Me, ApiError, LoginPayload>({
    mutationFn: (payload) =>
      apiFetch<Me>("/auth/login/verify", { method: "POST", body: payload }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
    },
  });
}

// ---------------------------------------------------------------------------
// useRegister — passkey registration verify
// ---------------------------------------------------------------------------

interface RegisterPayload {
  userId: string;
  credential: unknown;
  device_name?: string;
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation<Me, ApiError, RegisterPayload>({
    mutationFn: (payload) =>
      apiFetch<Me>("/auth/register/verify", { method: "POST", body: payload }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
    },
  });
}

// ---------------------------------------------------------------------------
// useLogout
// ---------------------------------------------------------------------------

export function useLogout() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => apiFetch<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.setQueryData(["me"], null);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
