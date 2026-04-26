// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { startAuthentication } from "@simplewebauthn/browser"
import { Button } from "@workspace/ui/components/button"
import { apiFetch } from "../../lib/api"
import { useLogin } from "../../lib/auth"

interface LoginOptionsResponse {
  options: Parameters<typeof startAuthentication>[0]["optionsJSON"]
  _challengeKey: string
}

interface PasskeyButtonProps {
  email?: string
  onSuccess?: () => void
  onError?: (err: Error) => void
}

export function PasskeyButton({
  email = "",
  onSuccess,
  onError,
}: PasskeyButtonProps): React.JSX.Element {
  const login = useLogin()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleClick = async (): Promise<void> => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError("Enter your email first")
      return
    }

    setLoading(true)
    setError(null)
    try {
      // 1. Get challenge from server
      const { options, _challengeKey } = await apiFetch<LoginOptionsResponse>(
        `/auth/login/options?email=${encodeURIComponent(normalizedEmail)}`
      )

      // 2. Browser WebAuthn
      const credential = await startAuthentication({ optionsJSON: options })

      // 3. Verify with server
      await login.mutateAsync({ credential, _challengeKey })

      onSuccess?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed"
      setError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        onClick={() => void handleClick()}
        disabled={loading}
        className="w-full"
        size="lg"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg
              className="animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Authenticating…
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
              <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
            </svg>
            Sign in with passkey
          </span>
        )}
      </Button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
