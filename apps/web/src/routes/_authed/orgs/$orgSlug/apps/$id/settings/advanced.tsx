// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import {
  CaddyExtraHandlersSchema,
  type CaddyExtraHandlers,
} from "@ploydok/shared"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import {
  useAppCaddyExtra,
  useUpdateAppCaddyExtra,
} from "../../../../../../../lib/apps"

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/settings/advanced"
)({
  component: AdvancedSettingsPage,
})

function AdvancedSettingsPage() {
  const { id: appId } = Route.useParams()
  const { data, isLoading } = useAppCaddyExtra(appId)
  const updateMutation = useUpdateAppCaddyExtra()

  const [jsonText, setJsonText] = useState(
    data?.handlers ? JSON.stringify(data.handlers, null, 2) : ""
  )
  const [validationError, setValidationError] = useState<string | null>(null)

  const validateJson = (text: string) => {
    if (!text.trim()) {
      setValidationError(null)
      return true
    }

    try {
      const parsed = JSON.parse(text)
      const result = CaddyExtraHandlersSchema.safeParse(parsed)
      if (!result.success) {
        setValidationError(result.error.message)
        return false
      }
      setValidationError(null)
      return true
    } catch (err) {
      setValidationError(String(err))
      return false
    }
  }

  const handleJsonChange = (value: string) => {
    setJsonText(value)
    validateJson(value)
  }

  const handleSave = async () => {
    let handlers: CaddyExtraHandlers | null = null

    if (jsonText.trim()) {
      try {
        const parsed = JSON.parse(jsonText)
        const result = CaddyExtraHandlersSchema.safeParse(parsed)
        if (!result.success) {
          setValidationError(result.error.message)
          return
        }
        handlers = result.data
      } catch (err) {
        setValidationError(String(err))
        return
      }
    }

    await updateMutation.mutateAsync({ appId, handlers })
    setJsonText(handlers ? JSON.stringify(handlers, null, 2) : "")
  }

  if (isLoading) {
    return <div className="p-4">Loading...</div>
  }

  const isValid = validationError === null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-lg font-semibold">Caddy Extra Handlers</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Add custom Caddy handlers (headers, rewrite, redir, static_response,
          request_body, vars) to your app route. Learn more in the{" "}
          <a
            href="https://caddyserver.com/docs/json/apps/http/servers/routes/handle/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
          >
            Caddy documentation
          </a>
          .
        </p>
      </div>

      <Alert variant="destructive" className="border-orange-200 bg-orange-50">
        <AlertDescription className="text-sm text-orange-800">
          <strong>⚠️ Warning:</strong> An invalid config can break your app
          routing. The config is automatically validated server-side, but manual
          rollback may be necessary if Caddy refuses the JSON.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <label className="block text-sm font-medium">JSON Configuration</label>
        <Textarea
          value={jsonText}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            handleJsonChange(e.target.value)
          }
          placeholder={`[\n  { "handler": "headers", "response": { "headers": { "X-Custom": ["value"] } } }\n]`}
          className="h-64 font-mono text-sm"
        />
        {validationError && (
          <div className="text-sm text-destructive">
            <strong>Validation error:</strong> {validationError}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={!isValid || updateMutation.isPending}
          className="w-fit"
        >
          {updateMutation.isPending ? "Saving..." : "Save"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setJsonText(
              data?.handlers ? JSON.stringify(data.handlers, null, 2) : ""
            )
            setValidationError(null)
          }}
          className="w-fit"
        >
          Reset
        </Button>
      </div>
    </div>
  )
}
