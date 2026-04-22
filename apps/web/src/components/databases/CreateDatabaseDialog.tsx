// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { useCreateDatabase } from "../../lib/databases"
import type { DbKind, DbPlan } from "../../lib/databases"

interface CreateDatabaseDialogProps {
  open: boolean
  projectId: string
  onClose: () => void
}

const KINDS: Array<{ value: DbKind; label: string; icon: string }> = [
  { value: "postgres", label: "PostgreSQL 16", icon: "🐘" },
  { value: "redis", label: "Redis 7", icon: "⚡" },
  { value: "mongo", label: "MongoDB 7", icon: "🍃" },
]

const PLANS: Array<{ value: DbPlan; label: string; desc: string }> = [
  { value: "small", label: "Small", desc: "0.5 CPU · 512 MB" },
  { value: "medium", label: "Medium", desc: "1 CPU · 2 GB" },
  { value: "large", label: "Large", desc: "2 CPU · 8 GB" },
]

export function CreateDatabaseDialog({ open, projectId, onClose }: CreateDatabaseDialogProps): React.JSX.Element {
  const [kind, setKind] = React.useState<DbKind>("postgres")
  const [plan, setPlan] = React.useState<DbPlan>("small")
  const [name, setName] = React.useState("")
  const { mutate: createDb, isPending } = useCreateDatabase()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createDb(
      { projectId, kind, name, plan },
      {
        onSuccess: () => {
          setName("")
          setKind("postgres")
          setPlan("small")
          onClose()
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create database</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  className={`flex flex-col items-center gap-1 border rounded-md p-3 text-sm transition-colors ${
                    kind === k.value
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <span className="text-2xl">{k.icon}</span>
                  <span>{k.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="db-name">Name</Label>
            <Input
              id="db-name"
              placeholder="my-database"
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="[a-z0-9-]+"
              required
            />
            <span className="text-xs text-muted-foreground">Lowercase letters, numbers, and dashes only.</span>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="db-plan">Plan</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v as DbPlan)}>
              <SelectTrigger id="db-plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLANS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <span className="font-medium">{p.label}</span>
                    <span className="ml-2 text-muted-foreground text-xs">{p.desc}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name}>
              {isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
