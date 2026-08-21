// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import { Switch } from "@workspace/ui/components/switch"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { useProtection, useUpdateProtection } from "../../lib/protection"

interface RateLimitFormProps {
  appId: string
}

export function RateLimitForm({ appId }: RateLimitFormProps): React.JSX.Element {
  const { t } = useTranslation(["apps", "common"])
  const { data: protection } = useProtection(appId)
  const update = useUpdateProtection(appId)
  const [enabled, setEnabled] = React.useState(false)
  const [rps, setRps] = React.useState(10)

  React.useEffect(() => {
    if (protection) {
      const current = protection.rateLimitRps
      setEnabled(current !== null && current > 0)
      setRps(current ?? 10)
    }
  }, [protection])

  function handleSave() {
    update.mutate({ rateLimitRps: enabled ? rps : null })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{t("protection.rateLimit")}</p>
          <p className="text-xs text-muted-foreground">
            {t("protection.rateLimitDesc")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            setEnabled(v)
            if (!v) update.mutate({ rateLimitRps: null })
          }}
        />
      </div>

      {enabled && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rl-rps">{t("protection.rpsLabel")}</Label>
            <Input
              id="rl-rps"
              type="number"
              min={1}
              max={10000}
              value={rps}
              onChange={(e) => setRps(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-32"
            />
          </div>

          <Button
            size="sm"
            onClick={handleSave}
            loading={update.isPending}
            className="self-start"
          >
            {t("common:save")}
          </Button>
        </div>
      )}
    </div>
  )
}
