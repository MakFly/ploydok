// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"
import {
  useDeleteOrgBranding,
  useOrgBranding,
  useUpdateOrgBranding,
} from "../../../../lib/branding"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/branding")({
  component: BrandingPage,
})

function BrandingPage(): React.JSX.Element {
  const { orgSlug } = Route.useParams()
  const { data: branding, isLoading } = useOrgBranding(orgSlug)
  const updateMutation = useUpdateOrgBranding(orgSlug)
  const deleteMutation = useDeleteOrgBranding(orgSlug)

  const [appName, setAppName] = React.useState("")
  const [logoUrl, setLogoUrl] = React.useState("")
  const [primaryColor, setPrimaryColor] = React.useState("")
  const [faviconUrl, setFaviconUrl] = React.useState("")

  React.useEffect(() => {
    if (branding) {
      setAppName(branding.app_name || "Ploydok")
      setLogoUrl(branding.logo_url || "")
      setPrimaryColor(branding.primary_color || "#0066ff")
      setFaviconUrl(branding.favicon_url || "")
    }
  }, [branding])

  const handleSave = async () => {
    updateMutation.mutate({
      app_name: appName,
      logo_url: logoUrl || null,
      primary_color: primaryColor || null,
      favicon_url: faviconUrl || null,
    })
  }

  const handleReset = () => {
    if (confirm("Reset branding to defaults?")) {
      deleteMutation.mutate()
    }
  }

  const isPremium = true // Check this based on the org's plan in a real implementation

  if (!isPremium) {
    return (
      <ShellPage
        title="Branding"
        description="Customize your app's appearance."
        eyebrow="Workspace"
      >
        <ShellPanel>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-8 text-center dark:border-amber-900 dark:bg-amber-950">
            <p className="font-semibold text-amber-900 dark:text-amber-100">
              Branding requires the Enterprise plan
            </p>
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
              Upgrade your organization to customize your app name, logo, and
              colors.
            </p>
            <Button className="mt-4" variant="default">
              Upgrade →
            </Button>
          </div>
        </ShellPanel>
      </ShellPage>
    )
  }

  return (
    <ShellPage
      title="Branding"
      description="Customize your app's appearance."
      eyebrow="Workspace"
    >
      <div className="space-y-6">
        {isLoading ? (
          <ShellPanel>
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 w-full animate-pulse rounded-lg bg-muted"
                />
              ))}
            </div>
          </ShellPanel>
        ) : (
          <>
            <ShellPanel
              title="Branding settings"
              description="Customize your workspace branding"
            >
              <div className="space-y-6">
                {/* App name */}
                <div className="space-y-2">
                  <Label htmlFor="app-name">App Name</Label>
                  <Input
                    id="app-name"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    placeholder="Ploydok"
                  />
                </div>

                {/* Logo URL */}
                <div className="space-y-2">
                  <Label htmlFor="logo-url">Logo URL</Label>
                  <Input
                    id="logo-url"
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                  />
                  {logoUrl && (
                    <div className="mt-2 rounded-lg border border-border p-4">
                      <img
                        src={logoUrl}
                        alt="Logo preview"
                        className="h-12 w-12 object-contain"
                      />
                    </div>
                  )}
                </div>

                {/* Primary color */}
                <div className="space-y-2">
                  <Label htmlFor="primary-color">Primary Color</Label>
                  <div className="flex gap-2">
                    <input
                      id="primary-color"
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-10 w-16 cursor-pointer rounded-lg border border-border"
                    />
                    <Input
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      placeholder="#0066ff"
                      className="flex-1"
                    />
                  </div>
                </div>

                {/* Favicon URL */}
                <div className="space-y-2">
                  <Label htmlFor="favicon-url">Favicon URL</Label>
                  <Input
                    id="favicon-url"
                    type="url"
                    value={faviconUrl}
                    onChange={(e) => setFaviconUrl(e.target.value)}
                    placeholder="https://example.com/favicon.ico"
                  />
                  {faviconUrl && (
                    <div className="mt-2 rounded-lg border border-border p-4">
                      <img
                        src={faviconUrl}
                        alt="Favicon preview"
                        className="h-6 w-6"
                      />
                    </div>
                  )}
                </div>

                {/* Preview */}
                <div className="space-y-2">
                  <Label>Preview</Label>
                  <div
                    className="rounded-lg border border-border p-6"
                    style={{
                      backgroundColor: "var(--background)",
                      color: primaryColor || "#0066ff",
                    }}
                  >
                    <h3 className="text-lg font-semibold">{appName}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Your app will appear with these settings
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <Button
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? "Saving..." : "Save changes"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending
                      ? "Resetting..."
                      : "Reset to defaults"}
                  </Button>
                </div>
              </div>
            </ShellPanel>
          </>
        )}
      </div>
    </ShellPage>
  )
}
