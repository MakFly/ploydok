// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import type { ServiceStatus } from "../../lib/services"

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  running: "default",
  pending: "secondary",
  created: "secondary",
  stopped: "outline",
  failed: "destructive",
  deleting: "secondary",
}

interface ServiceStatusBadgeProps {
  status: ServiceStatus | null | undefined
}

export function ServiceStatusBadge({
  status,
}: ServiceStatusBadgeProps): React.JSX.Element {
  const label = status ?? "unknown"
  return <Badge variant={STATUS_VARIANTS[label] ?? "outline"}>{label}</Badge>
}
