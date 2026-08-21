// SPDX-License-Identifier: AGPL-3.0-only

import * as React from "react"
import { useTranslation } from "react-i18next"
import { SheetContent as UiSheetContent } from "@workspace/ui/components/sheet"

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@workspace/ui/components/sheet"

export function SheetContent({
  closeLabel,
  ...props
}: React.ComponentProps<typeof UiSheetContent>): React.JSX.Element {
  const { t } = useTranslation("common")
  return <UiSheetContent closeLabel={closeLabel ?? t("close")} {...props} />
}
