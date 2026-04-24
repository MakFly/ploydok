// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { RiAlertLine, RiCheckLine } from "@remixicon/react"
import { ShellPage } from "../../../components/layout/AppShell"
import { SettingsTabs } from "../../../components/settings/SettingsTabs"
import { useLicenseStatus, useActivateLicense } from "../../../lib/license"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"

export const Route = createFileRoute("/_authed/settings/license")({
  component: LicensePage,
})

function LicensePage(): React.JSX.Element {
  const { data: license } = useLicenseStatus()
  const { mutate: activate, isPending } = useActivateLicense()

  const [jwt, setJwt] = React.useState("")
  const isLicenseUiEnabled =
    typeof window !== "undefined" &&
    (process.env.NODE_ENV === "prod" ||
      process.env.PLOYDOK_SHOW_LICENSE_UI === "1")

  if (!isLicenseUiEnabled) {
    return (
      <ShellPage title="License" description="License management">
        <SettingsTabs />
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <RiAlertLine className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                License management unavailable
              </p>
              <p className="text-sm text-muted-foreground">
                License management is only available on self-hosted installs.
              </p>
            </div>
          </div>
        </div>
      </ShellPage>
    )
  }

  const handleActivate = () => {
    if (!jwt.trim()) {
      toast.error("Please enter a license JWT")
      return
    }

    activate(
      { jwt },
      {
        onSuccess: (response) => {
          setJwt("")
          toast.success(response.message)
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to activate license"
          )
        },
      }
    )
  }

  const isExpired = license?.is_expired ?? false
  const expiresAt = license?.expires_at ? new Date(license.expires_at) : null
  const daysUntilExpiry = expiresAt
    ? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <ShellPage
      title="License"
      description="Manage your self-hosted license"
      eyebrow="Instance"
    >
      <div className="space-y-6">
        <SettingsTabs />

        {license?.activated ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start gap-4">
              <div className="flex size-11 items-center justify-center rounded-full bg-green-100 text-green-600">
                <RiCheckLine className="size-5" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium capitalize">
                    {license.plan} Plan
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {license.seats} seats
                  </p>
                </div>

                {expiresAt && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Expires:
                    </p>
                    <p
                      className={`text-sm font-medium ${
                        isExpired
                          ? "text-red-600"
                          : daysUntilExpiry && daysUntilExpiry <= 30
                            ? "text-yellow-600"
                            : "text-green-600"
                      }`}
                    >
                      {expiresAt.toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                    {daysUntilExpiry && daysUntilExpiry >= 0 && (
                      <p className="text-xs text-muted-foreground">
                        ({daysUntilExpiry} days remaining)
                      </p>
                    )}
                    {isExpired && (
                      <p className="text-xs text-red-600">
                        License has expired
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">
              No active license. Activate one using a license JWT.
            </p>
          </div>
        )}

        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div>
            <h3 className="font-medium">Activate License</h3>
            <p className="text-sm text-muted-foreground">
              Paste your license JWT below to activate.
            </p>
          </div>

          <div className="space-y-3">
            <textarea
              value={jwt}
              onChange={(e) => setJwt(e.target.value)}
              placeholder="Paste license JWT here..."
              className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:border-primary focus:outline-none"
            />

            <Button
              onClick={handleActivate}
              disabled={isPending || !jwt.trim()}
              className="w-full"
            >
              {isPending ? "Activating..." : "Activate License"}
            </Button>
          </div>
        </div>
      </div>
    </ShellPage>
  )
}
