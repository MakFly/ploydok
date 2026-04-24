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
  RiArrowUpDownLine,
  RiBookOpenLine,
  RiCloseLine,
  RiDashboardLine,
  RiDatabase2Line,
  RiFileListLine,
  RiLogoutBoxRLine,
  RiPulseLine,
  RiSettings3Line,
  RiShapesLine,
  RiShieldCheckLine,
  RiSidebarFoldLine,
  RiSparkling2Line,
  RiTeamLine,
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
import type { OrganizationSummary } from "@ploydok/shared"
import { useLogout, useMe } from "../../lib/auth"
import { CommandPaletteProvider } from "../../lib/hooks/command-palette-context"
import { CommandBar } from "./CommandBar"
import { CommandPaletteRoot } from "./CommandPalette"
import { NotificationBell } from "./NotificationBell"
import {
  extractAppName,
  extractAppStatus,
  resolveTopbarBreadcrumb,
} from "./topbar-breadcrumb"
import { AppStatusBadge } from "../apps/AppStatusBadge"
import type { AppStatus } from "@ploydok/shared"
import {
  organizationDashboardPath,
  organizationPath,
  replaceOrganizationInPath,
  useCreateOrganization,
  useCurrentOrganization,
  useCurrentOrganizationSlug,
  useOrganizations,
} from "../../lib/organizations"

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
  to?: string
  icon: React.ComponentType<{ className?: string }>
  comingSoon?: boolean
  tooltip?: string
}

const primaryNav: Array<NavItem> = [
  { label: "Dashboard", icon: RiDashboardLine },
  { label: "Applications", icon: RiApps2Line },
  { label: "Databases", icon: RiDatabase2Line },
  { label: "Marketplace", icon: RiShapesLine },
  { label: "Monitoring", to: "/monitoring", icon: RiPulseLine },
  {
    label: "AI Copilot",
    icon: RiSparkling2Line,
    comingSoon: true,
    tooltip: "Agent IA custom — déploie, debug et opère via prompt",
  },
]

const workspaceNav: Array<NavItem> = [
  { label: "Members", icon: RiTeamLine },
  { label: "Audit", icon: RiFileListLine },
]

const secondaryNav: Array<NavItem> = [
  { label: "Guide", to: "/guide", icon: RiBookOpenLine },
  { label: "Settings", to: "/settings", icon: RiSettings3Line },
]

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
    open: sidebarOpen,
    setOpen: setSidebarOpen,
    toggle: toggleSidebar,
  } = useSidebarState()
  const [updateOpen, setUpdateOpen] = React.useState(true)
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [workspaceSelectOpen, setWorkspaceSelectOpen] = React.useState(false)
  const [openWorkspaceSelectOnExpand, setOpenWorkspaceSelectOnExpand] =
    React.useState(false)
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = React.useState(false)

  React.useEffect(() => {
    setProfileOpen(false)
    setWorkspaceSelectOpen(false)
  }, [pathname])

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

  const state = sidebarOpen ? "expanded" : "collapsed"
  const brandTarget = currentOrgSlug
    ? organizationDashboardPath(currentOrgSlug)
    : "/dashboard"
  const navItems = primaryNav.map((item) => {
    if (item.to) return item
    if (item.label === "Dashboard") {
      return { ...item, to: brandTarget }
    }
    if (item.label === "Applications") {
      return {
        ...item,
        to: currentOrgSlug ? organizationPath(currentOrgSlug, "apps") : "/apps",
      }
    }
    if (item.label === "Databases") {
      return {
        ...item,
        to: currentOrgSlug
          ? organizationPath(currentOrgSlug, "databases")
          : "/databases",
      }
    }
    if (item.label === "Marketplace") {
      if (!currentOrgSlug) {
        return {
          ...item,
          comingSoon: true,
          tooltip: "Sélectionne un workspace",
        }
      }
      return { ...item, to: organizationPath(currentOrgSlug, "marketplace") }
    }
    return item
  })

  const workspaceNavItems = workspaceNav.map((item) => {
    if (!currentOrgSlug) {
      return {
        ...item,
        comingSoon: true,
        tooltip: "Sélectionne un workspace",
      }
    }
    if (item.label === "Members") {
      return { ...item, to: organizationPath(currentOrgSlug, "members") }
    }
    if (item.label === "Audit") {
      return { ...item, to: organizationPath(currentOrgSlug, "audit") }
    }
    return item
  })

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
        {/* Sidebar (peer) */}
        <div
          data-slot="sidebar"
          data-state={state}
          data-collapsible={state === "collapsed" ? "icon" : ""}
          data-variant="inset"
          className="peer hidden md:block"
        >
          {/* Gap: reserves horizontal space so main is pushed correctly */}
          <div
            aria-hidden
            className={cx(
              "relative h-svh shrink-0 bg-transparent",
              "w-[var(--sidebar-width)] transition-[width] duration-(--sidebar-animation-duration) ease-(--sidebar-animation-ease)",
              "group-data-[sidebar-state=collapsed]/shell:w-[calc(var(--sidebar-width-icon)+1rem)]"
            )}
          />

          {/* Container: actual sidebar, fixed positioned */}
          <div
            className={cx(
              "fixed inset-y-0 left-0 z-10 flex h-svh p-2",
              "w-[var(--sidebar-width)] transition-[width] duration-(--sidebar-animation-duration) ease-(--sidebar-animation-ease)",
              "group-data-[sidebar-state=collapsed]/shell:w-[calc(var(--sidebar-width-icon)+1rem)]"
            )}
          >
            <div className="flex size-full flex-col">
              {/* Header */}
              <div className="flex h-14 flex-row items-center p-2">
                {sidebarOpen ? (
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
                      onClick={toggleSidebar}
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent"
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
              <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                {/* Team selector */}
                <div className="p-2">
                  {sidebarOpen ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        Workspace
                      </span>
                      {workspaceLoading ? (
                        <div
                          aria-hidden
                          className="flex h-12 w-full items-center gap-3 rounded-md border border-input bg-background px-3"
                        >
                          <span className="size-5 shrink-0 animate-pulse rounded-md bg-muted" />
                          <span className="h-3 w-24 animate-pulse rounded bg-muted" />
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

                {/* Platform group */}
                <div className="p-2">
                  <div className="flex h-8 shrink-0 items-center overflow-hidden px-2 text-xs font-medium text-muted-foreground group-data-[sidebar-state=collapsed]/shell:opacity-0">
                    Platform
                  </div>
                  <ul className="flex w-full min-w-0 flex-col">
                    {navItems.map((item) => {
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
                              <span className="ml-auto font-mono text-[9px] font-light tracking-wide uppercase opacity-60 group-data-[sidebar-state=collapsed]/shell:hidden">
                                soon
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

                {/* Workspace group */}
                <div className="p-2">
                  <div className="flex h-8 shrink-0 items-center overflow-hidden px-2 text-xs font-medium text-muted-foreground group-data-[sidebar-state=collapsed]/shell:opacity-0">
                    Workspace
                  </div>
                  <ul className="flex w-full min-w-0 flex-col">
                    {workspaceNavItems.map((item) => {
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
              </div>

              {/* Footer */}
              <div className="flex flex-col p-2">
                {updateOpen ? (
                  <div className="relative mb-2 min-h-27 rounded-[10px] border border-border bg-card group-data-[sidebar-state=collapsed]/shell:hidden">
                    <div className="relative flex size-full flex-col gap-1 overflow-hidden p-3">
                      <span className="font-mono text-[10px] font-light text-muted-foreground">
                        UPDATE
                      </span>
                      <p className="text-xs font-medium">What&apos;s new</p>
                      <span className="text-[10px] text-muted-foreground">
                        Latest fixes and new features.
                      </span>
                      <Link
                        to="/guide"
                        className="mt-1 inline-flex h-7 w-fit items-center rounded-md border border-border px-2 text-xs font-medium outline-none hover:bg-muted"
                      >
                        Learn more
                      </Link>
                      <button
                        type="button"
                        onClick={() => setUpdateOpen(false)}
                        className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted"
                        aria-label="Dismiss update"
                      >
                        <RiCloseLine className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}

                <ul className="flex w-full min-w-0 flex-col group-data-[sidebar-state=collapsed]/shell:hidden">
                  {secondaryNav.map((item) => {
                    const Icon = item.icon
                    if (!item.to) return null
                    return (
                      <li key={item.label} className="relative">
                        <Link
                          to={item.to}
                          className="flex h-7 w-full items-center gap-2 overflow-hidden rounded-md px-[11px] text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/60"
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
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
          <div className="relative flex h-12 items-center gap-3 px-4 md:px-8">
            <div className="flex min-w-0 flex-1 items-center">
              <TopbarBreadcrumb />
            </div>
            <div className="hidden w-full max-w-md shrink-0 md:flex md:basis-[28rem]">
              <CommandBar />
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end">
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
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
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

// ---------------------------------------------------------------------------
// TopbarBreadcrumb — resolves the current breadcrumb from route matches.
// Mounted in the global topbar next to NotificationBell so every page shows
// consistent navigation context without the children having to opt in.
// ---------------------------------------------------------------------------

function TopbarBreadcrumb(): React.JSX.Element | null {
  const matches = useMatches()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const appName = extractAppName(matches)
  const appStatus = extractAppStatus(matches)
  const items = resolveTopbarBreadcrumb(pathname, appName)
  if (items.length === 0) return null

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 text-xs"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <React.Fragment key={`${item.label}:${item.to ?? "current"}`}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
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
        <AppStatusBadge status={appStatus as AppStatus} className="ml-1.5" />
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
