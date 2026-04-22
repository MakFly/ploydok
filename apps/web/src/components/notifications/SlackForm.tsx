// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"

interface SlackFormProps {
  webhookUrl: string
  onChange: (webhookUrl: string) => void
  error?: string
}

export function SlackForm({
  webhookUrl,
  onChange,
  error,
}: SlackFormProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="slack-webhook-url">URL du webhook</FieldLabel>
        <FieldContent>
          <Input
            id="slack-webhook-url"
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            value={webhookUrl}
            onChange={(e) => onChange(e.target.value)}
            required
          />
        </FieldContent>
        {error ? (
          <FieldError>{error}</FieldError>
        ) : (
          <FieldDescription>
            Dans ton workspace Slack : Apps → Incoming Webhooks → Add to
            Workspace → Choisir un canal → Copier l&apos;URL
          </FieldDescription>
        )}
      </Field>
      <p className="text-xs text-muted-foreground">
        <a
          href="https://api.slack.com/messaging/webhooks"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Documentation Slack
        </a>
      </p>
    </div>
  )
}
