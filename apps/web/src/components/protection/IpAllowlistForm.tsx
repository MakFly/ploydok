// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import { Textarea } from "@workspace/ui/components/textarea"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { useProtection, useUpdateProtection } from "../../lib/protection"

interface IpAllowlistFormProps {
  appId: string
}

const CIDR_RE = /^((\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?|[0-9a-fA-F:]+(\/\d{1,3})?)$/

function validateLines(lines: Array<string>): Array<string> {
  return lines.filter((l) => l && !CIDR_RE.test(l))
}

export function IpAllowlistForm({ appId }: IpAllowlistFormProps): React.JSX.Element {
  const { t } = useTranslation(["apps", "common"])
  const { data: protection } = useProtection(appId)
  const update = useUpdateProtection(appId)
  const [value, setValue] = React.useState("")
  const [invalid, setInvalid] = React.useState<Array<string>>([])

  React.useEffect(() => {
    if (protection) {
      setValue(protection.ipAllowlist.join("\n"))
    }
  }, [protection])

  function handleChange(v: string) {
    setValue(v)
    const lines = v.split("\n").map((l) => l.trim()).filter(Boolean)
    setInvalid(validateLines(lines))
  }

  function handleSave() {
    const lines = value.split("\n").map((l) => l.trim()).filter(Boolean)
    update.mutate({ ipAllowlist: lines })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">{t("protection.ipAllowlist")}</p>
        <p className="text-xs text-muted-foreground">
          {t("protection.ipAllowlistDesc")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ip-allowlist">{t("protection.cidrLabel")}</Label>
        <Textarea
          id="ip-allowlist"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={"10.0.0.0/8\n192.168.1.0/24\n2001:db8::/32"}
          className="font-mono text-xs"
          rows={5}
        />
        {invalid.length > 0 && (
          <p className="text-xs text-destructive">
            {t("protection.invalidEntries", { entries: invalid.join(", ") })}
          </p>
        )}
      </div>

      <Button
        size="sm"
        onClick={handleSave}
        loading={update.isPending} disabled={invalid.length > 0}
        className="self-start"
      >
        {t("common:save")}
      </Button>
    </div>
  )
}
