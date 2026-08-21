// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"

interface TelegramFormProps {
  botToken: string
  chatId: string
  onBotTokenChange: (v: string) => void
  onChatIdChange: (v: string) => void
}

export function TelegramForm({
  botToken,
  chatId,
  onBotTokenChange,
  onChatIdChange,
}: TelegramFormProps): React.JSX.Element {
  const { t } = useTranslation("settings")
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="telegram-bot-token">
          {t("notifications.telegramBotToken")}
        </FieldLabel>
        <FieldContent>
          <Input
            id="telegram-bot-token"
            type="password"
            placeholder="1234567890:ABCdefGHI..."
            value={botToken}
            onChange={(e) => onBotTokenChange(e.target.value)}
          />
        </FieldContent>
        <FieldDescription>
          {t("notifications.telegramBotHint")}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="telegram-chat-id">
          {t("notifications.telegramChatId")}
        </FieldLabel>
        <FieldContent>
          <Input
            id="telegram-chat-id"
            type="text"
            placeholder="-1001234567890"
            value={chatId}
            onChange={(e) => onChatIdChange(e.target.value)}
          />
        </FieldContent>
        <FieldDescription>
          {t("notifications.chatIdHint")}
        </FieldDescription>
      </Field>

      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground leading-5">
        <p className="font-medium text-foreground mb-1">
          {t("notifications.telegramSteps")}
        </p>
        <ol className="list-decimal list-inside space-y-1">
          <li>{t("notifications.telegramStep1")}</li>
          <li>{t("notifications.telegramStep2")}</li>
          <li>{t("notifications.telegramStep3")}</li>
          <li>{t("notifications.telegramStep4")}</li>
        </ol>
      </div>
    </div>
  )
}
