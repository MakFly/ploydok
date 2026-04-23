// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams } from "@tanstack/react-router"
import { Shell } from "../../components/apps/Shell"

export function ShellPage(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }

  return <Shell appId={id} />
}
