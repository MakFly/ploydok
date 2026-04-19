// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { apiFetch } from "./api";
import type { ApiError } from "./api";
import type { PasskeyInfo } from "@ploydok/shared";
import { toast } from "sonner";

interface PasskeysResponse {
  passkeys: Array<PasskeyInfo>;
}

interface AddPasskeyRegOptions {
  options: unknown;
  userId: string;
  device_name?: string;
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
  return useMutation<void, ApiError, { deviceName?: string }>({
    mutationFn: async ({ deviceName }) => {
      // 1. Get registration options
      const { options, userId } = await apiFetch<AddPasskeyRegOptions>(
        "/auth/passkeys",
        {
          method: "POST",
          body: { device_name: deviceName },
        },
      );

      // 2. Invoke browser WebAuthn
      const credential = await startRegistration({
        optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"],
      });

      // 3. Verify registration
      await apiFetch("/auth/register/verify", {
        method: "POST",
        body: { userId, credential, device_name: deviceName },
      });
    },
    onSuccess: () => {
      toast.success("Passkey added");
      qc.invalidateQueries({ queryKey: ["passkeys"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => {
      toast.error(error.message);
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
