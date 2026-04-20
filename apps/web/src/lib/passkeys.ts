// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { ApiError } from "./api";
import type { PasskeyInfo } from "@ploydok/shared";

interface PasskeysResponse {
  passkeys: Array<PasskeyInfo>;
}

export function usePasskeys() {
  return useQuery<Array<PasskeyInfo>, ApiError>({
    queryKey: ["passkeys"],
    queryFn: async () => {
      const data = await apiFetch<PasskeysResponse>("/auth/passkeys");
      return data.passkeys;
    },
  });
}

export function useRemovePasskey() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/auth/passkeys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passkeys"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
