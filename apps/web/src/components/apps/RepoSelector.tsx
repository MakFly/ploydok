// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import { useGitHubAppConfig, useGitHubRepos } from "../../lib/github";
import type { GitRepo } from "@ploydok/shared";

interface RepoSelectorProps {
  selected?: GitRepo | null;
  onSelect: (repo: GitRepo) => void;
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export function RepoSelector({ selected, onSelect }: RepoSelectorProps): React.JSX.Element {
  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebounce(search, 200);

  const { data: appConfig } = useGitHubAppConfig();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useGitHubRepos({ search: debouncedSearch || undefined });

  if (!appConfig?.configured) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          Set up the GitHub App first to browse repositories.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { window.location.href = "/settings/github"; }}
        >
          Set up GitHub App
        </Button>
      </div>
    );
  }

  const repos = data?.pages.flatMap((p) => p.repos) ?? [];

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Search repositories..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Search repositories"
      />

      {isLoading ? (
        <RepoListSkeleton />
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          Failed to load repositories: {error.message}
        </p>
      ) : repos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {debouncedSearch ? `No repositories found matching "${debouncedSearch}".` : "No repositories found."}
        </p>
      ) : (
        <ul
          className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border"
          role="listbox"
          aria-label="Repositories"
        >
          {repos.map((repo) => (
            <RepoItem
              key={repo.id}
              repo={repo}
              isSelected={selected?.fullName === repo.fullName}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}

      {hasNextPage && (
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface RepoItemProps {
  repo: GitRepo;
  isSelected: boolean;
  onSelect: (repo: GitRepo) => void;
}

function RepoItem({ repo, isSelected, onSelect }: RepoItemProps): React.JSX.Element {
  const [owner, repoName] = repo.fullName.split("/");

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
      <div className="size-8 shrink-0 overflow-hidden rounded-full bg-muted">
        <img
          src={`https://github.com/${owner}.png?size=32`}
          alt={owner}
          className="size-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{repoName}</span>
          <span className="text-xs text-muted-foreground shrink-0">{owner}</span>
          {repo.private && (
            <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              private
            </span>
          )}
        </div>
        {repo.description && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{repo.description}</p>
        )}
      </div>
      {isSelected && (
        <CheckIcon className="size-4 shrink-0 text-primary mt-0.5" />
      )}
    </li>
  );
}

function RepoListSkeleton(): React.JSX.Element {
  return (
    <ul className="rounded-md border border-border divide-y divide-border animate-pulse">
      {[...Array<null>(4)].map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="size-8 rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-40 rounded bg-muted" />
            <div className="h-3 w-64 rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
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
  );
}
