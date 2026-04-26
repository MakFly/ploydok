// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../../lib/api"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { toast } from "sonner"
import type { CdnConfig } from "@ploydok/shared"

export function CdnSection({ appId }: { appId: string }): React.JSX.Element {
  const qc = useQueryClient()
  const { data: config } = useQuery({
    queryKey: ["apps", appId, "cdn"],
    queryFn: () => apiFetch<CdnConfig>(`/apps/${appId}/cdn`),
  })

  if (!config) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  return <CdnForm appId={appId} config={config} qc={qc} />
}

function CdnForm({
  appId,
  config,
  qc,
}: {
  appId: string
  config: CdnConfig
  qc: ReturnType<typeof useQueryClient>
}): React.JSX.Element {
  const [mode, setMode] = React.useState<"off" | "internal" | "external">(
    config.mode
  )
  const [cacheTtl, setCacheTtl] = React.useState(config.cache_ttl_s)
  const [compression, setCompression] = React.useState(config.compression)
  const [imageOptim, setImageOptim] = React.useState(config.image_optim)
  const [headers, setHeaders] = React.useState(
    JSON.stringify(config.headers ?? {}, null, 2)
  )
  const [externalProvider, setExternalProvider] = React.useState(
    config.external_provider ?? ""
  )

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CdnConfig>) =>
      apiFetch<CdnConfig>(`/apps/${appId}/cdn`, {
        method: "PUT",
        body: data,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apps", appId, "cdn"] })
      toast.success("CDN config updated")
    },
    onError: (err) => {
      toast.error(`Failed to update: ${err.message}`)
    },
  })

  function handleSave(): void {
    let parsedHeaders: Record<string, string> = {}
    try {
      parsedHeaders = JSON.parse(headers)
    } catch {
      toast.error("Invalid JSON in headers")
      return
    }

    updateMutation.mutate({
      mode,
      cache_ttl_s: cacheTtl,
      compression,
      image_optim: imageOptim,
      headers: parsedHeaders,
      external_provider: externalProvider || undefined,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Label>CDN Mode</Label>
        <Select
          value={mode}
          onValueChange={(v: "off" | "internal" | "external") => setMode(v)}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="internal">Internal (Caddy)</SelectItem>
            <SelectItem value="external">External Provider</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Internal uses Caddy reverse proxy. External delegates to a provider.
        </p>
      </div>

      {mode === "internal" && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>Cache TTL (seconds)</Label>
              <span className="text-sm font-medium">{cacheTtl}s</span>
            </div>
            <Input
              type="number"
              min={0}
              max={86400}
              step={60}
              value={cacheTtl ?? 0}
              onChange={(e) => setCacheTtl(parseInt(e.target.value, 10) || 0)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              0 = no caching, 86400 = 24 hours
            </p>
          </div>
        </>
      )}

      <Separator />

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Compression</p>
          <p className="text-xs text-muted-foreground">
            Enable gzip compression on responses.
          </p>
        </div>
        <Switch checked={compression} onCheckedChange={setCompression} />
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Image Optimization</p>
          <p className="text-xs text-muted-foreground">
            Optimize and cache images automatically.
          </p>
        </div>
        <Switch checked={imageOptim} onCheckedChange={setImageOptim} />
      </div>

      {mode === "internal" && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <Label htmlFor="headers">Custom Headers (JSON)</Label>
            <Textarea
              id="headers"
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder='{"X-Custom": "value"}'
              className="font-mono text-xs"
              rows={6}
            />
            <p className="text-xs text-muted-foreground">
              JSON object with header names as keys and values as strings.
            </p>
          </div>
        </>
      )}

      {mode === "external" && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <Label htmlFor="provider">Provider</Label>
            <Input
              id="provider"
              value={externalProvider}
              onChange={(e) => setExternalProvider(e.target.value)}
              placeholder="e.g. cloudflare, buncdn"
            />
            <p className="text-xs text-muted-foreground">
              External CDN provider identifier.
            </p>
          </div>
        </>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          type="button"
        >
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  )
}
