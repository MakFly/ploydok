// SPDX-License-Identifier: AGPL-3.0-only
import { startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { ApiError } from "./api";
import type { Me, PasskeyInfo } from "@ploydok/shared";

interface PasskeysResponse {
  passkeys: Array<PasskeyInfo>;
}

interface RegisterOptionsResponse {
  options: Parameters<typeof startRegistration>[0]["optionsJSON"];
  userId: string;
}

interface AddPasskeyInput {
  deviceName?: string;
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

export function useAddPasskey() {
  const qc = useQueryClient();
  return useMutation<Me, ApiError, AddPasskeyInput | void>({
    mutationFn: async (input) => {
      const { options, userId } = await apiFetch<RegisterOptionsResponse>(
        "/auth/register/options",
        { method: "POST" },
      );
      const credential = await startRegistration({ optionsJSON: options });
      return apiFetch<Me>("/auth/register/verify", {
        method: "POST",
        body: {
          userId,
          credential,
          device_name: input?.deviceName?.trim() || undefined,
        },
      });
    },
    onSuccess: (me) => {
      qc.setQueryData(["me"], me);
      qc.invalidateQueries({ queryKey: ["passkeys"] });
      qc.invalidateQueries({ queryKey: ["me"] });
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
