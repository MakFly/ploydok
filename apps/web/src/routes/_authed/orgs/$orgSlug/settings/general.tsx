// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  useCurrentOrganization,
  useDeleteOrganization,
  useOrganizations,
} from "../../../../../lib/organizations"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/settings/general")(
  {
    component: GeneralSettingsPage,
  }
)

function GeneralSettingsPage(): React.JSX.Element {
  const { orgSlug } = Route.useParams()
  const organization = useCurrentOrganization()
  const { data: organizations } = useOrganizations()
  const deleteOrg = useDeleteOrganization()
  const navigate = useNavigate()

  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState("")

  const expectedConfirm = organization?.name ?? ""
  const canDelete =
    confirmText.trim() === expectedConfirm.trim() && expectedConfirm.length > 0

  const handleDelete = async (): Promise<void> => {
    try {
      await deleteOrg.mutateAsync({ slug: orgSlug })
      setConfirmOpen(false)

      const remaining = (organizations ?? []).filter((o) => o.slug !== orgSlug)
      const next = remaining[0]
      if (next) {
        await navigate({
          to: "/orgs/$orgSlug/dashboard",
          params: { orgSlug: next.slug },
          replace: true,
        })
      } else {
        await navigate({ to: "/dashboard", replace: true })
      }
    } catch {
      // toast already raised by the mutation
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace identity</CardTitle>
          <CardDescription>
            Read-only summary. Renaming and slug changes are coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              readOnly
              value={organization?.name ?? ""}
              className="bg-muted/40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-slug">Slug</Label>
            <Input
              id="ws-slug"
              readOnly
              value={organization?.slug ?? ""}
              className="bg-muted/40 font-mono text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this workspace and every app, database, env
            variable, domain and audit entry attached to it. There is no undo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmText("")
              setConfirmOpen(true)
            }}
            disabled={!organization}
          >
            Delete workspace
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!deleteOrg.isPending) setConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Every resource owned by{" "}
                  <strong className="text-foreground">
                    {organization?.name ?? orgSlug}
                  </strong>{" "}
                  will be removed in cascade — apps, databases, domains, env
                  vars, audit history. This cannot be undone.
                </p>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="confirm-name"
                    className="text-xs font-medium text-foreground"
                  >
                    Type <span className="font-mono">{expectedConfirm}</span> to
                    confirm
                  </Label>
                  <Input
                    id="confirm-name"
                    autoFocus
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={expectedConfirm}
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteOrg.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!canDelete || deleteOrg.isPending}
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
            >
              {deleteOrg.isPending ? "Deleting…" : "Delete workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
