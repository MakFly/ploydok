# DESIGN.md — BoardUI Dashboard

Living design reference for this dashboard. Keep it in sync whenever a token,
component, or interaction pattern changes. Source of truth for tokens is
`src/styles/globals.css`; this file explains *how* to use them.

---

## 1. Foundations

**Fonts** — Inter (`--font-sans`), JetBrains Mono (`--font-mono`).
**Radius** — base `--radius: 10px`. Containers use `rounded-2xl` (cards),
`rounded-[10px]` (controls), `rounded-full` (pills/avatars).
**Elevation** — three tokens only:

| Token                 | Use                                   |
|-----------------------|---------------------------------------|
| `--shadow-xs`         | inputs, ghost buttons, chips          |
| `--shadow-card`       | inner content cards (member, stat)    |
| `--shadow-elevated`   | floating surfaces: menus, palette, toasts |

**Signature** — the primary button is a vertical blue gradient
(`--gradient-primary`, `180deg #3080ff → #155dfc`) with `--shadow-btn-primary`.
Never flatten it to a solid fill.

### Color roles (semantic, not raw hex in components when a token exists)

| Role      | Chip bg / text            | Accent (bar, dot, line) |
|-----------|---------------------------|-------------------------|
| positive  | `#d9f99d` / `#3c6300`     | `#84cc16` (lime-500)    |
| negative  | `#ffccd3` / `#a50036`     | `#e7000b`               |
| warning   | `#fff085` / `#894b00`     | `#f0b100`               |
| info/brand| `#dbeafe` / `#1447e6`     | `#3080ff` (brand-500)   |
| neutral   | `neutral-200` / `neutral-600` | `neutral-400`       |

Data-viz accent is **lime** (`--color-viz-*`); the contribution heatmap uses
**violet** (`--color-heat-0..5`). These are intentional and distinct from brand blue.

---

## 2. Layout shell

```
┌ BuiSidebarProvider ─────────────────────────────────────────────┐
│  BoardUISidebar        DashboardHeader (sticky, breadcrumb+title)│
│  (collapsible)         ─────────────────────────────────────────│
│   72px ⇄ 260px         main → page (max-w-[1200px], p-4 lg:p-6)  │
└─────────────────────────────────────────────────────────────────┘
```

- Content column: `mx-auto w-full max-w-[1200px] flex-col gap-4 p-4 lg:p-6`.
- **Mobile-first / fluid**: single column → `sm:grid-cols-2` → `lg:grid-cols-3`.
  No fixed page widths, no `100vh` (shell uses `min-h-dvh`).
- Sidebar is a drawer under `md` (`max-md:fixed`, translate-x), sticky rail at `md+`.
- The floating bottom-right layout control opens two vertically stacked choices: `01` for
  the original BoardUI shell and `02` for the shadcn `sidebar-08`-inspired inset shell.
  Each choice exposes its name in a tooltip on hover and keyboard focus. In inset mode, the
  sidebar sits directly on the neutral canvas while the content becomes the rounded, elevated
  surface. The choice is persisted in `localStorage` under `boardui-dashboard-layout`; mobile
  keeps the drawer geometry.

---

## 3. Components & patterns

### Card (`dashboard-content.tsx`)
Gray container: `rounded-2xl bg-[#f7f7f7]`, no border/shadow. Inner white cards
(`bg-white`) carry `--shadow-card`.

### Menu / select trigger
Dropdown built in `dashboard-content.tsx` (`Menu`). Trigger "chips":
`h-[38px]` for filters, `h-[34px]` for in-row selects, `rounded-[10px]`,
`border-neutral-200`, `bg-white`, `--shadow-xs`, chevron `text-neutral-500`.

> **Iso-width rule** — in-table selects that toggle between labels of different
> lengths (e.g. `Waiting` / `Completed`) use a **fixed width** (`w-[132px]`)
> with the chevron pushed right (`ml-auto`), so every row aligns. Don't let a
> select's width follow its label. The `Menu` `matchTrigger` prop measures the
> trigger's `offsetWidth` on open and sets the dropdown to that exact width
> (used by the Purchase select) so the open menu is iso-width with its trigger.

### Charts

- **Revenue (area)** — `RevenueCard`. Hover tracks the nearest point on the
  X-axis and renders a `pointer-events-none` overlay: vertical guide + marker
  dot + a floating price tooltip. Value is mapped to the fixed `$6K` axis
  (`pts/100 * 6000`). Everything glides with `transition-[left,top] duration-200`;
  the price re-fades on change (`key={idx}` + `animate-in fade-in`).
  **No `cursor-crosshair`** (looks like a `+`) — keep the default cursor.
- **Earned (bars)** — static bars, `--color-viz-400` fill.
- **Contributions (heatmap)** — `ContributionsCard`. GitHub-style: each cell
  raises a dark tooltip `"N contributions on <weekday>, <Mon> <day>, <year>"`
  on hover, gliding between cells. Dates are derived from a **fixed anchor**
  (`CONTRIB_START` = first Sunday of 2026) so SSR and CSR match — never seed
  cell dates/values from `Date.now()`/`Math.random()` at render.

### Segmented controls / tabs (sliding pill)
The white sliding pill under the active tab is positioned in **equal thirds**, so
the tabs **must be equal-width** — use `grid grid-cols-3` (not `inline-flex`,
which sizes each button to its label and makes the pill drift, e.g. `All` vs
`Starred`). Pill math accounts for the `p-0.5` (4px) container padding:
`left: calc(2px + idx * ((100% - 4px) / 3))`, `width: calc((100% - 4px) / 3)`.
Applied on both the inbox tabs and `SegTabs` (Revenue/Earned/Contributions) —
both use the `grid grid-cols-3` + padding-aware pill formula.

### Popover (anchored dropdown) + Alert
`ui/popover.tsx` — reusable anchored dropdown (portal, `position: fixed`, opens
**below** its trigger). API: render-prop `trigger({ ref, onClick, aria-expanded })`
so the caller keeps its own button; `children` may be `(close) => …`. `align`
`"end"` (right-aligned, default) / `"start"`, `width`, `className`. Position
measured from the trigger rect on open — uses `documentElement.clientWidth`
(not `innerWidth`) so a right-anchored panel isn't shoved left by the scrollbar.
Enter/exit `opacity`/`scale-95`/`blur` (two-step), closes on outside click /
`Escape`, re-places on resize. `origin-top-right` for `end`.

Wired in `dashboard-header.tsx`: the **bell** opens a notifications popover
(list of `<Alert>` from mock data, `align="end"`, w-368) and the **Filters**
button opens a filter popover (search + `Status` checkboxes + `Sort` pills +
Reset/Apply, w-288). (The shadcn `ui/sheet.tsx` is no longer used by the app —
only the shadcn `ui/sidebar.tsx` scaffold references it.)

`ui/alert.tsx` — tinted callout, `variant` = default/info/success/warning/error
(icon + tint per semantic family), `title` + `meta` (right) + description.

### Dialog / modal (`src/components/ui/dialog.tsx`)
Reusable modal matching the app shell. `<Dialog open onClose title? description?
footer? className?>{body}</Dialog>`. Portal-rendered (`document.body`), solid
overlay `bg-black/50` (no backdrop-blur), centered card `max-w-lg`,
`rounded-xl border-neutral-200 --shadow-elevated`, `max-h-[calc(100dvh-4rem)]`.
Header = title/description + close `X`; optional footer row (right-aligned
actions). Enter/exit via the two-step `render`/`shown` pattern
(`opacity`/`scale-95`, 150ms), `Escape` closes, body scroll locked while open.
Wired on the inbox: clicking a message row opens its detail (row action buttons
`stopPropagation` so they don't open it).

### Command palette (`boardui-sidebar.tsx` → `CommandPalette`, ⌘K / Ctrl+K)
Shortcut is platform-aware via `useShortcutLabel` (mac → `⌘K`, win/linux → `Ctrl K`);
the toggle listens for `metaKey || ctrlKey` + `k`. The quick-search button shows the
resolved label. Initial label state matches SSR (mac) then corrects on mount — no
hydration mismatch.

Kiwaui-style command dialog. Solid overlay `bg-black/50` (no backdrop-blur per
the perf rule), centered, `max-w-lg`→`sm:max-w-xl`, `max-h-[calc(100dvh-4rem)]`,
`animate-in fade-in-0 zoom-in-95`. Structure: gray shell (`bg-[#f7f7f7] p-1`) →
transparent search row (search icon + input + conditional clear `X`) → **white
inset results card** (`rounded-lg bg-white --shadow-xs`) with grouped list →
footer with `Kbd` hints on the gray. Groups: `Suggestions` + `Results` (right-
aligned `type` meta, `text-neutral-400`), separator `mx-2 my-3 h-px`, empty state
"No results found.". Keyboard: `↑`/`↓` move `active` (also on `mousemove`),
`↵` selects (`router.push`), `Esc` closes. `active` row → `data-[active=true]:bg-neutral-100`.

### Board team dropdown (`boardui-sidebar.tsx` → `TeamMenu`)
Clone of boardui.com's team switcher. The footer button is the trigger; the
panel (`w-[265px]`, `rounded-2xl`, `--shadow-elevated`) is a grouped menu
(header → items → `Company` → `Personal` → footer with version badge), Remix
icons inline (`size-5 text-neutral-500`).

> **Rendered in a portal** (`createPortal` → `document.body`, `position: fixed`)
> because the sidebar `aside` is `overflow-hidden` (needed for the collapse
> animation) and would clip a normally-positioned popover. Position is measured
> from the trigger rect on open, anchored above it (`origin-bottom-left`), width
> clamped to the viewport. Enter/exit mirror the source: `opacity`/`scale-95`/
> `blur-[2px]` toggled via a two-step `open`/`shown` state. Closes on outside
> click / `Escape`; chevron rotates `180°` while open.

### Sidebar collapse (`boardui-sidebar.tsx`)
- Collapsed nav items (NAV/SECONDARY + Quick Search) show an **instant** tooltip
  (radix `Tooltip`, `delayDuration={0}`, `side="right"`, portaled so the aside's
  `overflow-hidden` doesn't clip it) via the `Tip` helper — only when collapsed.
- The "Setting up your account" card **animates back in** on re-open
  (`animate-in fade-in slide-in-from-bottom-2`, `min-w-[228px]` so it's revealed
  by clipping as the sidebar widens rather than reflowing).

- Expanded (260px): avatar + label on the left, collapse toggle on the right.
- **Collapsed (72px): the toggle is hidden.** The header row is a `group`;
  on hover the avatar fades out (`group-hover:opacity-0 pointer-events-none`)
  and the expand button fades in **in its place** (`group-hover:opacity-100`).
- Labels animate via the `Label` wrapper (`max-width`/`opacity`/`blur`).

### Toasts (`src/components/ui/toast.tsx`) — added for `/dashboard/notifications`
Self-contained, reusable. Sonner-like API.

```tsx
<ToastProvider>        {/* renders children + the Toaster viewport */}
  ...
</ToastProvider>

const { toast, dismiss, promise } = useToast()
toast({ title, description?, variant?, duration?, action? })
// variant: "success" | "error" | "warning" | "info" | "default" | "loading"  (default 4000ms)

// promise (sonner-style): one toast morphs loading → success/error in place
promise(fetchReport(), {
  loading: "Generating report…",
  success: (file) => `${file} is ready`,   // string | (data) => string
  error: "Couldn’t generate the report",   // string | (err) => string
})
```

- **`loading` variant**: renders **sonner's exact 12-bar radial spinner**
  (`SonnerSpinner` + `.sonner-loader` rules in `globals.css` — geometry copied
  verbatim from sonner: 12 bars, `rotate(i·30deg) translate(146%)`, staggered
  `-1.2s→-0.1s` delays, `sonner-spin` opacity `1→0.15`, `--spinner-size: 16px`).
  Bars use `currentColor` so the chip text color drives them. **No progress bar
  and no close button** while pending (`duration: Infinity`); on settle,
  `update()` swaps variant/title in place (chip `transition-colors`) and the
  finite progress bar takes over to auto-dismiss.

- **Viewport**: `fixed` bottom (mobile, full-width, `safe-area-inset-bottom`) →
  bottom-right at `sm+`. `z-[60]`, `pointer-events-none` (rows re-enable).
- **Card**: `rounded-2xl bg-white border-neutral-200 --shadow-elevated`, colored
  icon chip per variant (see color table), optional action button, close `X`.
- **Auto-dismiss**: a bottom progress bar animates `scaleX 1→0` over `duration`
  (keyframe `toast-progress` in `globals.css`); its `onAnimationEnd` triggers
  dismissal. `group-hover:[animation-play-state:paused]` pauses on hover.
- **Motion**: enter/exit via `animate-in`/`animate-out` (`slide-in-from-bottom-4`
  → `sm:slide-in-from-right-full`, plus fade). Max 4 stacked (oldest dropped).
- Currently the provider is scoped to the notifications page. To make toasts
  app-wide, lift `<ToastProvider>` into `dashboard/layout.tsx`.

---

## 4. Interaction & a11y conventions

- Hover overlays that sit over a pointer-tracked surface (chart, heatmap) MUST be
  `pointer-events-none` so they don't break the tracking.
- Focus rings: `focus-visible:ring-2 ring-[#3080ff] ring-offset-2`.
- Touch: interactive controls ≥ the surrounding scale; toasts/menus are usable
  on mobile (bottom placement, safe-area padding). No hover-only affordances for
  core actions.
- Respect `min-h-dvh` (never `100vh`), keep layouts fluid, avoid horizontal scroll
  (tables use `overflow-x-auto` with an explicit `min-w`).

---

## 5. Adding a route

1. `src/app/dashboard/<slug>/page.tsx`.
2. Register nav in `boardui-sidebar.tsx` (`NAV`/`SECONDARY`; add the icon path to
   `PATHS` if new — icons are inline Remix paths).
3. Add a `META` entry in `dashboard-header.tsx` (`title` / `crumb` / `cta`).

---

## Changelog

- SaaS mode: added a cookie-protected TanStack Start workspace using the existing BoardUI shell and widgets.
- SaaS RBAC: Owner, Admin, and Member personas drive navigation plus route and server-function guards.
- SaaS billing: Stripe Checkout and Billing Portal server functions use an explicit demo fallback when keys are absent.
- Shell: the persistent floating layout switcher opens vertical `01`/`02` choices with tooltips.
- Sidebar: hide collapse toggle when collapsed; reveal it in place of the avatar on hover.
- Table: iso-width in-row selects (`Purchase`).
- Contributions: GitHub-style per-cell hover tooltip.
- Revenue: hover price tooltip with smooth transition; removed crosshair cursor.
- New: toast system (`ui/toast.tsx`) + `/dashboard/notifications` demo route + nav entry.
- Toast: added `loading` variant (spinner) + `promise()` API (loading → success/error in place).
- Toast: loading spinner now reproduces sonner's exact 12-bar radial loader (iso shadcn).
- Toast: single-line toasts (title only, e.g. loading) center vertically with the chip;
  `items-start` + `pt-0.5` only when a description/action is present.
- Sidebar: cloned the boardui.com "Board team" dropdown menu (`TeamMenu`, portal-rendered).
- Command palette (⌘L): redesigned to a kiwaui-style dialog (gray shell + white inset
  results card, Suggestions/Results groups, keyboard nav, footer kbd hints).
- Command palette shortcut: ⌘K (mac) / Ctrl+K (win/linux), platform-aware label.
- Inbox tabs: fixed the sliding pill misalignment (equal-width `grid-cols-3`).
- New: reusable `Dialog` modal (`ui/dialog.tsx`), wired to the inbox message detail.
- New: `Alert` callout (`ui/alert.tsx`) + `Popover` anchored dropdown (`ui/popover.tsx`).
  Header bell → notifications popover (mock alerts), Filters → filter popover
  (status/sort). Both anchored under their button (replaced the earlier side sheets).
- Sidebar: instant right-side tooltips on collapsed nav items; setup card animates
  back in on re-open; collapsed `<aside>` padding `p-3` → `p-4`.
- Table: Purchase select dropdown is iso-width with its trigger (`Menu` `matchTrigger`).
