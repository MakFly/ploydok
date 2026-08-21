// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import { Switch } from "@workspace/ui/components/switch"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { useProtection, useRevealBasicAuth, useUpdateProtection } from "../../lib/protection"

interface BasicAuthFormProps {
  appId: string
}

export function BasicAuthForm({ appId }: BasicAuthFormProps): React.JSX.Element {
  const { t } = useTranslation(["apps", "common"])
  const { data: protection } = useProtection(appId)
  const update = useUpdateProtection(appId)
  const reveal = useRevealBasicAuth(appId)

  const [enabled, setEnabled] = React.useState(protection?.basicAuth.enabled ?? false)
  const [user, setUser] = React.useState("")
  const [pass, setPass] = React.useState("")
  const [revealed, setRevealed] = React.useState<{ user: string; pass: string } | null>(null)

  React.useEffect(() => {
    if (protection) {
      setEnabled(protection.basicAuth.enabled)
      setUser(protection.basicAuth.user ?? "")
    }
  }, [protection])

  function handleSave() {
    update.mutate({
      basicAuth: {
        enabled,
        user: user || undefined,
        pass: pass || undefined,
      },
    })
    setPass("")
  }

  function handleReveal() {
    reveal.mutate(undefined, {
      onSuccess: (data) => setRevealed(data),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{t("protection.basicAuth")}</p>
          <p className="text-xs text-muted-foreground">
            {t("protection.basicAuthDesc")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            setEnabled(v)
            if (!v) update.mutate({ basicAuth: { enabled: false } })
          }}
        />
      </div>

      {enabled && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ba-user">{t("protection.username")}</Label>
              <Input
                id="ba-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder={t("protection.username")}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ba-pass">{t("protection.password")}</Label>
              <Input
                id="ba-pass"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder={t("protection.keepPassword")}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              loading={update.isPending} disabled={!user}
            >
              {t("common:save")}
            </Button>
            {protection?.basicAuth.enabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReveal}
                loading={reveal.isPending}
              >
                {t("protection.revealCurrent")}
              </Button>
            )}
          </div>

          {revealed && (
            <div className="rounded-md bg-muted p-3 text-xs font-mono">
              <p>
                {t("protection.username")}: {revealed.user}
              </p>
              <p>
                {t("protection.password")}: {revealed.pass}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
