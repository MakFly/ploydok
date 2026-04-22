// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import type { CreateDomainParams, Dns01Provider, TlsMode } from "../../lib/domains"

const HOSTNAME_REGEX = /^[a-z0-9][a-z0-9.-]{1,253}\.[a-z]{2,}$/i

const DNS01_PROVIDERS: Array<{ value: Dns01Provider; label: string }> = [
  { value: "cloudflare", label: "Cloudflare" },
  { value: "route53", label: "AWS Route 53" },
  { value: "ovh", label: "OVH" },
  { value: "digitalocean", label: "DigitalOcean" },
]

export interface AddDomainDialogProps {
  onAdd: (params: CreateDomainParams) => void
  isAdding?: boolean
  lockReason?: string
}

export function AddDomainDialog({ onAdd, isAdding, lockReason }: AddDomainDialogProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [hostname, setHostname] = React.useState("")
  const [tlsMode, setTlsMode] = React.useState<TlsMode>("http01")
  const [dns01Provider, setDns01Provider] = React.useState<Dns01Provider>("cloudflare")
  const [wildcard, setWildcard] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = hostname.trim().toLowerCase()
    if (!HOSTNAME_REGEX.test(trimmed)) {
      setError("Invalid hostname format (e.g. app.example.com)")
      return
    }
    if (tlsMode === "dns01" && !dns01Provider) {
      setError("Select a DNS provider for DNS-01 mode")
      return
    }
    setError(null)
    onAdd({
      hostname: trimmed,
      tls_mode: tlsMode,
      dns01_provider: tlsMode === "dns01" ? dns01Provider : undefined,
      wildcard,
    })
    setOpen(false)
    setHostname("")
    setTlsMode("http01")
    setWildcard(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={Boolean(lockReason)}>
          Add domain
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add custom domain</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hostname">Hostname</Label>
            <Input
              id="hostname"
              placeholder="app.example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>TLS mode</Label>
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
                  onClick={() => {
                    setTlsMode(mode)
                    if (mode === "http01") setWildcard(false)
                  }}
                >
                  {mode === "http01" ? "HTTP-01 (standard)" : "DNS-01 (wildcard)"}
                </button>
              ))}
            </div>
          </div>

          {tlsMode === "dns01" && (
            <div className="space-y-1.5">
              <Label htmlFor="provider">DNS provider</Label>
              <select
                id="provider"
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

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={wildcard}
                  onChange={(e) => setWildcard(e.target.checked)}
                  className="rounded"
                />
                Wildcard certificate (*.{hostname || "example.com"})
              </label>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isAdding || !hostname}>
              {isAdding ? "Adding…" : "Add domain"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
