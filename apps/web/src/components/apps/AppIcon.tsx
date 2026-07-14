// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

export function AppIcon({
  name,
  src,
  className,
}: {
  name: string
  src?: string | null
  className?: string
}): React.JSX.Element {
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [src])

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-xs font-semibold text-muted-foreground",
        className
      )}
      aria-hidden="true"
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="size-full object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        name.trim().slice(0, 2).toUpperCase() || "AP"
      )}
    </span>
  )
}
