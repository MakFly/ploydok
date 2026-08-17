// SPDX-License-Identifier: AGPL-3.0-only
import { cn } from "@workspace/ui/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("skeleton-surface rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
