// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Label } from "@workspace/ui/components/label"
import type { Dns01Provider, TlsMode } from "../../lib/domains"

const DNS01_PROVIDERS: Array<{ value: Dns01Provider; label: string }> = [
  { value: "cloudflare", label: "Cloudflare" },
  { value: "route53", label: "AWS Route 53" },
  { value: "ovh", label: "OVH" },
  { value: "digitalocean", label: "DigitalOcean" },
]

export interface TlsModeSwitcherProps {
  domainId: string
  currentMode: TlsMode
  open: boolean
  onOpenChange: (open: boolean) => void
  onSwitch: (params: { domainId: string; tls_mode: TlsMode; dns01_provider?: Dns01Provider }) => void
  isSwitching?: boolean
}

export function TlsModeSwitcher({
  domainId,
  currentMode,
  open,
  onOpenChange,
  onSwitch,
  isSwitching,
}: TlsModeSwitcherProps): React.JSX.Element {
  const [tlsMode, setTlsMode] = React.useState<TlsMode>(currentMode)
  const [dns01Provider, setDns01Provider] = React.useState<Dns01Provider>("cloudflare")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSwitch({
      domainId,
      tls_mode: tlsMode,
      dns01_provider: tlsMode === "dns01" ? dns01Provider : undefined,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Switch TLS mode</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>TLS challenge mode</Label>
            <div className="flex gap-2">
              {(["http01", "dns01"] as TlsMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={[
                    "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    tlsMode === mode
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted",
                  ].join(" ")}
                  onClick={() => setTlsMode(mode)}
                >
                  {mode === "http01" ? "HTTP-01" : "DNS-01"}
                </button>
              ))}
            </div>
          </div>

          {tlsMode === "dns01" && (
            <div className="space-y-1.5">
              <Label htmlFor="switch-provider">DNS provider</Label>
              <select
                id="switch-provider"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                value={dns01Provider}
                onChange={(e) => setDns01Provider(e.target.value as Dns01Provider)}
              >
                {DNS01_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSwitching}>
              {isSwitching ? "Switching…" : "Apply"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
