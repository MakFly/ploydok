// SPDX-License-Identifier: AGPL-3.0-only
import {
  
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { ApiError, apiFetch } from "./api";
import type {UseQueryResult} from "@tanstack/react-query";
import type { Me } from "@ploydok/shared";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// useMe
// ---------------------------------------------------------------------------

export function useMe(): UseQueryResult<Me, ApiError> {
  return useQuery<Me, ApiError>({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/me"),
    // Dédup : une seule fetch partagée entre tous les composants, refetch
    // après 1 min d'inactivité seulement.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
      toast.success("Signed in");
      qc.setQueryData(["me"], data);
    },
    onError: (error) => {
      toast.error(error.message);
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
      toast.success("Account created");
      qc.setQueryData(["me"], data);
    },
    onError: (error) => {
      toast.error(error.message);
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
      toast.success("Signed out");
      qc.setQueryData(["me"], null);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}
