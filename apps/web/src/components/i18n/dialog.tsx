// SPDX-License-Identifier: AGPL-3.0-only

import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  DialogContent as UiDialogContent,
  DialogFooter as UiDialogFooter,
} from "@workspace/ui/components/dialog"

export {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"

export function DialogContent({
  closeLabel,
  ...props
}: React.ComponentProps<typeof UiDialogContent>): React.JSX.Element {
  const { t } = useTranslation("common")
  return <UiDialogContent closeLabel={closeLabel ?? t("close")} {...props} />
}

export function DialogFooter({
  closeLabel,
  ...props
}: React.ComponentProps<typeof UiDialogFooter>): React.JSX.Element {
  const { t } = useTranslation("common")
  return <UiDialogFooter closeLabel={closeLabel ?? t("close")} {...props} />
}
