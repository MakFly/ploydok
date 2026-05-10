// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { DEFAULT_DATABASE_ENV_PREFIX } from "../../lib/database-env"
import { useDatabases, useLinkDatabase } from "../../lib/databases"
import type { Database } from "../../lib/databases"

interface LinkDatabaseDialogProps {
  open: boolean
  appId: string
  projectId: string
  onClose: () => void
}

const PREFIX_REGEX = /^[A-Z0-9_]+$/

export function LinkDatabaseDialog({
  open,
  appId,
  projectId,
  onClose,
}: LinkDatabaseDialogProps): React.JSX.Element {
  const [selectedDbId, setSelectedDbId] = React.useState("")
  const [envPrefix, setEnvPrefix] = React.useState(DEFAULT_DATABASE_ENV_PREFIX)
  const [prefixError, setPrefixError] = React.useState("")

  const { data: databases, isLoading } = useDatabases(projectId, {
    enabled: open,
  })
  const { mutate: linkDb, isPending } = useLinkDatabase()

  const runningDbs = (databases ?? []).filter(
    (db: Database) => db.status === "running"
  )

  function validatePrefix(v: string): boolean {
    if (!PREFIX_REGEX.test(v)) {
      setPrefixError(
        "Must be UPPER_SNAKE_CASE (letters, numbers, underscores only)"
      )
      return false
    }
    setPrefixError("")
    return true
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedDbId) return
    if (!validatePrefix(envPrefix)) return

    linkDb(
      { appId, databaseId: selectedDbId, env_prefix: envPrefix },
      {
        onSuccess: () => {
          setSelectedDbId("")
          setEnvPrefix(DEFAULT_DATABASE_ENV_PREFIX)
          onClose()
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link database</DialogTitle>
          <DialogDescription>
            Inject database connection variables into this app at deploy time.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="db-select">Database</Label>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">
                Loading databases...
              </div>
            ) : runningDbs.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No running databases in this project.
              </div>
            ) : (
              <Select value={selectedDbId} onValueChange={setSelectedDbId}>
                <SelectTrigger id="db-select">
                  <SelectValue placeholder="Select a database" />
                </SelectTrigger>
                <SelectContent>
                  {runningDbs.map((db: Database) => (
                    <SelectItem key={db.id} value={db.id}>
                      {db.name} ({db.kind})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="env-prefix">Variable prefix</Label>
            <Input
              id="env-prefix"
              value={envPrefix}
              onChange={(e) => {
                const v = e.target.value.toUpperCase()
                setEnvPrefix(v)
                if (v) validatePrefix(v)
              }}
              placeholder={DEFAULT_DATABASE_ENV_PREFIX}
            />
            {prefixError && (
              <span className="text-xs text-destructive">{prefixError}</span>
            )}
            <span className="text-xs text-muted-foreground">
              Generates <code>{"${prefix}_URL"}</code>,{" "}
              <code>{"${prefix}_HOST"}</code>, etc. Default{" "}
              <code>DATABASE</code> gives the app <code>DATABASE_URL</code>.
            </span>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !selectedDbId || runningDbs.length === 0}
            >
              {isPending ? "Linking..." : "Link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
