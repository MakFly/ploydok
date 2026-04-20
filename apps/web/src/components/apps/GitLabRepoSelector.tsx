// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import { useGitLabConfig, useGitLabRepos } from "../../lib/gitlab"
import type { GitRepo } from "@ploydok/shared"

interface GitLabRepoSelectorProps {
  selected?: GitRepo | null
  onSelect: (repo: GitRepo) => void
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState<T>(value)

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

export function GitLabRepoSelector({
  selected,
  onSelect,
}: GitLabRepoSelectorProps): React.JSX.Element {
  const [search, setSearch] = React.useState("")
  const debouncedSearch = useDebounce(search, 200)

  const { data: config } = useGitLabConfig()
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useGitLabRepos({ search: debouncedSearch || undefined })

  if (!config?.configured) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Configure GitLab d'abord pour lister les projets.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            window.location.href = "/settings/git-providers/gitlab"
          }}
        >
          Configurer GitLab
        </Button>
      </div>
    )
  }

  const repos = data?.pages.flatMap((p) => p.repos) ?? []

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Rechercher un projet GitLab..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Search GitLab projects"
      />

      {isLoading ? (
        <RepoListSkeleton />
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          Failed to load projects: {error.message}
        </p>
      ) : repos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {debouncedSearch
            ? `Aucun projet ne correspond à « ${debouncedSearch} ».`
            : "Aucun projet trouvé."}
        </p>
      ) : (
        <ul
          className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border"
          role="listbox"
          aria-label="GitLab projects"
        >
          {repos.map((repo) => (
            <RepoItem
              key={String(repo.id)}
              repo={repo}
              isSelected={selected?.fullName === repo.fullName}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}

      {hasNextPage ? (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface RepoItemProps {
  repo: GitRepo
  isSelected: boolean
  onSelect: (repo: GitRepo) => void
}

function RepoItem({ repo, isSelected, onSelect }: RepoItemProps): React.JSX.Element {
  const parts = repo.fullName.split("/")
  const repoName = parts.at(-1) ?? repo.fullName
  const namespace = parts.slice(0, -1).join("/")

  return (
    <li
      role="option"
      aria-selected={isSelected}
      className={[
        "flex cursor-pointer items-start gap-3 px-3 py-3 text-sm transition-colors hover:bg-muted",
        isSelected ? "bg-primary/10" : "",
      ].join(" ")}
      onClick={() => onSelect(repo)}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] uppercase text-muted-foreground">
        {repoName.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{repoName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{namespace}</span>
          {repo.private ? (
            <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              private
            </span>
          ) : null}
        </div>
        {repo.description ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {repo.description}
          </p>
        ) : null}
      </div>
      {isSelected ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
    </li>
  )
}

function RepoListSkeleton(): React.JSX.Element {
  return (
    <ul className="animate-pulse divide-y divide-border rounded-md border border-border">
      {[...Array<null>(4)].map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="size-8 rounded-md bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-40 rounded bg-muted" />
            <div className="h-3 w-64 rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function CheckIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
