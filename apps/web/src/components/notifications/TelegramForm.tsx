// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
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
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="telegram-bot-token">Token du bot</FieldLabel>
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
          Obtenu via @BotFather avec la commande /newbot.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="telegram-chat-id">Chat ID</FieldLabel>
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
          ID numérique du chat privé (positif) ou du groupe/channel (négatif).
        </FieldDescription>
      </Field>

      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground leading-5">
        <p className="font-medium text-foreground mb-1">Configuration pas-à-pas</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Ouvre{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              @BotFather
            </a>{" "}
            sur Telegram, envoie <code className="font-mono">/newbot</code>, suis les instructions
            et récupère le token.
          </li>
          <li>
            Démarre une conversation avec ton bot (ou ajoute-le à un groupe/channel et envoie{" "}
            <code className="font-mono">/start</code>).
          </li>
          <li>
            Récupère le <code className="font-mono">chat_id</code> via{" "}
            <code className="font-mono">
              https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
            </code>
            , ou plus simple : écris à{" "}
            <a
              href="https://t.me/userinfobot"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              @userinfobot
            </a>{" "}
            pour ton chat perso.
          </li>
          <li>Clique sur « Test » après création pour vérifier l'envoi.</li>
        </ol>
      </div>
    </div>
  )
}
