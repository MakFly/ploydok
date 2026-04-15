// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useMe, useLogout } from "../../lib/auth";
import { ThemeToggle } from "../theme/ThemeToggle";

export function Topbar(): React.JSX.Element {
  const { data: me } = useMe();
  const logout = useLogout();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const handleLogout = async (): Promise<void> => {
    await logout.mutateAsync();
    void router.navigate({ to: "/login" });
  };

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-background px-4">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-foreground">Ploydok</span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <ThemeToggle />

        {me && (
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              <span data-testid="user-display-name">{me.display_name}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="ml-1"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 min-w-36 rounded-md border border-border bg-popover p-1 shadow-md"
                role="menu"
              >
                <div className="px-2 py-1 text-xs text-muted-foreground">{me.email}</div>
                <hr className="my-1 border-border" />
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted focus:outline-none"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleLogout();
                  }}
                  data-testid="logout-button"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
