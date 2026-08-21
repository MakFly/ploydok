// SPDX-License-Identifier: AGPL-3.0-only
import { toast } from "sonner"
import { SecondFactorRequiredError } from "./api"
import i18n from "./i18n"

export function notifyMutationError(error: unknown, fallback: string): void {
  if (error instanceof SecondFactorRequiredError) {
    toast.error(i18n.t("settings:secondFactor.toastTitle"), {
      description: error.message,
      action: {
        label: i18n.t("settings:secondFactor.configure"),
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
