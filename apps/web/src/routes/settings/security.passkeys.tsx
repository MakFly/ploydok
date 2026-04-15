// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useAddPasskey, usePasskeys, useRemovePasskey } from "../../lib/passkeys";

export const Route = createFileRoute("/settings/security/passkeys")({
  component: PasskeysPage,
});

function PasskeysPage(): React.JSX.Element {
  const { data: passkeys, isLoading, error } = usePasskeys();
  const addPasskey = useAddPasskey();
  const removePasskey = useRemovePasskey();
  const [deviceName, setDeviceName] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);

  const handleAdd = async (): Promise<void> => {
    setAddError(null);
    try {
      await addPasskey.mutateAsync({ deviceName: deviceName || undefined });
      setDeviceName("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add passkey");
    }
  };

  const handleRemove = async (id: string): Promise<void> => {
    setRemoveError(null);
    try {
      await removePasskey.mutateAsync(id);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Failed to remove passkey");
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading passkeys…</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load passkeys: {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add passkey */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">Add a new passkey</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Device name (optional)"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            onClick={() => void handleAdd()}
            disabled={addPasskey.isPending}
            size="sm"
          >
            {addPasskey.isPending ? "Registering…" : "Add passkey"}
          </Button>
        </div>
        {addError && (
          <p className="text-sm text-destructive" role="alert">
            {addError}
          </p>
        )}
      </div>

      {/* Passkey list */}
      <div className="space-y-2">
        {passkeys?.map((pk) => (
          <div
            key={pk.id}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
          >
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {pk.device_name ?? "Unnamed device"}
              </p>
              <p className="text-xs text-muted-foreground">
                Added {new Date(pk.created_at).toLocaleDateString()} · Last used{" "}
                {new Date(pk.last_used_at).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleRemove(pk.id)}
              disabled={
                removePasskey.isPending && removePasskey.variables === pk.id
              }
            >
              Remove
            </Button>
          </div>
        ))}

        {passkeys?.length === 0 && (
          <p className="text-sm text-muted-foreground">No passkeys registered.</p>
        )}
      </div>

      {removeError && (
        <p className="text-sm text-destructive" role="alert">
          {removeError}
        </p>
      )}

      {passkeys && passkeys.length <= 1 && (
        <p className="text-xs text-muted-foreground">
          You cannot remove your last passkey without active backup codes.
        </p>
      )}
    </div>
  );
}
