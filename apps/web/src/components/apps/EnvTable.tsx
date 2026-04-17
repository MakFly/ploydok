// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import { MonacoEnvEditorDialog } from "./MonacoEnvEditorDialog"
import type { EnvVar, EnvVarPatch } from "../../lib/apps-env"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regex for valid env var keys: UPPER_SNAKE_CASE starting with an uppercase letter.
 * Must match the server-side validation in apps/api/src/routes/apps-env.ts.
 */
const ENV_KEY_REGEX = /^[A-Z][A-Z0-9_]*$/

/** Value displayed in the UI for masked secrets (mirrors server mask). */
const SECRET_MASK = "********"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditableVar extends EnvVarPatch {
  /** Transient UI state: whether the value input is currently revealed. */
  revealed: boolean
  /** Validation error for the key field, if any. */
  keyError?: string
}

export interface EnvTableProps {
  /**
   * Vars from the server. Secret values arrive masked ("********").
   * The table treats these as the "server snapshot" for diff detection.
   */
  serverVars: Array<EnvVar>
  isSaving: boolean
  onSave: (vars: Array<EnvVarPatch>) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a value warrants the Monaco multiline editor:
 * - contains a newline, OR
 * - is longer than 80 characters.
 */
export function shouldOfferMultilineEdit(value: string): boolean {
  return value.includes("\n") || value.length > 80
}

export function validateKey(key: string): string | undefined {
  if (!key) return "Key is required"
  if (!ENV_KEY_REGEX.test(key)) return "UPPER_SNAKE_CASE only (e.g. MY_VAR)"
  return undefined
}

/**
 * Returns true if the current local state differs from the server snapshot.
 * Masked secrets are treated as unchanged unless the value was explicitly
 * edited (i.e. no longer equals SECRET_MASK for a secret var).
 */
export function hasDiff(localVars: Array<EnvVarPatch>, serverVars: Array<EnvVar>): boolean {
  if (localVars.length !== serverVars.length) return true

  const serverMap = new Map(serverVars.map((v) => [v.key, v]))

  for (const local of localVars) {
    const server = serverMap.get(local.key)
    if (!server) return true
    if (local.secret !== server.secret) return true
    // For secret vars that still show the mask, we treat them as unchanged.
    if (local.secret && local.value === SECRET_MASK) continue
    if (local.value !== server.value) return true
  }

  return false
}

function initEditable(serverVars: Array<EnvVar>): Array<EditableVar> {
  return serverVars.map((v) => ({
    key: v.key,
    value: v.value,
    secret: v.secret,
    revealed: false,
    keyError: undefined,
  }))
}

// ---------------------------------------------------------------------------
// EnvTable
// ---------------------------------------------------------------------------

interface MonacoDialogState {
  open: boolean
  rowIndex: number
  rowKey: string
  rowValue: string
}

export function EnvTable({ serverVars, isSaving, onSave }: EnvTableProps): React.JSX.Element {
  const [rows, setRows] = React.useState<Array<EditableVar>>(() => initEditable(serverVars))
  const [revealAll, setRevealAll] = React.useState(false)
  const [monacoDialog, setMonacoDialog] = React.useState<MonacoDialogState>({
    open: false,
    rowIndex: -1,
    rowKey: "",
    rowValue: "",
  })

  // Sync rows when server data changes (e.g. after a save).
  const prevServerRef = React.useRef(serverVars)
  React.useEffect(() => {
    if (prevServerRef.current !== serverVars) {
      prevServerRef.current = serverVars
      setRows(initEditable(serverVars))
      setRevealAll(false)
    }
  }, [serverVars])

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const localPatches: Array<EnvVarPatch> = rows.map(({ key, value, secret }) => ({
    key,
    value,
    secret,
  }))

  const diff = hasDiff(localPatches, serverVars)
  const hasKeyErrors = rows.some((r) => r.keyError !== undefined)
  const pendingCount = (() => {
    if (!diff) return 0
    const serverMap = new Map(serverVars.map((v) => [v.key, v]))
    let count = 0
    for (const row of rows) {
      const server = serverMap.get(row.key)
      if (!server) {
        count++
        continue
      }
      if (row.secret !== server.secret) {
        count++
        continue
      }
      if (row.secret && row.value === SECRET_MASK) continue
      if (row.value !== server.value) count++
    }
    // Count deletions
    const localKeys = new Set(rows.map((r) => r.key))
    for (const sv of serverVars) {
      if (!localKeys.has(sv.key)) count++
    }
    return count
  })()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function updateRow(index: number, updates: Partial<EditableVar>) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row
        const next = { ...row, ...updates }
        // Re-validate key whenever it changes.
        if ("key" in updates) {
          next.keyError = validateKey(next.key)
        }
        return next
      }),
    )
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: "", value: "", secret: false, revealed: false, keyError: undefined },
    ])
  }

  function deleteRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  function toggleRevealRow(index: number) {
    updateRow(index, { revealed: !rows[index].revealed })
  }

  function openMonacoEditor(index: number) {
    const row = rows[index]
    setMonacoDialog({ open: true, rowIndex: index, rowKey: row.key, rowValue: row.value })
  }

  function handleMonacoSave(newValue: string) {
    updateRow(monacoDialog.rowIndex, { value: newValue })
  }

  function handleSave() {
    // Validate all keys before saving.
    const validated = rows.map((row) => ({
      ...row,
      keyError: validateKey(row.key),
    }))
    setRows(validated)
    if (validated.some((r) => r.keyError)) return

    onSave(localPatches)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Environment Variables</h2>
          {diff && pendingCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {pendingCount} unsaved {pendingCount === 1 ? "change" : "changes"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {rows.some((r) => r.secret) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRevealAll((v) => !v)}
              className="gap-1.5 text-xs"
            >
              {revealAll ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
              {revealAll ? "Hide all" : "Reveal all"}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!diff || isSaving || hasKeyErrors}
            onClick={handleSave}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-0 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Key</span>
          <span>Value</span>
          <span className="px-2">Secret</span>
          <span />
          <span />
        </div>

        {/* Body rows */}
        {rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No environment variables yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row, idx) => {
              const isRevealed = revealAll || row.revealed
              const isSecret = row.secret

              return (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-start gap-0 px-3 py-2"
                >
                  {/* Key cell */}
                  <div className="pr-2">
                    <input
                      type="text"
                      value={row.key}
                      onChange={(e) =>
                        updateRow(idx, { key: e.target.value.toUpperCase() })
                      }
                      placeholder="MY_VAR"
                      aria-label="Variable key"
                      className={[
                        "w-full rounded border px-2 py-1 font-mono text-xs",
                        "bg-transparent outline-none focus:ring-1",
                        row.keyError
                          ? "border-destructive focus:ring-destructive"
                          : "border-border focus:ring-ring",
                      ].join(" ")}
                    />
                    {row.keyError && (
                      <p className="mt-0.5 text-[10px] text-destructive">{row.keyError}</p>
                    )}
                  </div>

                  {/* Value cell */}
                  <div className="flex items-center gap-1 pr-2">
                    <input
                      type={isSecret && !isRevealed ? "password" : "text"}
                      value={row.value}
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      placeholder={isSecret ? SECRET_MASK : "value"}
                      aria-label="Variable value"
                      className="w-full rounded border border-border bg-transparent px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                    {isSecret && (
                      <button
                        type="button"
                        onClick={() => toggleRevealRow(idx)}
                        title={isRevealed ? "Hide" : "Reveal"}
                        aria-label={isRevealed ? "Hide value" : "Reveal value"}
                        className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {isRevealed ? (
                          <EyeOffIcon className="size-3.5" />
                        ) : (
                          <EyeIcon className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Secret toggle */}
                  <div className="flex items-center justify-center px-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isSecret}
                      onClick={() => updateRow(idx, { secret: !isSecret })}
                      title={isSecret ? "Mark as plain text" : "Mark as secret"}
                      className={[
                        "relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent",
                        "transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                        isSecret ? "bg-primary" : "bg-muted",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "pointer-events-none inline-block size-3 rounded-full bg-white shadow",
                          "transform transition duration-200 ease-in-out",
                          isSecret ? "translate-x-3" : "translate-x-0",
                        ].join(" ")}
                      />
                    </button>
                  </div>

                  {/* Edit as text (Monaco) button */}
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => openMonacoEditor(idx)}
                      title="Edit as text"
                      aria-label={`Edit ${row.key || "variable"} as text`}
                      className={[
                        "rounded p-1 transition-colors",
                        shouldOfferMultilineEdit(row.value)
                          ? "text-primary hover:text-primary/80"
                          : "text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      <PenIcon className="size-3.5" />
                    </button>
                  </div>

                  {/* Delete button */}
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => deleteRow(idx)}
                      aria-label={`Delete ${row.key || "variable"}`}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Add row button */}
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <PlusIcon className="size-3.5" />
            Add variable
          </button>
        </div>
      </div>

      {/* Monaco multiline editor dialog */}
      <MonacoEnvEditorDialog
        open={monacoDialog.open}
        onOpenChange={(open) => setMonacoDialog((prev) => ({ ...prev, open }))}
        envKey={monacoDialog.rowKey}
        initialValue={monacoDialog.rowValue}
        onSave={handleMonacoSave}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons (inline to avoid extra package dependency)
// ---------------------------------------------------------------------------

function EyeIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function PenIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}
