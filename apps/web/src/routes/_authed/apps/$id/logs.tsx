// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BuildLogViewer } from "../../../../components/apps/BuildLogViewer";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/logs")({
  component: AppLogsTab,
});

// ---------------------------------------------------------------------------
// AppLogsTab — runtime logs via WS /ws/apps/:id/logs
// ---------------------------------------------------------------------------

function AppLogsTab(): React.JSX.Element {
  const { id } = Route.useParams();

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Runtime Logs</h2>
        <p className="text-xs text-muted-foreground">
          Live output from the running container.
        </p>
      </div>
      <BuildLogViewer appId={id} className="min-h-[400px]" />
    </div>
  );
}
