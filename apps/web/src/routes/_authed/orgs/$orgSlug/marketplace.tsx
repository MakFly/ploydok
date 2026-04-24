// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import {
  RiExternalLinkLine,
  RiFileCopyLine,
  RiSearchLine,
  RiShapesLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"
import { useCurrentOrganization } from "../../../../lib/organizations"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/marketplace")({
  component: MarketplacePage,
})

const DOKPLOY_BASE_URL = "https://templates.dokploy.com"

interface TemplateMetadata {
  id: string
  name: string
  description: string
  version: string
  logo: string
  tags: string[]
  links: {
    github: string
    website?: string
    docs?: string
  }
}

interface TemplateDetail {
  templateToml: string
  dockerCompose: string
}

async function fetchCatalog(): Promise<Array<TemplateMetadata>> {
  const res = await fetch(`${DOKPLOY_BASE_URL}/meta.json`)
  if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`)
  const data = (await res.json()) as Array<TemplateMetadata>
  return data
}

async function fetchTemplateDetail(id: string): Promise<TemplateDetail> {
  const [tomlRes, composeRes] = await Promise.all([
    fetch(`${DOKPLOY_BASE_URL}/blueprints/${id}/template.toml`),
    fetch(`${DOKPLOY_BASE_URL}/blueprints/${id}/docker-compose.yml`),
  ])
  if (!tomlRes.ok || !composeRes.ok) {
    throw new Error("Template files not found")
  }
  const [templateToml, dockerCompose] = await Promise.all([
    tomlRes.text(),
    composeRes.text(),
  ])
  return { templateToml, dockerCompose }
}

function useCatalog() {
  return useQuery({
    queryKey: ["marketplace", "catalog"],
    queryFn: fetchCatalog,
    staleTime: 10 * 60 * 1000,
  })
}

function useTemplateDetail(id: string | null) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ["marketplace", "template", id],
    queryFn: () => fetchTemplateDetail(id as string),
    staleTime: 10 * 60 * 1000,
  })
}

function MarketplacePage(): React.JSX.Element {
  const organization = useCurrentOrganization()
  const { data: catalog = [], isLoading, error } = useCatalog()
  const [query, setQuery] = React.useState("")
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((tpl) => {
      if (tpl.name.toLowerCase().includes(q)) return true
      if (tpl.description.toLowerCase().includes(q)) return true
      if (tpl.tags?.some((tag) => tag.toLowerCase().includes(q))) return true
      return false
    })
  }, [catalog, query])

  const activeTemplate = activeId
    ? (catalog.find((tpl) => tpl.id === activeId) ?? null)
    : null

  return (
    <ShellPage
      title="Marketplace"
      description="Déploie n'importe quel service Docker (bases, outils, apps open-source) à partir du catalogue communautaire."
      eyebrow={organization?.name ?? "Workspace"}
    >
      <ShellPanel
        title="Templates"
        description="Catalogue Dokploy — services prêts à l'emploi avec docker-compose + variables prégénérées."
        action={
          <div className="relative w-64">
            <RiSearchLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un service…"
              className="pl-9"
              aria-label="Rechercher un template"
            />
          </div>
        }
      >
        {isLoading ? (
          <CatalogSkeleton />
        ) : error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            Impossible de charger le catalogue ({(error as Error).message}).
          </p>
        ) : filtered.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                onOpen={() => setActiveId(tpl.id)}
              />
            ))}
          </div>
        )}
      </ShellPanel>

      <TemplateDialog
        template={activeTemplate}
        onClose={() => setActiveId(null)}
      />
    </ShellPage>
  )
}

interface TemplateCardProps {
  template: TemplateMetadata
  onOpen: () => void
}

function TemplateCard({
  template,
  onOpen,
}: TemplateCardProps): React.JSX.Element {
  const logoUrl = template.logo
    ? `${DOKPLOY_BASE_URL}/blueprints/${template.id}/${template.logo}`
    : null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors outline-none hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="size-10 object-contain"
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = "none"
              }}
            />
          ) : (
            <RiShapesLine className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{template.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            v{template.version}
          </p>
        </div>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {template.description}
      </p>
      {template.tags?.length ? (
        <div className="mt-auto flex flex-wrap gap-1">
          {template.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  )
}

function CatalogSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, idx) => (
        <div
          key={idx}
          className="flex h-32 flex-col gap-3 rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-3">
            <span className="size-10 shrink-0 animate-pulse rounded-md bg-muted" />
            <div className="flex-1 space-y-2">
              <span className="block h-3 w-24 animate-pulse rounded bg-muted" />
              <span className="block h-2 w-12 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <span className="block h-2 w-full animate-pulse rounded bg-muted" />
          <span className="block h-2 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ query }: { query: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <RiShapesLine className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">Aucun template trouvé</p>
      <p className="text-xs text-muted-foreground">
        {query
          ? `Rien ne correspond à « ${query} ».`
          : "Le catalogue est vide pour le moment."}
      </p>
    </div>
  )
}

interface TemplateDialogProps {
  template: TemplateMetadata | null
  onClose: () => void
}

function TemplateDialog({
  template,
  onClose,
}: TemplateDialogProps): React.JSX.Element {
  const { data, isLoading, error } = useTemplateDetail(template?.id ?? null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async (): Promise<void> => {
    if (!data?.dockerCompose) return
    try {
      await navigator.clipboard.writeText(data.dockerCompose)
      setCopied(true)
    } catch {
      // ignore clipboard failure
    }
  }

  return (
    <Dialog
      open={Boolean(template)}
      onOpenChange={(open) => (!open ? onClose() : null)}
    >
      <DialogContent className="sm:max-w-3xl">
        {template ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {template.name}
                <span className="text-xs font-normal text-muted-foreground">
                  v{template.version}
                </span>
              </DialogTitle>
              <DialogDescription>{template.description}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap gap-2 text-xs">
              {template.tags?.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-muted px-2 py-0.5 text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              Installation automatique <strong>bientôt disponible</strong>. Pour
              l'instant, copie la docker-compose et déploie-la via ton runtime
              Docker — aucun service Ploydok existant n'est impacté.
            </div>

            <div className="flex min-h-[12rem] flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  docker-compose.yml
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopy()}
                  disabled={!data?.dockerCompose}
                >
                  <RiFileCopyLine className="size-4" />
                  {copied ? "Copié" : "Copier"}
                </Button>
              </div>
              {isLoading ? (
                <div className="h-40 animate-pulse rounded-md bg-muted" />
              ) : error ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  Impossible de charger les fichiers du template (
                  {(error as Error).message}).
                </p>
              ) : (
                <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
                  <code>{data?.dockerCompose ?? ""}</code>
                </pre>
              )}
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {template.links?.github ? (
                  <a
                    href={template.links.github}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-xs hover:bg-accent"
                  >
                    <RiExternalLinkLine className="size-3.5" />
                    GitHub
                  </a>
                ) : null}
                {template.links?.website ? (
                  <a
                    href={template.links.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-xs hover:bg-accent"
                  >
                    <RiExternalLinkLine className="size-3.5" />
                    Site
                  </a>
                ) : null}
                {template.links?.docs ? (
                  <a
                    href={template.links.docs}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-xs hover:bg-accent"
                  >
                    <RiExternalLinkLine className="size-3.5" />
                    Docs
                  </a>
                ) : null}
              </div>
              <Button type="button" variant="outline" onClick={onClose}>
                Fermer
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
