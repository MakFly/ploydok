// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
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
import {
  useTargetBackupConfig,
  useUpdateTargetBackupConfig,
} from "../../lib/backups"
import type { BackupTarget, UpdateBackupConfigInput } from "../../lib/backups"

interface BackupConfigPanelProps {
  target: BackupTarget
}

export function BackupConfigPanel({
  target,
}: BackupConfigPanelProps): React.JSX.Element {
  const { t } = useTranslation("databases")
  const { data: config, isLoading } = useTargetBackupConfig(target)
  const update = useUpdateTargetBackupConfig(target)

  const [destination, setDestination] = React.useState<"s3" | "local">("local")
  const [s3Endpoint, setS3Endpoint] = React.useState("")
  const [s3Bucket, setS3Bucket] = React.useState("")
  const [s3Prefix, setS3Prefix] = React.useState("")
  const [s3Region, setS3Region] = React.useState("")
  const [s3CredentialsSecretId, setS3CredentialsSecretId] = React.useState("")
  const [scheduleCron, setScheduleCron] = React.useState("0 3 * * *")
  const [retentionDays, setRetentionDays] = React.useState(7)
  const [agePublicKey, setAgePublicKey] = React.useState("")
  const [enabled, setEnabled] = React.useState(true)

  React.useEffect(() => {
    if (!config) return
    setDestination(config.destinationKind)
    setS3Endpoint(config.s3Endpoint ?? "")
    setS3Bucket(config.s3Bucket ?? "")
    setS3Prefix(config.s3Prefix ?? "")
    setS3Region(config.s3Region ?? "")
    setS3CredentialsSecretId(config.s3CredentialsSecretId ?? "")
    setScheduleCron(config.scheduleCron)
    setRetentionDays(config.retentionDays)
    setAgePublicKey(config.ageRecipientPublicKey ?? "")
    setEnabled(config.enabled)
  }, [config])

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const input: UpdateBackupConfigInput = {
      destinationKind: destination,
      scheduleCron,
      retentionDays,
      ageRecipientPublicKey: agePublicKey || null,
      enabled,
    }
    if (destination === "s3") {
      Object.assign(input, {
        s3Endpoint: s3Endpoint || undefined,
        s3Bucket,
        s3Prefix: s3Prefix || undefined,
        s3Region: s3Region || "auto",
        s3CredentialsSecretId: s3CredentialsSecretId || undefined,
      })
    }
    update.mutate(input)
  }

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label={t("backup.loading")}>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          id="backup-enabled"
        />
        <Label htmlFor="backup-enabled">{t("backup.enable")}</Label>
      </div>

      <div className="space-y-1.5">
        <Label>{t("backup.destination")}</Label>
        <Select
          value={destination}
          onValueChange={(value) => setDestination(value as "s3" | "local")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">{t("backup.local")}</SelectItem>
            <SelectItem value="s3">{t("backup.s3Option")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {destination === "s3" && (
        <div className="space-y-3 rounded-md border p-4">
          <div className="space-y-1.5">
            <Label>{t("backup.endpoint")}</Label>
            <Input
              placeholder="https://<account>.r2.cloudflarestorage.com"
              value={s3Endpoint}
              onChange={(e) => setS3Endpoint(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("backup.endpointHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>{t("backup.bucket")}</Label>
            <Input
              placeholder="my-ploydok-backups"
              value={s3Bucket}
              onChange={(e) => setS3Bucket(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("backup.prefix")}</Label>
              <Input
                placeholder="backups/"
                value={s3Prefix}
                onChange={(e) => setS3Prefix(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("backup.region")}</Label>
              <Input
                placeholder="auto"
                value={s3Region}
                onChange={(e) => setS3Region(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("backup.secretId")}</Label>
            <Input
              placeholder="secret-id containing {accessKeyId, secretAccessKey}"
              value={s3CredentialsSecretId}
              onChange={(e) => setS3CredentialsSecretId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("backup.secretHint")}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t("backup.schedule")}</Label>
        <Input
          placeholder="0 3 * * *"
          value={scheduleCron}
          onChange={(e) => setScheduleCron(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t("backup.scheduleHint")}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>{t("backup.retention")}</Label>
        <Input
          type="number"
          min={1}
          max={365}
          value={retentionDays}
          onChange={(e) => setRetentionDays(Number(e.target.value))}
        />
      </div>

      <div className="space-y-1.5">
        <Label>{t("backup.ageKey")}</Label>
        <Textarea
          placeholder="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
          value={agePublicKey}
          onChange={(e) => setAgePublicKey(e.target.value)}
          rows={2}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          {t("backup.encryptHint")}
        </p>
      </div>

      <Button type="submit" loading={update.isPending}>
        {update.isPending ? t("common:saving") : t("backup.save")}
      </Button>
    </form>
  )
}
