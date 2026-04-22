// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Switch } from "@workspace/ui/components/switch"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { useProtection, useUpdateProtection, useRevealBasicAuth } from "../../lib/protection"

interface BasicAuthFormProps {
  appId: string
}

export function BasicAuthForm({ appId }: BasicAuthFormProps): React.JSX.Element {
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
          <p className="text-sm font-medium">Basic Authentication</p>
          <p className="text-xs text-muted-foreground">
            Require username and password to access this app.
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
              <Label htmlFor="ba-user">Username</Label>
              <Input
                id="ba-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="username"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ba-pass">Password</Label>
              <Input
                id="ba-pass"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="leave blank to keep current"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={update.isPending || !user}
            >
              Save
            </Button>
            {protection?.basicAuth.enabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReveal}
                disabled={reveal.isPending}
              >
                Reveal current
              </Button>
            )}
          </div>

          {revealed && (
            <div className="rounded-md bg-muted p-3 text-xs font-mono">
              <p>Username: {revealed.user}</p>
              <p>Password: {revealed.pass}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
