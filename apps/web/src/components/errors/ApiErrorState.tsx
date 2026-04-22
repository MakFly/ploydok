// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ApiErrorStateProps {
  code?: string
  status?: number
  message?: string
  onRetry?: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleForStatus(code?: string, status?: number): string {
  if (code === "SECOND_FACTOR_REQUIRED") return "Second factor required"
  if (code === "BACKEND_UNAVAILABLE") return "Backend indisponible"
  if (status === 401) return "Not signed in"
  if (status === 403) return "Forbidden"
  if (status === 404) return "Not found"
  if (status !== undefined && status >= 500) return "Something broke"
  return "Something went wrong"
}

// ---------------------------------------------------------------------------
// Icons (inline SVG — no extra dep)
// ---------------------------------------------------------------------------

function AlertCircleIcon({
  className,
}: {
  className?: string
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function HomeIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function RefreshIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApiErrorState({
  code,
  status,
  message,
  onRetry,
}: ApiErrorStateProps): React.JSX.Element {
  const title = titleForStatus(code, status)

  // Dedicated branch for SECOND_FACTOR_REQUIRED: show a CTA to configure a
  // second passkey or backup codes instead of a generic error message.
  if (code === "SECOND_FACTOR_REQUIRED") {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center"
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircleIcon className="size-6 text-destructive" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">
            Ajoutez une 2ᵉ passkey ou générez des backup codes pour effectuer
            cette action.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="default" size="sm" asChild>
            <Link to="/settings/security/passkey">Configurer</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard">
              <HomeIcon className="mr-1.5 size-3.5" />
              Go home
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center"
    >
      {/* Icon */}
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircleIcon className="size-6 text-destructive" />
      </div>

      {/* Status badge */}
      {status !== undefined && (
        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {status}
        </span>
      )}

      {/* Title + message */}
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <Button variant="default" size="sm" onClick={onRetry}>
            <RefreshIcon className="mr-1.5 size-3.5" />
            Retry
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard">
            <HomeIcon className="mr-1.5 size-3.5" />
            Go home
          </Link>
        </Button>
      </div>
    </div>
  )
}
