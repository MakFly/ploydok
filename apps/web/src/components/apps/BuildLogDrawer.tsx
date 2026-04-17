// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@workspace/ui/components/sheet"
import { Button } from "@workspace/ui/components/button"
import { BuildLogViewer } from "./BuildLogViewer"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BuildLogDrawerProps {
  appId: string
  /** The build ID to display logs for. `undefined` means the drawer is closed. */
  buildId: string | undefined
  /** Called when the drawer is closed (user clicks Close or presses Esc). */
  onClose: () => void
}

// ---------------------------------------------------------------------------
// BuildLogDrawer
// ---------------------------------------------------------------------------

export function BuildLogDrawer({
  appId,
  buildId,
  onClose,
}: BuildLogDrawerProps): React.JSX.Element {
  const isOpen = Boolean(buildId)

  const handleDownload = React.useCallback(async () => {
    if (!buildId) return
    try {
      const url = `/api/apps/${appId}/logs?buildId=${encodeURIComponent(buildId)}`
      const resp = await fetch(url)
      if (!resp.ok) {
        console.error("Failed to download logs:", resp.statusText)
        return
      }
      const blob = await resp.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = objectUrl
      a.download = `build-${buildId.slice(0, 8)}.log`
      a.click()
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      console.error("Download error:", err)
    }
  }, [appId, buildId])

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="!w-[95vw] !max-w-[95vw] sm:!max-w-[95vw] flex flex-col gap-0 p-0"
      >
        <SheetHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3">
          <SheetTitle className="text-sm font-medium">
            {buildId ? `Build logs — ${buildId.slice(0, 8)}` : "Build logs"}
          </SheetTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleDownload()}
              disabled={!buildId}
            >
              Download
            </Button>
            <SheetClose asChild>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-hidden p-4">
          {buildId && (
            <BuildLogViewer
              appId={appId}
              buildId={buildId}
              className="h-full min-h-[500px]"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
