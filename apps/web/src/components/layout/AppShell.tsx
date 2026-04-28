// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Link,
  useMatches,
  useRouter,
  useRouterState,
} from "@tanstack/react-router"
import {
  RiAddLine,
  RiApps2Line,
  RiArchiveLine,
  RiArrowUpDownLine,
  RiBookOpenLine,
  RiCloseLine,
  RiCodeBoxLine,
  RiDashboardLine,
  RiDatabase2Line,
  RiFileListLine,
  RiKey2Line,
  RiKeyLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiMoonLine,
  RiNotificationLine,
  RiPlugLine,
  RiPriceTagLine,
  RiPulseLine,
  RiRocketLine,
  RiSearchLine,
  RiSendPlane2Line,
  RiSettings3Line,
  RiShapesLine,
  RiShieldCheckLine,
  RiSidebarFoldLine,
  RiStackLine,
  RiSunLine,
  RiTeamLine,
  RiTimerLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { resolveDisplayedAppState } from "../../lib/app-runtime"
import { useApp } from "../../lib/apps"
import { useLogout, useMe } from "../../lib/auth"
import {
  CommandPaletteProvider,
  useCommandPaletteContext,
} from "../../lib/hooks/command-palette-context"
import { useUnseenRelease } from "../../lib/hooks/use-unseen-release"
import { useMonitoring } from "../../lib/monitoring"
import {
  organizationDashboardPath,
  organizationPath,
  replaceOrganizationInPath,
  useCreateOrganization,
  useCurrentOrganization,
  useCurrentOrganizationSlug,
  useOrganizations,
} from "../../lib/organizations"
import { AppStatusBadge } from "../apps/AppStatusBadge"
import { useTheme } from "../theme/ThemeToggle"
import { CommandBar } from "./CommandBar"
import { CommandPaletteRoot } from "./CommandPalette"
import { NotificationBell } from "./NotificationBell"
import {
  extractAppId,
  extractAppName,
  extractAppStatus,
  resolveTopbarBreadcrumb,
} from "./topbar-breadcrumb"
import type { AppStatus, OrganizationSummary } from "@ploydok/shared"

interface AppShellProps {
  children: React.ReactNode
  banner?: React.ReactNode
}

interface ShellPageProps {
  title: string
  description?: string
  eyebrow?: string
  actions?: React.ReactNode
  children: React.ReactNode
}

interface ShellPanelProps {
  title?: string
  description?: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

interface NavItem {
  label: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  orgPathSuffix?: string
  rootSettingsPathSuffix?: string
  fallbackHref?: string
  comingSoon?: boolean
  tooltip?: string
}

interface ResolvedNavItem {
  label: string
  icon: React.ComponentType<{ className?: string }>
  to?: string
  comingSoon?: boolean
  tooltip?: string
}

const workspaceNav: Array<NavItem> = [
  {
    label: "Dashboard",
    icon: RiDashboardLine,
    orgPathSuffix: "dashboard",
    fallbackHref: "/dashboard",
  },
  {
    label: "Applications",
    icon: RiApps2Line,
    orgPathSuffix: "apps",
    fallbackHref: "/apps",
  },
  {
    label: "Databases",
    icon: RiDatabase2Line,
    orgPathSuffix: "databases",
    fallbackHref: "/databases",
  },
  { label: "Services", icon: RiCodeBoxLine, orgPathSuffix: "services" },
  { label: "Deployments", icon: RiRocketLine, orgPathSuffix: "deployments" },
  { label: "Marketplace", icon: RiShapesLine, orgPathSuffix: "marketplace" },
  {
    label: "Templates",
    icon: RiStackLine,
    comingSoon: true,
    tooltip: "Templates Compose — coming soon.",
  },
  { label: "Monitoring", icon: RiPulseLine, orgPathSuffix: "monitoring" },
]

const platformNav: Array<NavItem> = [
  { label: "Members", icon: RiTeamLine, orgPathSuffix: "members" },
  { label: "Audit", icon: RiFileListLine, orgPathSuffix: "audit" },
  {
    label: "Shared env",
    icon: RiKeyLine,
    comingSoon: true,
    tooltip: "Backend ready, UI not wired yet — coming soon.",
  },
  {
    label: "Scheduled jobs",
    icon: RiTimerLine,
    comingSoon: true,
    tooltip: "Read-only API only — full UI coming soon.",
  },
  {
    label: "Event webhooks",
    icon: RiSendPlane2Line,
    comingSoon: true,
    tooltip: "Read-only API only — full UI coming soon.",
  },
  {
    label: "Tags",
    icon: RiPriceTagLine,
    comingSoon: true,
    tooltip: "Cross-resource tagging — coming soon.",
  },
]

const integrationsNav: Array<NavItem> = [
  {
    label: "Git providers",
    icon: RiPlugLine,
    rootSettingsPathSuffix: "git-providers",
  },
  {
    label: "Registry",
    icon: RiArchiveLine,
    rootSettingsPathSuffix: "registry",
  },
  {
    label: "Notifications",
    icon: RiNotificationLine,
    rootSettingsPathSuffix: "notifications",
  },
  {
    label: "API tokens",
    icon: RiKey2Line,
    comingSoon: true,
    tooltip: "Personal Access Tokens — coming soon.",
  },
]

const accountNav: Array<NavItem> = [
  { label: "Guide", icon: RiBookOpenLine, href: "/guide" },
  { label: "Settings", icon: RiSettings3Line, href: "/settings" },
]

function resolveNavItem(
  item: NavItem,
  currentOrgSlug: string | null
): ResolvedNavItem {
  if (item.comingSoon) {
    return {
      label: item.label,
      icon: item.icon,
      comingSoon: true,
      tooltip: item.tooltip,
    }
  }
  if (item.href) {
    return { label: item.label, icon: item.icon, to: item.href }
  }
  if (item.rootSettingsPathSuffix) {
    return {
      label: item.label,
      icon: item.icon,
      to: `/settings/${item.rootSettingsPathSuffix}`,
    }
  }
  if (item.orgPathSuffix) {
    if (currentOrgSlug) {
      return {
        label: item.label,
        icon: item.icon,
        to: organizationPath(currentOrgSlug, item.orgPathSuffix),
      }
    }
    if (item.fallbackHref) {
      return { label: item.label, icon: item.icon, to: item.fallbackHref }
    }
    return {
      label: item.label,
      icon: item.icon,
      comingSoon: true,
      tooltip: "Sélectionne un workspace",
    }
  }
  return { label: item.label, icon: item.icon }
}

const STORAGE_KEY = "ploydok.sidebar.state"
const CREATE_WORKSPACE_VALUE = "__create_workspace__"

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}

const APP_LOGS_RE = /^\/(?:orgs\/[^/]+\/)?apps\/[^/]+\/logs(\/|$)/
const APP_DETAIL_RE = /^\/(?:orgs\/[^/]+\/)?apps\/[^/]+(\/|$)/

function resolveWrapperClass(pathname: string): string {
  if (APP_LOGS_RE.test(pathname)) return "overflow-hidden"
  if (APP_DETAIL_RE.test(pathname)) return "overflow-y-auto"
  return "gap-4 overflow-y-auto p-4 md:p-8"
}

function isNavActive(pathname: string, target: string): boolean {
  if (target === "/dashboard") return pathname === "/dashboard"
  return pathname === target || pathname.startsWith(`${target}/`)
}

function useSidebarState(): {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  toggle: () => void
} {
  const [open, setOpen] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return true
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== "collapsed"
    } catch {
      return true
    }
  })

  React.useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? "expanded" : "collapsed")
    } catch {
      // ignore
    }
  }, [open])

  const toggle = React.useCallback(() => {
    setOpen((prev) => !prev)
  }, [])

  return { open, setOpen, toggle }
}

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (organization: OrganizationSummary) => Promise<void> | void
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateWorkspaceDialogProps): React.JSX.Element {
  const createOrganization = useCreateOrganization()
  const [name, setName] = React.useState("")
  const wasOpenRef = React.useRef(open)

  React.useEffect(() => {
    if (open || !wasOpenRef.current) {
      wasOpenRef.current = open
      return
    }

    setName("")
    createOrganization.reset()
    wasOpenRef.current = open
  }, [open])

  const trimmedName = name.trim()

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!trimmedName || createOrganization.isPending) return

    try {
      const organization = await createOrganization.mutateAsync({
        name: trimmedName,
      })
      setName("")
      onOpenChange(false)
      await onCreated(organization)
    } catch {
      return
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Add a new isolated workspace for a separate set of apps and
            databases.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <Field data-invalid={Boolean(createOrganization.error)}>
              <FieldContent>
                <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
                <FieldDescription>
                  This name is used to generate the workspace slug
                  automatically.
                </FieldDescription>
              </FieldContent>
              <Input
                id="workspace-name"
                value={name}
                autoFocus
                aria-invalid={Boolean(createOrganization.error)}
                placeholder="Acme"
                onChange={(event) => setName(event.target.value)}
              />
              <FieldError>{createOrganization.error?.message}</FieldError>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createOrganization.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createOrganization.isPending || !trimmedName}
            >
              {createOrganization.isPending
                ? "Creating..."
                : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AppShell({
  children,
  banner,
}: AppShellProps): React.JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { data: me, isPending: meLoading } = useMe()
  const { data: organizations = [], isPending: orgsLoading } =
    useOrganizations()
  const currentOrganization = useCurrentOrganization()
  const workspaceLoading = !currentOrganization && (meLoading || orgsLoading)
  const currentOrgSlug = useCurrentOrganizationSlug()
  const logout = useLogout()
  const router = useRouter()
  const {
    mode: themeMode,
    resolved: resolvedTheme,
    toggle: toggleTheme,
  } = useTheme()
  const {
    open: sidebarOpen,
    setOpen: setSidebarOpen,
    toggle: toggleSidebar,
  } = useSidebarState()
  const {
    unseen: unseenRelease,
    markSeen: markReleaseSeen,
    version,
  } = useUnseenRelease()
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [workspaceSelectOpen, setWorkspaceSelectOpen] = React.useState(false)
  const [openWorkspaceSelectOnExpand, setOpenWorkspaceSelectOnExpand] =
    React.useState(false)
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = React.useState(false)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  React.useEffect(() => {
    setProfileOpen(false)
    setWorkspaceSelectOpen(false)
    setMobileNavOpen(false)
  }, [pathname])

  React.useEffect(() => {
    if (typeof window === "undefined" || !mobileNavOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMobileNavOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobileNavOpen])

  React.useEffect(() => {
    if (
      !sidebarOpen ||
      !openWorkspaceSelectOnExpand ||
      typeof window === "undefined"
    )
      return
    const frame = window.requestAnimationFrame(() => {
      setWorkspaceSelectOpen(true)
      setOpenWorkspaceSelectOnExpand(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [openWorkspaceSelectOnExpand, sidebarOpen])

  React.useEffect(() => {
    if (sidebarOpen) return
    setWorkspaceSelectOpen(false)
  }, [sidebarOpen])

  const displayName = me?.display_name ?? "Workspace Owner"
  const email = me?.email ?? "hello@ploydok.dev"
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  const availableOrganizations = React.useMemo(() => {
    const rows = [...organizations]
    if (
      currentOrganization &&
      !rows.some((organization) => organization.id === currentOrganization.id)
    ) {
      rows.unshift(currentOrganization)
    }
    return rows
  }, [currentOrganization, organizations])

  const handleLogout = async (): Promise<void> => {
    await logout.mutateAsync()
    void router.navigate({ to: "/login" })
  }

  const expanded = sidebarOpen || mobileNavOpen
  const state = expanded ? "expanded" : "collapsed"
  const brandTarget = currentOrgSlug
    ? organizationDashboardPath(currentOrgSlug)
    : "/dashboard"
  const navGroups: Array<{ title: string; items: Array<ResolvedNavItem> }> = [
    {
      title: "Workspace",
      items: workspaceNav.map((item) => resolveNavItem(item, currentOrgSlug)),
    },
    {
      title: "Platform",
      items: platformNav.map((item) => resolveNavItem(item, currentOrgSlug)),
    },
    {
      title: "Integrations",
      items: integrationsNav.map((item) =>
        resolveNavItem(item, currentOrgSlug)
      ),
    },
  ]
  const accountNavItems = accountNav.map((item) =>
    resolveNavItem(item, currentOrgSlug)
  )

  const handleOrganizationChange = async (nextSlug: string): Promise<void> => {
    if (!nextSlug || nextSlug === currentOrgSlug) return
    await router.navigate({
      href: replaceOrganizationInPath(pathname, nextSlug),
    })
  }

  const handleWorkspaceSelect = (nextValue: string): void => {
    if (nextValue === CREATE_WORKSPACE_VALUE) {
      setWorkspaceSelectOpen(false)
      setCreateWorkspaceOpen(true)
      return
    }
    void handleOrganizationChange(nextValue)
  }

  const handleCollapsedWorkspaceClick = (): void => {
    if (sidebarOpen) {
      setWorkspaceSelectOpen(true)
      return
    }
    setSidebarOpen(true)
    setOpenWorkspaceSelectOnExpand(true)
  }

  const handleWorkspaceCreated = async (
    organization: OrganizationSummary
  ): Promise<void> => {
    setWorkspaceSelectOpen(false)
    await router.navigate({
      href: organizationDashboardPath(organization.slug),
    })
  }

  const wrapperStyle: React.CSSProperties = {
    ["--sidebar-width" as string]: "16rem",
    ["--sidebar-width-icon" as string]: "3rem",
    ["--sidebar-inset-radius" as string]: "calc(var(--radius) * 4)",
    ["--sidebar-animation-duration" as string]: "300ms",
    ["--sidebar-animation-ease" as string]: "cubic-bezier(0.32, 0.72, 0, 1)",
  }

  return (
    <CommandPaletteProvider>
      <div
        data-sidebar-state={state}
        style={wrapperStyle}
        className="group/shell flex h-svh w-full overflow-hidden bg-sidebar/50 text-sidebar-foreground"
      >
        {/* Mobile backdrop */}
        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          />
        ) : null}

        {/* Sidebar (peer) */}
        <div
          data-slot="sidebar"
          data-state={state}
          data-collapsible={state === "collapsed" ? "icon" : ""}
          data-variant="inset"
          data-mobile-open={mobileNavOpen ? "true" : "false"}
          className="peer"
        >
          {/* Gap: reserves horizontal space on desktop only */}
          <div
            aria-hidden
            className={cx(
              "relative hidden h-svh shrink-0 bg-transparent md:block",
              "w-[var(--sidebar-width)] transition-[width] duration-(--sidebar-animation-duration) ease-(--sidebar-animation-ease)",
              "group-data-[sidebar-state=collapsed]/shell:w-[calc(var(--sidebar-width-icon)+1rem)]"
            )}
          />

          {/* Container: fixed positioned. Drawer on mobile, persistent on md+. */}
          <div
            className={cx(
              "fixed inset-y-0 left-0 z-50 flex h-svh p-2 md:z-10",
              "w-[min(18rem,85vw)] md:w-[var(--sidebar-width)]",
              "max-md:border-r max-md:border-sidebar-border max-md:bg-sidebar max-md:shadow-2xl",
              "transition-transform duration-(--sidebar-animation-duration) ease-(--sidebar-animation-ease)",
              "md:transition-[width]",
              mobileNavOpen
                ? "translate-x-0"
                : "-translate-x-full md:translate-x-0",
              "group-data-[sidebar-state=collapsed]/shell:md:w-[calc(var(--sidebar-width-icon)+1rem)]"
            )}
          >
            <div className="flex size-full flex-col">
              {/* Header */}
              <div className="flex h-14 flex-row items-center p-2">
                {expanded ? (
                  <>
                    <Link
                      to={brandTarget as never}
                      className="flex h-10 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm outline-none hover:bg-sidebar-accent"
                      aria-label="Ploydok"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-primary text-[9px] font-bold text-primary-foreground">
                        P
                      </span>
                      <span className="font-medium">Ploydok</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => setMobileNavOpen(false)}
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent md:hidden"
                      aria-label="Close navigation"
                    >
                      <RiCloseLine className="size-5" />
                    </button>
                    <button
                      type="button"
                      onClick={toggleSidebar}
                      className="hidden size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent md:flex"
                      aria-label="Collapse sidebar"
                      aria-expanded
                    >
                      <RiSidebarFoldLine className="size-4" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    className="group/brand relative flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-none hover:bg-sidebar-accent"
                    aria-label="Expand sidebar"
                    aria-expanded={false}
                  >
                    <span className="flex size-4 items-center justify-center rounded-[4px] bg-primary text-[9px] font-bold text-primary-foreground transition-opacity group-hover/brand:opacity-0">
                      P
                    </span>
                    <RiSidebarFoldLine className="absolute size-4 rotate-180 text-muted-foreground opacity-0 transition-opacity group-hover/brand:opacity-100" />
                  </button>
                )}
              </div>

              {/* Content */}
              <div className="flex scrollbar-thin min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                {/* Team selector */}
                <div className="p-2">
                  {expanded ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        Workspace
                      </span>
                      {workspaceLoading ? (
                        <div
                          aria-hidden
                          aria-busy="true"
                          className="flex h-12 w-full items-center gap-3 rounded-md border border-input bg-background px-3"
                        >
                          <Skeleton className="size-5 shrink-0" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      ) : (
                        <div className="relative">
                          <span
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 left-3 z-10 size-5 -translate-y-1/2 rounded-md bg-gradient-to-br from-emerald-300 via-teal-400 to-sky-500"
                          />
                          <Select
                            open={workspaceSelectOpen}
                            onOpenChange={setWorkspaceSelectOpen}
                            value={
                              currentOrgSlug ?? currentOrganization?.slug ?? ""
                            }
                            onValueChange={handleWorkspaceSelect}
                          >
                            <SelectTrigger className="h-12 w-full pl-11 text-left">
                              <SelectValue placeholder="Select workspace" />
                            </SelectTrigger>
                            <SelectContent
                              align="start"
                              className="w-[--radix-select-trigger-width]"
                            >
                              <SelectGroup>
                                {availableOrganizations.map((organization) => (
                                  <SelectItem
                                    key={organization.id}
                                    value={organization.slug}
                                  >
                                    {organization.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                              <SelectGroup>
                                <SelectItem value={CREATE_WORKSPACE_VALUE}>
                                  <span className="flex items-center gap-2">
                                    <RiAddLine className="size-4 shrink-0" />
                                    <span>Create workspace</span>
                                  </span>
                                </SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  ) : workspaceLoading ? (
                    <div
                      aria-hidden
                      aria-busy="true"
                      className="flex h-8 w-full items-center justify-center"
                    >
                      <Skeleton className="size-6 shrink-0" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCollapsedWorkspaceClick}
                      className={cx(
                        "flex h-8 w-full items-center justify-center overflow-hidden rounded-md p-0 text-sm outline-none hover:bg-sidebar-accent"
                      )}
                      aria-label="Open workspace switcher"
                      title={currentOrganization?.name ?? "My Organization"}
                    >
                      <span className="size-6 shrink-0 rounded-md bg-gradient-to-br from-emerald-300 via-teal-400 to-sky-500" />
                    </button>
                  )}
                </div>

                {navGroups.map((group) => (
                  <div key={group.title} className="p-2">
                    <div className="flex h-8 shrink-0 items-center overflow-hidden px-2 text-xs font-medium text-muted-foreground group-data-[sidebar-state=collapsed]/shell:opacity-0">
                      {group.title}
                    </div>
                    <ul className="flex w-full min-w-0 flex-col">
                      {group.items.map((item) => {
                        const Icon = item.icon
                        if (item.comingSoon || !item.to) {
                          return (
                            <li key={item.label} className="relative">
                              <span
                                title={item.tooltip ?? "Bientôt disponible"}
                                aria-disabled="true"
                                className={cx(
                                  "flex h-10 w-full cursor-not-allowed items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm text-sidebar-foreground/50 outline-none",
                                  "group-data-[sidebar-state=collapsed]/shell:size-8 group-data-[sidebar-state=collapsed]/shell:justify-center group-data-[sidebar-state=collapsed]/shell:p-0"
                                )}
                              >
                                <Icon className="size-4 shrink-0" />
                                <span className="truncate group-data-[sidebar-state=collapsed]/shell:hidden">
                                  {item.label}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="ml-auto rounded-full border border-sidebar-border/60 bg-sidebar-accent/30 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-sidebar-foreground/60 uppercase group-data-[sidebar-state=collapsed]/shell:hidden"
                                >
                                  Soon
                                </span>
                              </span>
                            </li>
                          )
                        }
                        const active = isNavActive(pathname, item.to)
                        return (
                          <li key={item.label} className="relative">
                            <Link
                              to={item.to}
                              title={item.label}
                              className={cx(
                                "flex h-10 w-full items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm transition-colors outline-none",
                                "group-data-[sidebar-state=collapsed]/shell:size-8 group-data-[sidebar-state=collapsed]/shell:justify-center group-data-[sidebar-state=collapsed]/shell:p-0",
                                active
                                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                              )}
                            >
                              <Icon className="size-4 shrink-0" />
                              <span className="truncate group-data-[sidebar-state=collapsed]/shell:hidden">
                                {item.label}
                              </span>
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex flex-col p-2">
                <ul className="flex w-full min-w-0 flex-col group-data-[sidebar-state=collapsed]/shell:hidden">
                  {accountNavItems.map((item) => {
                    const Icon = item.icon
                    if (!item.to) return null
                    const showReleaseDot =
                      item.label === "Guide" && unseenRelease
                    return (
                      <li key={item.label} className="relative">
                        <Link
                          to={item.to}
                          onClick={showReleaseDot ? markReleaseSeen : undefined}
                          title={
                            showReleaseDot
                              ? `New in v${version} — click to mark as seen`
                              : item.label
                          }
                          className="flex h-7 w-full items-center gap-2 overflow-hidden rounded-md px-[11px] text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/60"
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                          {showReleaseDot ? (
                            <span
                              aria-label={`New release v${version}`}
                              className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase"
                            >
                              <span
                                aria-hidden="true"
                                className="inline-block size-1.5 rounded-full bg-primary"
                              />
                              New
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    )
                  })}
                </ul>

                {/* User */}
                <ul className="relative mt-2 flex w-full min-w-0 flex-col">
                  <li className="relative">
                    <button
                      type="button"
                      onClick={() => setProfileOpen((open) => !open)}
                      aria-expanded={profileOpen}
                      title={displayName}
                      className={cx(
                        "flex h-12 w-full items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm outline-none hover:bg-sidebar-accent/60",
                        "group-data-[sidebar-state=collapsed]/shell:size-8 group-data-[sidebar-state=collapsed]/shell:justify-center group-data-[sidebar-state=collapsed]/shell:p-0"
                      )}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground group-data-[sidebar-state=collapsed]/shell:size-6">
                        {initials}
                      </span>
                      <span className="grid flex-1 text-left leading-tight group-data-[sidebar-state=collapsed]/shell:hidden">
                        <span className="truncate text-xs font-medium text-foreground">
                          {displayName}
                        </span>
                        <span className="truncate text-[10px] font-normal text-muted-foreground">
                          {email}
                        </span>
                      </span>
                      <RiArrowUpDownLine className="size-3.5 text-muted-foreground group-data-[sidebar-state=collapsed]/shell:hidden" />
                    </button>
                  </li>
                  {profileOpen ? (
                    <div className="absolute bottom-full left-0 z-50 mb-1 w-full min-w-48 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-md">
                      <Link
                        to="/settings/security"
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                      >
                        <RiShieldCheckLine className="size-3.5" />
                        Security
                      </Link>
                      <button
                        type="button"
                        onClick={toggleTheme}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                        aria-label={
                          resolvedTheme === "dark"
                            ? "Switch to light theme"
                            : "Switch to dark theme"
                        }
                      >
                        <span className="flex items-center gap-2">
                          {resolvedTheme === "dark" ? (
                            <RiSunLine className="size-3.5" />
                          ) : (
                            <RiMoonLine className="size-3.5" />
                          )}
                          {resolvedTheme === "dark"
                            ? "Light theme"
                            : "Dark theme"}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {themeMode}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
                      >
                        <RiLogoutBoxRLine className="size-3.5" />
                        Sign out
                      </button>
                    </div>
                  ) : null}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Main inset */}
        <main
          data-slot="sidebar-inset"
          className={cx(
            "relative flex w-full flex-1 flex-col bg-background text-foreground",
            "transition-[border-top-left-radius] duration-(--sidebar-animation-duration) ease-(--sidebar-animation-ease)",
            "md:rounded-tl-[var(--sidebar-inset-radius)] md:shadow-[0_0_2.5px_1px_var(--border)]",
            "md:peer-data-[state=collapsed]:rounded-tl-none"
          )}
        >
          {banner}
          <div className="relative flex h-12 items-center gap-2 px-3 sm:gap-3 sm:px-4 md:px-8">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
            >
              <RiMenuLine className="size-5" />
            </button>
            <div className="flex min-w-0 flex-1 items-center">
              <TopbarBreadcrumb />
            </div>
            <div className="hidden w-full max-w-md shrink-0 md:flex md:basis-[28rem]">
              <CommandBar />
            </div>
            <div className="flex shrink-0 items-center gap-1 md:min-w-0 md:flex-1 md:justify-end">
              <MobileSearchButton />
              <NotificationBell />
            </div>
          </div>
          <div
            className={cx(
              "flex min-h-0 flex-1 flex-col",
              // App-detail routes own their own chrome (AppBar + padded main) and
              // the logs route needs the terminal flush to the edges, so we strip
              // padding/gap on `/apps/<id>/*` and only apply scroll. Logs also
              // disables scroll here — its internal body handles overflow.
              resolveWrapperClass(pathname)
            )}
          >
            {children}
          </div>
        </main>

        {/* Global command palette — portalized, position-safe */}
        <CommandPaletteRoot />
        <CreateWorkspaceDialog
          open={createWorkspaceOpen}
          onOpenChange={setCreateWorkspaceOpen}
          onCreated={handleWorkspaceCreated}
        />
      </div>
    </CommandPaletteProvider>
  )
}

export function ShellPage({
  title,
  description,
  eyebrow,
  actions,
  children,
}: ShellPageProps): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          {eyebrow ? (
            <p className="font-mono text-[10px] font-light tracking-wide text-muted-foreground uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function ShellPanel({
  title,
  description,
  action,
  className,
  children,
}: ShellPanelProps): React.JSX.Element {
  return (
    <section
      className={cx("rounded-lg border border-border bg-card p-4", className)}
    >
      {title || description || action ? (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {description ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function MobileSearchButton(): React.JSX.Element {
  const { setOpen } = useCommandPaletteContext()
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
      aria-label="Open command palette"
    >
      <RiSearchLine className="size-4" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// TopbarBreadcrumb — resolves the current breadcrumb from route matches.
// Mounted in the global topbar next to NotificationBell so every page shows
// consistent navigation context without the children having to opt in.
// ---------------------------------------------------------------------------

function TopbarBreadcrumb(): React.JSX.Element | null {
  const matches = useMatches()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const orgSlug = useCurrentOrganizationSlug()

  const appId = extractAppId(matches)
  const { data: liveApp } = useApp(appId ?? "", { subscribeToEvents: false })
  const { data: monitoring } = useMonitoring({ enabled: Boolean(appId && liveApp) })
  const appName = liveApp?.name ?? extractAppName(matches)
  const appRuntime = resolveDisplayedAppState(liveApp, monitoring?.containers)
  const appStatus = appRuntime.status ?? extractAppStatus(matches)
  const items = resolveTopbarBreadcrumb(pathname, appName, orgSlug)
  if (items.length === 0) return null

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 overflow-hidden text-xs sm:gap-1.5"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <React.Fragment key={`${item.label}:${item.to ?? "current"}`}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="hidden truncate whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:inline"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                className="truncate font-medium text-foreground"
              >
                {item.label}
              </span>
            )}
          </React.Fragment>
        )
      })}
      {appStatus ? (
        <AppStatusBadge
          status={appStatus as AppStatus}
          health={appRuntime.health}
          className="ml-1.5"
        />
      ) : null}
    </nav>
  )
}

function BreadcrumbSeparator(): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3 shrink-0 text-muted-foreground/50"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}
