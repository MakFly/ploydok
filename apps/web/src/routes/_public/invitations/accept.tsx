// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { toast } from "sonner"
import { apiFetch } from "../../../lib/api"
import {
  useAcceptInvitation,
  useInvitationPreview,
} from "../../../lib/memberships"
import type { Me } from "@ploydok/shared"

export const Route = createFileRoute("/_public/invitations/accept")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      token: (search.token as string) || "",
    }
  },
  component: AcceptInvitationPage,
})

function AcceptInvitationPage(): React.JSX.Element {
  const { token } = useSearch({ from: Route.id })
  const router = useRouter()
  const [me, setMe] = React.useState<Me | null>(null)
  const [meLoading, setMeLoading] = React.useState(true)

  React.useEffect(() => {
    apiFetch<Me>("/me")
      .then(setMe)
      .catch(() => {
        setMe(null)
      })
      .finally(() => {
        setMeLoading(false)
      })
  }, [])

  const { data: preview, isLoading, error } = useInvitationPreview(token)
  const acceptMutation = useAcceptInvitation()

  const handleAccept = () => {
    acceptMutation.mutate(
      { token },
      {
        onSuccess: (data) => {
          toast.success("Invitation accepted! Redirecting...")
          void router.navigate({
            to: `/orgs/${data.organization.slug}/dashboard`,
          })
        },
      }
    )
  }

  const handleSignIn = () => {
    const redirectUrl = `/invitations/accept?token=${token}`
    void router.navigate({
      to: `/login?redirect=${encodeURIComponent(redirectUrl)}`,
    })
  }

  if (isLoading || meLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
        <div className="w-full max-w-sm">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-4 h-32 w-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    )
  }

  if (error || !preview) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-10 items-center justify-center rounded-[10px] bg-primary text-base font-bold text-primary-foreground">
              P
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl leading-tight font-semibold tracking-tight">
                Invalid invitation
              </h1>
              <p className="text-sm text-muted-foreground">
                This invitation is invalid or has expired.
              </p>
            </div>
          </div>

          <div className="flex justify-center gap-2">
            <Button onClick={() => void router.navigate({ to: "/login" })}>
              Back to login
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const emailMismatch = me && me.email !== preview.email

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-[10px] bg-primary text-base font-bold text-primary-foreground">
            P
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">
              Join {preview.org_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              You've been invited to collaborate.
            </p>
          </div>
        </div>

        <div className="rounded-[10px] border border-border bg-card p-5 shadow-[0_0_2.5px_1px_var(--border)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {preview.inviter_email}
                </span>{" "}
                invited you to join{" "}
                <span className="font-medium text-foreground">
                  {preview.org_name}
                </span>{" "}
                as a{" "}
                <span className="font-medium text-foreground">
                  {preview.role}
                </span>
                .
              </p>
              <p className="text-xs text-muted-foreground">
                Invitation email:{" "}
                <span className="font-mono">{preview.email}</span>
              </p>
            </div>

            {emailMismatch && (
              <div className="rounded-md border border-yellow-600/30 bg-yellow-600/10 px-4 py-3">
                <p className="text-sm text-yellow-600">
                  <strong>Note:</strong> This invitation is for{" "}
                  <strong>{preview.email}</strong>, but you're signed in as{" "}
                  <strong>{me.email}</strong>. Sign out to accept with the
                  correct account.
                </p>
              </div>
            )}

            {!me ? (
              <Button onClick={handleSignIn} size="lg" className="w-full">
                Sign in to accept
              </Button>
            ) : emailMismatch ? (
              <Button
                onClick={() =>
                  void router.navigate({ to: "/settings/security/sessions" })
                }
                size="lg"
                className="w-full"
                variant="outline"
              >
                Sign out and switch accounts
              </Button>
            ) : (
              <Button
                onClick={handleAccept}
                disabled={acceptMutation.isPending}
                size="lg"
                className="w-full"
              >
                {acceptMutation.isPending
                  ? "Accepting..."
                  : "Accept invitation"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
