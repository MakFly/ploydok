// SPDX-License-Identifier: AGPL-3.0-only
import { toast } from "sonner"
import { SecondFactorRequiredError } from "./api"

export function notifyMutationError(error: unknown, fallback: string): void {
  if (error instanceof SecondFactorRequiredError) {
    toast.error("Second facteur requis", {
      description: error.message,
      action: {
        label: "Configurer",
        onClick: () => {
          if (typeof window !== "undefined") {
            window.location.assign("/settings/security/totp")
          }
        },
      },
    })
    return
  }
  const message =
    error instanceof Error && error.message ? error.message : fallback
  toast.error(message)
}
