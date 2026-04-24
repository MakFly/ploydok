// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import type { MemberListItem } from "@ploydok/shared"

interface Member extends MemberListItem {
  is_me: boolean
}

interface RemoveMemberDialogProps {
  open: boolean
  member: Member
  onConfirm: () => void
  onCancel: () => void
  isLoading: boolean
}

export function RemoveMemberDialog({
  open,
  member,
  onConfirm,
  onCancel,
  isLoading,
}: RemoveMemberDialogProps): React.JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={(newOpen) => !newOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove member</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove{" "}
            <strong>{member.user.display_name}</strong> from this workspace?
            They will lose access immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-3">
          <AlertDialogCancel onClick={onCancel} disabled={isLoading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            variant="destructive"
          >
            {isLoading ? "Removing..." : "Remove"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
