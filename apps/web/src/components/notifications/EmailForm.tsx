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
  const { t } = useTranslation("settings")
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="email-to">{t("notifications.emailTo")}</FieldLabel>
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
            {t("notifications.emailHint")}
          </FieldDescription>
        )}
      </Field>
    </div>
  )
}
