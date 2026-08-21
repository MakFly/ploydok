// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"

interface DiscordFormProps {
  webhookUrl: string
  onChange: (webhookUrl: string) => void
  error?: string
}

export function DiscordForm({
  webhookUrl,
  onChange,
  error,
}: DiscordFormProps): React.JSX.Element {
  const { t } = useTranslation("settings")
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="discord-webhook-url">
          {t("notifications.webhookUrl")}
        </FieldLabel>
        <FieldContent>
          <Input
            id="discord-webhook-url"
            type="url"
            placeholder="https://discord.com/api/webhooks/..."
            value={webhookUrl}
            onChange={(e) => onChange(e.target.value)}
            required
          />
        </FieldContent>
        {error ? (
          <FieldError>{error}</FieldError>
        ) : (
          <FieldDescription>
            {t("notifications.discordHowTo")}
          </FieldDescription>
        )}
      </Field>
      <p className="text-xs text-muted-foreground">
        <a
          href="https://support.discord.com/hc/fr/articles/228383668-Intro-aux-Webhooks"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Documentation Discord
        </a>
      </p>
    </div>
  )
}
