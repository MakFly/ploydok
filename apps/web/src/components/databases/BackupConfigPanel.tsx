// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
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

  // Sync form state when config loads
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
      <p className="text-sm text-muted-foreground">
        Loading backup configuration…
      </p>
    )
  }

  return (
    <form onSubmit={handleSave} className="max-w-xl space-y-5">
      {/* Enabled toggle */}
      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={setEnabled} id="backup-enabled" />
        <Label htmlFor="backup-enabled">Enable scheduled backups</Label>
      </div>

      {/* Destination */}
      <div className="space-y-1.5">
        <Label>Destination</Label>
        <Select
          value={destination}
          onValueChange={(value) => setDestination(value as "s3" | "local")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local filesystem</SelectItem>
            <SelectItem value="s3">
              S3-compatible · R2 / AWS / Scaleway / OVH
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* S3 fields */}
      {destination === "s3" && (
        <div className="space-y-3 rounded-md border p-4">
          <div className="space-y-1.5">
            <Label>S3 endpoint</Label>
            <Input
              placeholder="https://<account>.r2.cloudflarestorage.com"
              value={s3Endpoint}
              onChange={(e) => setS3Endpoint(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty for AWS default, or use a provider endpoint for R2,
              Scaleway, OVH, Backblaze, Wasabi, or any S3-compatible storage.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Bucket</Label>
            <Input
              placeholder="my-ploydok-backups"
              value={s3Bucket}
              onChange={(e) => setS3Bucket(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Prefix</Label>
              <Input
                placeholder="backups/"
                value={s3Prefix}
                onChange={(e) => setS3Prefix(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Input
                placeholder="auto"
                value={s3Region}
                onChange={(e) => setS3Region(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>S3 credentials secret ID</Label>
            <Input
              placeholder="secret-id containing {accessKeyId, secretAccessKey}"
              value={s3CredentialsSecretId}
              onChange={(e) => setS3CredentialsSecretId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Create a secret in your app with JSON value{" "}
              <code className="rounded bg-muted px-1 font-mono">
                {'{ "accessKeyId": "...", "secretAccessKey": "..." }'}
              </code>
            </p>
          </div>
        </div>
      )}

      {/* Schedule */}
      <div className="space-y-1.5">
        <Label>Schedule (cron UTC)</Label>
        <Input
          placeholder="0 3 * * *"
          value={scheduleCron}
          onChange={(e) => setScheduleCron(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Default: daily at 03:00 UTC
        </p>
      </div>

      {/* Retention */}
      <div className="space-y-1.5">
        <Label>Retention (days)</Label>
        <Input
          type="number"
          min={1}
          max={365}
          value={retentionDays}
          onChange={(e) => setRetentionDays(Number(e.target.value))}
        />
      </div>

      {/* age public key */}
      <div className="space-y-1.5">
        <Label>age recipient public key (optional)</Label>
        <Textarea
          placeholder="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
          value={agePublicKey}
          onChange={(e) => setAgePublicKey(e.target.value)}
          rows={2}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          When set, each backup is encrypted with{" "}
          <code className="font-mono">age</code> before upload. The private key
          is only needed at restore time and is never stored by Ploydok.
        </p>
      </div>

      <Button type="submit" disabled={update.isPending}>
        {update.isPending ? "Saving…" : "Save configuration"}
      </Button>
    </form>
  )
}
