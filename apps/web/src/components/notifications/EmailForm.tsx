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

interface EmailFormProps {
  to: string
  onChange: (to: string) => void
  error?: string
}

export function EmailForm({
  to,
  onChange,
  error,
}: EmailFormProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="email-to">Adresse email destinataire</FieldLabel>
        <FieldContent>
          <Input
            id="email-to"
            type="email"
            placeholder="you@example.com"
            value={to}
            onChange={(e) => onChange(e.target.value)}
            required
          />
        </FieldContent>
        {error ? (
          <FieldError>{error}</FieldError>
        ) : (
          <FieldDescription>
            L&apos;email sera envoyé via le SMTP configuré sur l&apos;instance
            Ploydok (variable SMTP_URL).
          </FieldDescription>
        )}
      </Field>
    </div>
  )
}
