// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useRouter, useMatches } from "@tanstack/react-router"
import {
  RiApps2Line,
  RiShip2Line,
  RiDashboardLine,
  RiGithubLine,
  RiPulseLine,
  RiRocketLine,
  RiShieldCheckLine,
  RiStopCircleLine,
  RiTerminalBoxLine,
} from "@remixicon/react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import { useApps } from "../../lib/apps"
import { useDeployApp, useStopApp } from "../../lib/apps-mutations"
import { useCommandPaletteContext } from "../../lib/hooks/command-palette-context"
import { organizationPath, useCurrentOrganization, useCurrentOrganizationSlug } from "../../lib/organizations"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavEntry {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  to: string
  params?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Pure filter helper — exported for unit tests
// ---------------------------------------------------------------------------

export interface FilterableItem {
  id: string
  label: string
}

export function matchesQuery(item: FilterableItem, query: string): boolean {
  if (query.trim() === "") return true
  return item.label.toLowerCase().includes(query.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// Static navigation items
// ---------------------------------------------------------------------------

const NAV_ITEMS: Array<NavEntry> = [
  { id: "nav-dashboard", label: "Dashboard", icon: RiDashboardLine, to: "/dashboard" },
  { id: "nav-apps", label: "Applications", icon: RiApps2Line, to: "/apps" },
  { id: "nav-monitoring", label: "Monitoring", icon: RiPulseLine, to: "/monitoring" },
  { id: "nav-settings", label: "Settings — Overview", icon: RiShieldCheckLine, to: "/settings" },
  { id: "nav-settings-security", label: "Settings — Security", icon: RiShieldCheckLine, to: "/settings/security" },
  { id: "nav-settings-git-providers", label: "Settings — Git providers", icon: RiGithubLine, to: "/settings/git-providers" },
  { id: "nav-settings-github", label: "Settings — GitHub", icon: RiGithubLine, to: "/settings/git-providers/github" },
  { id: "nav-settings-gitlab", label: "Settings — GitLab", icon: RiGithubLine, to: "/settings/git-providers/gitlab" },
  { id: "nav-settings-registry", label: "Settings — Registry", icon: RiShip2Line, to: "/settings/registry" },
]

// ---------------------------------------------------------------------------
// CurrentAppActions — quick actions when an app route is active
// Mounted only when palette is open (lazy) so mutations don't subscribe
// to the events stream until the user actually needs them.
// ---------------------------------------------------------------------------

interface CurrentAppActionsProps {
  appId: string
  onClose: () => void
}

function CurrentAppActions({ appId, onClose }: CurrentAppActionsProps): React.JSX.Element {
  const currentOrgSlug = useCurrentOrganizationSlug()
  const deploy = useDeployApp(appId)
  const stop = useStopApp(appId)
  const router = useRouter()

  const handleDeploy = () => {
    deploy.mutate()
    onClose()
  }

  const handleStop = () => {
    stop.mutate()
    onClose()
  }

  const handleLogs = () => {
    void router.navigate({
      href: currentOrgSlug ? organizationPath(currentOrgSlug, `apps/${appId}/logs`) : `/apps/${appId}/logs`,
    })
    onClose()
  }

  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Current app">
        <CommandItem onSelect={handleDeploy}>
          <RiRocketLine className="size-4" />
          Deploy current app
        </CommandItem>
        <CommandItem onSelect={handleStop}>
          <RiStopCircleLine className="size-4" />
          Stop current app
        </CommandItem>
        <CommandItem onSelect={handleLogs}>
          <RiTerminalBoxLine className="size-4" />
          View logs
        </CommandItem>
      </CommandGroup>
    </>
  )
}

// ---------------------------------------------------------------------------
// CommandPaletteContent — the dynamic, query-dependent part.
// Only mounted when the palette is open, so useApps / useMatches / mutations
// never subscribe while the palette sits idle. Prevents SSR-hydration races
// that surface as "Cannot read properties of undefined (reading 'subscribe')".
// ---------------------------------------------------------------------------

interface CommandPaletteContentProps {
  onClose: () => void
}

function CommandPaletteContent({ onClose }: CommandPaletteContentProps): React.JSX.Element {
  const router = useRouter()
  const matches = useMatches()
  const organization = useCurrentOrganization()
  const currentOrgSlug = useCurrentOrganizationSlug()
  const { data: apps } = useApps(organization?.id)

  const currentAppMatch = matches.find(
    (m) => m.routeId === "/_authed/orgs/$orgSlug/apps/$id"
  )
  const currentAppId = currentAppMatch
    ? (currentAppMatch.params as { id?: string }).id
    : undefined

  const handleNavSelect = React.useCallback(
    (to: string, params?: Record<string, string>) => {
      void router.navigate({ to, params } as Parameters<typeof router.navigate>[0])
      onClose()
    },
    [router, onClose],
  )

  return (
    <>
      {apps && apps.length > 0 ? (
        <CommandGroup heading="Applications">
          {apps.map((app) => (
            <CommandItem
              key={app.id}
              value={`app-${app.name}-${app.slug}`}
              onSelect={() =>
                handleNavSelect(
                  currentOrgSlug ? organizationPath(currentOrgSlug, `apps/${app.id}/overview`) : "/apps/$id/overview",
                  currentOrgSlug ? undefined : { id: app.id },
                )
              }
            >
              <RiApps2Line className="size-4" />
              <span>Go to {app.name}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {app.status}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      <CommandSeparator />

      <CommandGroup heading="Navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const target =
            currentOrgSlug && (item.id === "nav-dashboard" || item.id === "nav-apps")
              ? organizationPath(currentOrgSlug, item.id === "nav-dashboard" ? "dashboard" : "apps")
              : item.to
          return (
            <CommandItem
              key={item.id}
              value={`nav-${item.label}`}
              onSelect={() => handleNavSelect(target, item.params)}
            >
              <Icon className="size-4" />
              {item.label}
            </CommandItem>
          )
        })}
      </CommandGroup>

      {currentAppId ? (
        <CurrentAppActions appId={currentAppId} onClose={onClose} />
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// CommandPalette — shell, always mounted, cheap when closed.
// ---------------------------------------------------------------------------

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps): React.JSX.Element {
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search apps, navigate, or run an action…" />
      <CommandList>
        <CommandEmpty>
          <span className="text-muted-foreground text-sm">No results found.</span>
        </CommandEmpty>

        {open ? <CommandPaletteContent onClose={close} /> : null}
      </CommandList>

      <div className="flex items-center justify-end border-t px-3 py-2">
        <span className="text-muted-foreground font-mono text-[10px]">
          ↑↓ navigate · ↵ select · ESC close
        </span>
      </div>
    </CommandDialog>
  )
}

// ---------------------------------------------------------------------------
// CommandPaletteRoot — consumes the shared context from CommandPaletteProvider
// so the header CommandBar and the palette share one open/close state.
// ---------------------------------------------------------------------------

export function CommandPaletteRoot(): React.JSX.Element {
  const { open, setOpen } = useCommandPaletteContext()
  return <CommandPalette open={open} onOpenChange={setOpen} />
}
