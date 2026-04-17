// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  RiApps2Line,
  RiArrowUpDownLine,
  RiBookOpenLine,
  RiCloseLine,
  RiDashboardLine,
  RiDatabase2Line,
  RiFolder3Line,
  RiLogoutBoxRLine,
  RiPulseLine,
  RiSettings3Line,
  RiShieldCheckLine,
  RiSidebarFoldLine,
  RiSparkling2Line,
  RiStackLine,
} from "@remixicon/react";
import { useLogout, useMe } from "../../lib/auth";

interface AppShellProps {
  children: React.ReactNode;
}

interface ShellPageProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

interface ShellPanelProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

interface NavItem {
  label: string;
  to?: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
  tooltip?: string;
}

const primaryNav: Array<NavItem> = [
  { label: "Dashboard", to: "/dashboard", icon: RiDashboardLine },
  { label: "Projects", icon: RiFolder3Line, comingSoon: true },
  { label: "Applications", to: "/apps", icon: RiApps2Line },
  { label: "Databases", icon: RiDatabase2Line, comingSoon: true },
  { label: "Templates", icon: RiStackLine, comingSoon: true },
  { label: "Activity", icon: RiPulseLine, comingSoon: true },
  {
    label: "AI Copilot",
    icon: RiSparkling2Line,
    comingSoon: true,
    tooltip: "Agent IA custom — déploie, debug et opère via prompt",
  },
];

const secondaryNav: Array<NavItem> = [
  { label: "Guide", to: "/guide", icon: RiBookOpenLine },
  { label: "Settings", to: "/settings/security", icon: RiSettings3Line },
];

const STORAGE_KEY = "ploydok.sidebar.state";

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function isNavActive(pathname: string, target: string): boolean {
  if (target === "/dashboard") return pathname === "/dashboard";
  return pathname === target || pathname.startsWith(`${target}/`);
}

function useSidebarState(): [boolean, () => void] {
  const [open, setOpen] = React.useState<boolean>(true);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "collapsed") setOpen(false);
    } catch {
      // ignore
    }
  }, []);

  const toggle = React.useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "expanded" : "collapsed");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return [open, toggle];
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { data: me } = useMe();
  const logout = useLogout();
  const router = useRouter();
  const [sidebarOpen, toggleSidebar] = useSidebarState();
  const [updateOpen, setUpdateOpen] = React.useState(true);
  const [profileOpen, setProfileOpen] = React.useState(false);

  React.useEffect(() => {
    setProfileOpen(false);
  }, [pathname]);

  const displayName = me?.display_name ?? "Workspace Owner";
  const email = me?.email ?? "hello@ploydok.dev";
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleLogout = async (): Promise<void> => {
    await logout.mutateAsync();
    void router.navigate({ to: "/login" });
  };

  const state = sidebarOpen ? "expanded" : "collapsed";

  const wrapperStyle: React.CSSProperties = {
    ["--sidebar-width" as string]: "16rem",
    ["--sidebar-width-icon" as string]: "3rem",
    ["--sidebar-inset-radius" as string]: "calc(var(--radius) * 4)",
    ["--sidebar-animation-duration" as string]: "300ms",
    ["--sidebar-animation-ease" as string]: "cubic-bezier(0.32, 0.72, 0, 1)",
  };

  return (
    <div
      data-sidebar-state={state}
      style={wrapperStyle}
      className="group/shell bg-sidebar/50 text-sidebar-foreground flex min-h-svh w-full"
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
            "group-data-[sidebar-state=collapsed]/shell:w-[calc(var(--sidebar-width-icon)+1rem)]",
          )}
        />

        {/* Container: actual sidebar, fixed positioned */}
        <div
          className={cx(
            "fixed inset-y-0 left-0 z-10 flex h-svh p-2",
            "w-[var(--sidebar-width)] transition-[width] duration-(--sidebar-animation-duration) ease-(--sidebar-animation-ease)",
            "group-data-[sidebar-state=collapsed]/shell:w-[calc(var(--sidebar-width-icon)+1rem)]",
          )}
        >
          <div className="flex size-full flex-col">
            {/* Header */}
            <div className="flex h-14 flex-row items-center p-2">
              {sidebarOpen ? (
                <>
                  <Link
                    to="/dashboard"
                    className="hover:bg-sidebar-accent flex h-10 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm outline-none"
                    aria-label="Ploydok"
                  >
                    <span className="bg-primary text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-bold">
                      P
                    </span>
                    <span className="font-medium">Ploydok</span>
                  </Link>
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    className="hover:bg-sidebar-accent text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md outline-none"
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
                  className="group/brand hover:bg-sidebar-accent relative flex size-8 shrink-0 items-center justify-center rounded-md outline-none transition-colors"
                  aria-label="Expand sidebar"
                  aria-expanded={false}
                >
                  <span className="bg-primary text-primary-foreground flex size-4 items-center justify-center rounded-[4px] text-[9px] font-bold transition-opacity group-hover/brand:opacity-0">
                    P
                  </span>
                  <RiSidebarFoldLine className="text-muted-foreground absolute size-4 rotate-180 opacity-0 transition-opacity group-hover/brand:opacity-100" />
                </button>
              )}
            </div>

            {/* Content */}
            <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
              {/* Team selector */}
              <div className="p-2">
                <button
                  type="button"
                  className={cx(
                    "hover:bg-sidebar-accent flex h-12 w-full items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm outline-none",
                    "group-data-[sidebar-state=collapsed]/shell:h-8 group-data-[sidebar-state=collapsed]/shell:justify-center group-data-[sidebar-state=collapsed]/shell:p-0",
                  )}
                  aria-label="Switch workspace"
                >
                  <span className="size-6 shrink-0 rounded-md bg-gradient-to-br from-emerald-300 via-teal-400 to-sky-500" />
                  <span className="grid flex-1 text-left leading-tight group-data-[sidebar-state=collapsed]/shell:hidden">
                    <span className="truncate text-xs font-medium">Ploydok Cloud</span>
                  </span>
                  <RiArrowUpDownLine className="text-muted-foreground size-3.5 group-data-[sidebar-state=collapsed]/shell:hidden" />
                </button>
              </div>

              {/* Platform group */}
              <div className="p-2">
                <div className="text-muted-foreground flex h-8 shrink-0 items-center overflow-hidden px-2 text-xs font-medium group-data-[sidebar-state=collapsed]/shell:opacity-0">
                  Platform
                </div>
                <ul className="flex w-full min-w-0 flex-col">
                  {primaryNav.map((item) => {
                    const Icon = item.icon;
                    if (item.comingSoon || !item.to) {
                      return (
                        <li key={item.label} className="relative">
                          <span
                            title={item.tooltip ?? "Bientôt disponible"}
                            aria-disabled="true"
                            className={cx(
                              "flex h-10 w-full cursor-not-allowed items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm text-sidebar-foreground/50 outline-none",
                              "group-data-[sidebar-state=collapsed]/shell:size-8 group-data-[sidebar-state=collapsed]/shell:justify-center group-data-[sidebar-state=collapsed]/shell:p-0",
                            )}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span className="truncate group-data-[sidebar-state=collapsed]/shell:hidden">
                              {item.label}
                            </span>
                            <span className="ml-auto font-mono text-[9px] font-light uppercase tracking-wide opacity-60 group-data-[sidebar-state=collapsed]/shell:hidden">
                              soon
                            </span>
                          </span>
                        </li>
                      );
                    }
                    const active = isNavActive(pathname, item.to);
                    return (
                      <li key={item.label} className="relative">
                        <Link
                          to={item.to}
                          title={item.label}
                          className={cx(
                            "flex h-10 w-full items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm outline-none transition-colors",
                            "group-data-[sidebar-state=collapsed]/shell:size-8 group-data-[sidebar-state=collapsed]/shell:justify-center group-data-[sidebar-state=collapsed]/shell:p-0",
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "hover:bg-sidebar-accent/60 text-sidebar-foreground",
                          )}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className="truncate group-data-[sidebar-state=collapsed]/shell:hidden">
                            {item.label}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-col p-2">
              {updateOpen ? (
                <div className="border-border bg-card relative mb-2 min-h-27 rounded-[10px] border group-data-[sidebar-state=collapsed]/shell:hidden">
                  <div className="relative flex size-full flex-col gap-1 overflow-hidden p-3">
                    <span className="text-muted-foreground font-mono text-[10px] font-light">
                      UPDATE
                    </span>
                    <p className="text-xs font-medium">What&apos;s new</p>
                    <span className="text-muted-foreground text-[10px]">
                      Latest fixes and new features.
                    </span>
                    <Link
                      to="/guide"
                      className="hover:bg-muted border-border mt-1 inline-flex h-7 w-fit items-center rounded-md border px-2 text-xs font-medium outline-none"
                    >
                      Learn more
                    </Link>
                    <button
                      type="button"
                      onClick={() => setUpdateOpen(false)}
                      className="hover:bg-muted text-muted-foreground absolute top-2 right-2 flex size-6 items-center justify-center rounded-full outline-none"
                      aria-label="Dismiss update"
                    >
                      <RiCloseLine className="size-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}

              <ul className="flex w-full min-w-0 flex-col group-data-[sidebar-state=collapsed]/shell:hidden">
                {secondaryNav.map((item) => {
                  const Icon = item.icon;
                  if (!item.to) return null;
                  return (
                    <li key={item.label} className="relative">
                      <Link
                        to={item.to}
                        className="hover:bg-sidebar-accent/60 text-muted-foreground flex h-7 w-full items-center gap-2 overflow-hidden rounded-md px-[11px] text-xs font-medium outline-none transition-colors"
                      >
                        <Icon className="size-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
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
                      "hover:bg-sidebar-accent/60 flex h-12 w-full items-center gap-2 overflow-hidden rounded-md px-[11px] py-2 text-sm outline-none",
                      "group-data-[sidebar-state=collapsed]/shell:size-8 group-data-[sidebar-state=collapsed]/shell:justify-center group-data-[sidebar-state=collapsed]/shell:p-0",
                    )}
                  >
                    <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold group-data-[sidebar-state=collapsed]/shell:size-6">
                      {initials}
                    </span>
                    <span className="grid flex-1 text-left leading-tight group-data-[sidebar-state=collapsed]/shell:hidden">
                      <span className="text-foreground truncate text-xs font-medium">
                        {displayName}
                      </span>
                      <span className="text-muted-foreground truncate text-[10px] font-normal">
                        {email}
                      </span>
                    </span>
                    <RiArrowUpDownLine className="text-muted-foreground size-3.5 group-data-[sidebar-state=collapsed]/shell:hidden" />
                  </button>
                </li>
                {profileOpen ? (
                  <div className="border-border bg-popover absolute bottom-full left-0 z-50 mb-1 w-full min-w-48 overflow-hidden rounded-md border p-1 shadow-md">
                    <Link
                      to="/settings/security"
                      className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    >
                      <RiShieldCheckLine className="size-3.5" />
                      Security
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="hover:bg-destructive/10 text-destructive flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
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
          "bg-background text-foreground relative flex w-full flex-1 flex-col",
          "transition-[border-top-left-radius] duration-(--sidebar-animation-duration) ease-(--sidebar-animation-ease)",
          "md:rounded-tl-[var(--sidebar-inset-radius)] md:shadow-[0_0_2.5px_1px_var(--border)]",
          "md:peer-data-[state=collapsed]:rounded-tl-none",
        )}
      >
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
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
            <p className="text-muted-foreground font-mono text-[10px] font-light tracking-wide uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-muted-foreground max-w-3xl text-sm leading-6">
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
  );
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
      className={cx(
        "border-border bg-card rounded-lg border p-4",
        className,
      )}
    >
      {title || description || action ? (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            {title ? (
              <h2 className="text-sm font-semibold">{title}</h2>
            ) : null}
            {description ? (
              <p className="text-muted-foreground text-xs leading-5">
                {description}
              </p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
