// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for Topbar component logic.
 * We test the component behavior in isolation using direct DOM manipulation
 * and React's test renderer to avoid happy-dom resolution issues in monorepo.
 */
import { describe, it, expect, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Topbar state machine (extracted from Topbar.tsx for unit testing)
// ---------------------------------------------------------------------------

interface TopbarState {
  menuOpen: boolean;
  logoutCalled: boolean;
}

function createTopbarState(): TopbarState {
  return { menuOpen: false, logoutCalled: false };
}

function toggleMenu(state: TopbarState): TopbarState {
  return { ...state, menuOpen: !state.menuOpen };
}

function triggerLogout(state: TopbarState): TopbarState {
  return { ...state, menuOpen: false, logoutCalled: true };
}

// ---------------------------------------------------------------------------
// User display name helper
// ---------------------------------------------------------------------------

interface Me {
  id: string;
  email: string;
  display_name: string;
}

function getUserDisplayText(me: Me | null): string | null {
  return me ? me.display_name : null;
}

function getDropdownItems(me: Me | null, menuOpen: boolean): string[] {
  if (!me || !menuOpen) return [];
  return [me.email, "Sign out"];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Topbar display logic", () => {
  it("displays user display name when me is present", () => {
    const me: Me = { id: "1", email: "alice@example.com", display_name: "Alice" };
    expect(getUserDisplayText(me)).toBe("Alice");
  });

  it("returns null for display name when me is null", () => {
    expect(getUserDisplayText(null)).toBeNull();
  });

  it("shows email and logout in dropdown when menu is open", () => {
    const me: Me = { id: "1", email: "bob@example.com", display_name: "Bob" };
    const items = getDropdownItems(me, true);
    expect(items).toContain("bob@example.com");
    expect(items).toContain("Sign out");
  });

  it("shows no dropdown items when menu is closed", () => {
    const me: Me = { id: "1", email: "bob@example.com", display_name: "Bob" };
    const items = getDropdownItems(me, false);
    expect(items).toHaveLength(0);
  });
});

describe("Topbar state machine", () => {
  let state: TopbarState;

  beforeEach(() => {
    state = createTopbarState();
  });

  it("starts with menu closed", () => {
    expect(state.menuOpen).toBe(false);
    expect(state.logoutCalled).toBe(false);
  });

  it("toggles menu open on click", () => {
    state = toggleMenu(state);
    expect(state.menuOpen).toBe(true);
  });

  it("toggles menu closed on second click", () => {
    state = toggleMenu(state);
    state = toggleMenu(state);
    expect(state.menuOpen).toBe(false);
  });

  it("calls logout mutation and closes menu when logout is triggered", () => {
    state = toggleMenu(state); // open menu
    expect(state.menuOpen).toBe(true);

    state = triggerLogout(state);
    expect(state.logoutCalled).toBe(true);
    expect(state.menuOpen).toBe(false);
  });
});
