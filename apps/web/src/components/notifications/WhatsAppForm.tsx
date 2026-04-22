// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { RiInformationLine } from "@remixicon/react"

export type WhatsAppProvider = "twilio" | "meta_cloud"

interface TwilioFields {
  account_sid: string
  auth_token: string
  phone_from: string
  phone_to: string
}

interface WhatsAppFormProps {
  provider: WhatsAppProvider
  twilio: TwilioFields
  onProviderChange: (p: WhatsAppProvider) => void
  onTwilioChange: (fields: Partial<TwilioFields>) => void
}

export function WhatsAppForm({
  provider,
  twilio,
  onProviderChange,
  onTwilioChange,
}: WhatsAppFormProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">Coming soon</Badge>
      </div>

      <Alert>
        <RiInformationLine className="size-4" />
        <AlertTitle>Envoi désactivé pour le moment</AlertTitle>
        <AlertDescription>
          Les notifications WhatsApp ne sont pas encore actives — la
          configuration peut être sauvegardée en préparation.
        </AlertDescription>
      </Alert>

      {/* Provider selector */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={provider === "twilio" ? "default" : "outline"}
          size="sm"
          onClick={() => onProviderChange("twilio")}
        >
          Twilio
        </Button>
        <Button
          type="button"
          variant={provider === "meta_cloud" ? "default" : "outline"}
          size="sm"
          onClick={() => onProviderChange("meta_cloud")}
        >
          Meta Cloud API
        </Button>
      </div>

      {provider === "twilio" ? (
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="wa-account-sid">Account SID</FieldLabel>
            <FieldContent>
              <Input
                id="wa-account-sid"
                type="text"
                placeholder="ACxxxxxxxxxxxxxxxx"
                value={twilio.account_sid}
                onChange={(e) => onTwilioChange({ account_sid: e.target.value })}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="wa-auth-token">Auth Token</FieldLabel>
            <FieldContent>
              <Input
                id="wa-auth-token"
                type="password"
                placeholder="••••••••••••••••"
                value={twilio.auth_token}
                onChange={(e) => onTwilioChange({ auth_token: e.target.value })}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="wa-phone-from">Numéro expéditeur</FieldLabel>
            <FieldContent>
              <Input
                id="wa-phone-from"
                type="text"
                placeholder="+14155238886"
                value={twilio.phone_from}
                onChange={(e) => onTwilioChange({ phone_from: e.target.value })}
              />
            </FieldContent>
            <FieldDescription>
              Format E.164 (ex. +14155238886 — numéro sandbox Twilio)
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="wa-phone-to">Numéro destinataire</FieldLabel>
            <FieldContent>
              <Input
                id="wa-phone-to"
                type="text"
                placeholder="+33612345678"
                value={twilio.phone_to}
                onChange={(e) => onTwilioChange({ phone_to: e.target.value })}
              />
            </FieldContent>
            <FieldDescription>Format E.164</FieldDescription>
          </Field>

          <p className="text-xs text-muted-foreground">
            Console Twilio → Messaging → Try it out → Send a WhatsApp message
            (Sandbox gratuit pour le dev).{" "}
            <a
              href="https://www.twilio.com/docs/whatsapp/sandbox"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Documentation Twilio
            </a>
          </p>
        </div>
      ) : (
        <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          <p className="mb-1">
            Meta Cloud API n&apos;est pas encore supporté — utilisez Twilio pour
            l&apos;instant.
          </p>
          <a
            href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline underline-offset-4 hover:text-foreground"
          >
            Documentation Meta Cloud API
          </a>
        </div>
      )}
    </div>
  )
}
