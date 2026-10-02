---
name: ODIP
description: Operational ledger for Australian NDIS trip and participant management — calm, high-density, audit-first, comfortable on touch.
colors:
  background: "#fbf9f5"
  foreground: "#1b1c1a"
  card: "#ffffff"
  popover: "#ffffff"
  primary: "#396200"
  primary-foreground: "#ffffff"
  primary-container: "#4d7c0f"
  primary-fixed: "#bbf37c"
  on-primary-fixed: "#0f2000"
  secondary: "#515f74"
  secondary-foreground: "#ffffff"
  secondary-container: "#d5e3fc"
  muted: "#efeeea"
  muted-foreground: "#43493a"
  accent: "#efeeea"
  accent-foreground: "#1b1c1a"
  destructive: "#ba1a1a"
  destructive-foreground: "#ffffff"
  error-container: "#ffdad6"
  on-error-container: "#93000a"
  warning: "#f59e0b"
  warning-container: "#fef3c7"
  on-warning-container: "#92400e"
  border: "#c3c9b5"
  input: "#e4e2de"
  ring: "#396200"
  sidebar: "#f5f3ef"
  sidebar-accent: "rgba(255,255,255,0.4)"
  surface: "#ffffff"
  surface-container: "#efeeea"
  surface-container-low: "#f5f3ef"
  surface-container-high: "#eae8e4"
  surface-container-lowest: "#ffffff"
  outline-variant: "#c3c9b5"
  success: "#396200"
  info: "#515f74"
  conflict: "#ba1a1a"
  accessible-container: "#ffd7ef"
  on-accessible-container: "#7a2169"
typography:
  display:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontWeight: 800
    fontSize: "1.75rem"
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontWeight: 700
    fontSize: "1.25rem"
  title:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontWeight: 600
    fontSize: "0.875rem"
  body:
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif"
    fontWeight: 400
    fontSize: "0.875rem"
  body-secondary:
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif"
    fontWeight: 400
    fontSize: "13px"
  label:
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif"
    fontWeight: 500
    fontSize: "13px"
  caption:
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif"
    fontWeight: 400
    fontSize: "0.75rem"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  full: "9999px"
spacing:
  control-h: "32px"
  control-h-sm: "24px"
  row-h: "34px"
  table-head-h: "32px"
  cell-px: "12px"
  card-pad: "12px"
  section-gap: "16px"
  field-gap-y: "12px"
  field-gap-x: "16px"
  gutter: "20px"
  tap-min: "0px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 16px"
  button-danger:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.sm}"
    height: "32px"
  button-ghost:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.sm}"
    height: "32px"
  button-row-action:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.sm}"
    size: "24px"
  input-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 12px"
  card-surface:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
    padding: "12px"
  modal-surface:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "16px"
  nav-item-active:
    backgroundColor: "{colors.primary-fixed}"
    textColor: "{colors.on-primary-fixed}"
    rounded: "{rounded.md}"
    height: "32px"
  table-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    height: "34px"
    padding: "0 12px"
  glance-cell:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  glance-cell-warning:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.on-warning-container}"
  glance-cell-error:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.on-error-container}"
  attention-tile:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    padding: "12px 8px"
  attention-tile-warning:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.on-warning-container}"
  attention-tile-error:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.on-error-container}"
  attention-tile-tall:
    rounded: "{rounded.md}"
    padding: "16px"
  all-clear:
    backgroundColor: "{colors.primary-fixed}"
    textColor: "{colors.on-primary-fixed}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: ODIP

> Recorded from the shipped density-redesign build (2026-09), not from the plan. Where the build and
> `docs/specs/density-redesign-2026-09.md` differ, the build is recorded and the difference is noted.
>
> Added 2026-09-30 from the trip-detail build: the one **display type step** and the **detail header pattern**
> (display title, meta row, glance strip with attention tint). It is opt-in and only the trip detail page ships the whole pattern so far;
> the other detail pages adopt it next. Everything else on this page is unchanged.
>
> Added 2026-10-01 from the dashboard build: the display step now also sets the **Management Dashboard title** (`PageHeader variant="detail"`,
> its meta row a summary line of the everyday counts) and the figures of the new **attention band** (`StatCard variant="attention"`), which
> replaces the row of equal KPI tiles. Both are opt-in; every other StatCard and every other page header is unchanged.
>
> Added 2026-10-01 from the tone-system build: **The Tone Rule** and the tone table (Status Badges & Alerts). Statuses, priorities, plan types and
> alert severities now take their colour from one table, `src/lib/tone.ts`. The refactor was pixel-identical (every element's rect and computed
> colour was compared before and after); the deliberate changes are the ones where one intent was coloured two ways (trip status, task priority,
> plan types, a few status maps), listed in Status Badges & Alerts. No new colour was added.

> Added 2026-10-02 from the wrong-or-hidden-information fixes (code review round 2): **every real status has a deliberate tone and an unknown one is neutral**,
> **In progress is info blue** (owner decision), and **The Column Rule** (Tables): no column is removed at any width, the box scrolls, the first column and the
> actions stay pinned. The status table and the rule are written under Status Badges & Alerts and Tables.

> Added 2026-10-02 from the dashboard's bolder pass: the dashboard's title is a **greeting with today's date** (`PageHeader`'s `titleNote` and `documentTitle`), and the **attention band**
> is now a tall tile for each item that needs somebody, one **All clear** row on Pale Sprout for the items that do not, and one Pale Sprout field when nothing does. Nothing new was added to
> the system: every figure is still the display step, every fill is still a tone, and the all-clear is the documented "you are here / all clear" green, at full strength. Both parts stay
> opt-in (`StatCard`'s `action`, `PageHeader`'s `titleNote`); every other tile and header is unchanged.

## Overview

**Creative North Star: "The Operational Ledger"**

ODIP is a working record before it is a product. It is used by office coordinators running the
operational day of Australian NDIS disability services — participant bookings, staff and vehicle
rostering, accommodation, compliance countdowns. Someone sits in this system for hours. The design's
job is to make a long day of dense, consequential work feel calm and legible rather than clinical or
flattering. Everything here is in service of reading a lot of state quickly and trusting that what
is on screen is what is true.

The palette is earthy and deliberately un-glossy (the Organic Ledger character): a deep olive primary
on a warm off-white background, never pure white as the page, never pure black as text. Surfaces
separate by warm-grey tonal stepping rather than by shadow. Density is a feature, and it is now
tokenised: 32px controls and 34px rows on a mouse, the same screens opened up to 44px controls and
48px rows the moment the pointer is coarse. Density is a property of the pointer, not of the page, so
no page chooses its own. The interface should feel like good stationery: plain, durable, already in use.

Compliance is core behaviour, not an add-on. Timers, alerts and audit state are given the same
visual weight as ordinary data, because in this domain they are ordinary data. Nothing in the system
may read as a warning unless it genuinely is one.

**Key Characteristics:**
- Warm, earthy, low-gloss; depth by tonal stepping, not by shadow
- Density comes from one token block that flips under `pointer: coarse`; components point at the tokens
- Colour used semantically and sparingly; a ledger's colours mean something
- Compliance state (alerts, countdowns, audit) is first-class, never decorative
- Fine pointer: compact (32px controls). Coarse pointer: 44px targets, row actions always visible
- Text floor of 12px; 13px for secondary and label text; 14px for data

## Colors

A single olive-green accent family on a warm neutral base, with slate and rose reserved strictly
for the secondary and accessibility roles. Unchanged by the density work.

### Primary
- **Ledger Olive** (`#396200`): the single accent. Primary buttons, focus rings, selected state,
  success and "go" actions. Its rarity is what gives it meaning.
- **Deep Fern** (`#4d7c0f`): the container step, used where the primary needs to sit beneath other
  content without becoming the loudest thing on screen.
- **Pale Sprout** (`#bbf37c`): the *fixed* step, a high-visibility tint for the active navigation
  item, confirmed/active status badges and similar "you are here / all clear" surfaces, paired with
  near-black text. The dashboard's all-clear row and field wear it at full strength (13.2:1 against `#0f2000`).

### Secondary
- **Slate Blue** (`#515f74`): informational and neutral-support colour, also the `info` status and
  the inactive nav text. It never competes with the olive.
- **Pale Slate** (`#d5e3fc`): secondary container, for informational blocks.

### Neutral
- **Warm Paper** (`#fbf9f5`): the page background. Warm, never pure white.
- **Ledger Ink** (`#1b1c1a`): body and heading text. Near-black with a green undertone.
- **Mist** (`#efeeea`): muted and accent surfaces, hover fills.
- **Ruled Line** (`#c3c9b5`): all borders and outlines. Slightly green-grey.
- **Field Grey** (`#e4e2de`): input backgrounds, so a field reads as writable.

### Named Rules

**The Semantic Colour Rule.** A colour never carries meaning twice. `primary` is "go / selected /
success", `secondary` is "information", `destructive` is "destructive", `warning` is "time-bound
compliance", `accessible-container` is "accessibility". If a screen is reaching for a colour that
isn't on this list, it is reaching for the wrong thing.

**The Tone Rule.** A status is never given a colour of its own. Every status word, priority, plan type and alert severity maps to one of six
tones (neutral, info, success, warning, danger, accessible), and every tone maps to colours that already exist (the tone table under Status
Badges & Alerts). The map is one file, `src/lib/tone.ts` (`TONE`, `STATUS_TONE`): a new status is a one-line entry there, never a new colour,
and a domain whose word means something else (a cancelled leave request is over, not a failure) passes a `colorMap` of tones. The same intent
is coloured the same way on every screen: a trip status, a task priority and a plan type each have one mapping. Plan types and other categories
are info, accessible or neutral, never warning or danger, because a category is not a state.

**The Warm Base Rule.** The page is never `#ffffff` and text is never `#000000`. Warm off-white
and near-black are what separate ODIP from a generic Material dashboard.

## Typography

**Display Font:** Plus Jakarta Sans (system-ui fallback); applied to every `h1`-`h6` in the base layer
**Body Font:** Manrope (system-ui fallback)
**Label/Mono Font:** Manrope at medium weight; tabular figures (`tabular-nums`) on tables

**Character:** A geometric-humanist sans pairing: Jakarta's open apertures for headings, Manrope's
warmer, more even rhythm for body and data. Calm rather than authoritative; the authority comes from
the layout, not the type.

### Hierarchy
The ramp is short and flat because the density comes from layout. Measured at 1920: h1 20px (28px on a detail page and on the dashboard), table cells 14px.
- **Display** (800, 1.75rem / 28px, 1.2 leading, -0.015em tracking, the `text-display` utility): the ONE step above the
  headline, in Plus Jakarta Sans. Only the title of a detail page and of the dashboard (`PageHeader variant="detail"`; the dashboard's is a greeting with the date after it in the
  muted ink at the same size), the figures of a glance strip (`FactBar variant="glance"`) and the figures of the attention band (`StatCard variant="attention"`), all in tabular figures.
  Its four `--text-display*` tokens sit in the density token block.
- **Headline** (700, 1.25rem / `text-xl`): the page title in `PageHeader`, one per screen. StatCard values
  use the same size in display bold.
- **Title** (600, 0.875rem / `text-sm`): card and section headings.
- **Body** (400, 0.875rem / `text-sm`): the default. Table cells, descriptive copy, input text.
- **Body secondary** (400, 13px): table secondary text, the `PageHeader` subtitle (inline after the
  title on desktop), fact-list labels.
- **Label** (500, 13px): form labels, sitting 4px above the field.
- **Caption** (400-500, 0.75rem / `text-xs`, 12px): helper and error text, table column headers, the
  labels on mobile table cards, small buttons, counts. 12px is the floor.

### Named Rules

**The One Heading Rule.** Exactly one `<h1>` per screen, and it comes from `PageHeader`. Tabbed
pages render the tab body, not a second heading.

**The 12px Floor Rule.** Type is not set below 12px. Space is recovered by cutting columns and padding,
never by shrinking type. Inputs are forced to 16px below 768px so iOS does not zoom on focus.

**The One Display Step Rule.** The system has exactly one type step above the 20px headline: `--text-display` (28px, 800),
consumed as `text-display`. It belongs to a detail page's title, the dashboard's title, the figures of a glance strip and the figures
of the attention band, and to nothing else. A list page, a card title, a modal or an ordinary stat card never takes it, and no second
display size is added. The title is still the page's single `<h1>`, from `PageHeader`, so The One Heading Rule holds.

## Layout

A fixed 232px desktop sidebar (from `lg`) plus a fluid content column under a 48px sticky header;
below `lg` the sidebar becomes a slide-over menu and a bottom bar carries primary navigation. The main
column has `--gutter` side padding (20px fine, 16px coarse), a 16px top pad, and `--section-gap`
(16px fine, 20px coarse) between stacked blocks.

### The density token block
One block of plain CSS custom properties at the top of `index.css`, deliberately not `@theme` so
they can flip at runtime under `@media (pointer: coarse)`. Components consume them with arbitrary-value
syntax (`h-[var(--control-h)]`) and never restate the pixel value.

| Token | Fine pointer | Coarse pointer |
|---|---|---|
| `--control-h` (buttons, inputs, selects) | 32px | 44px |
| `--control-h-sm` (row actions, pills) | 24px | 36px |
| `--row-h` (table body row) | 34px | 48px |
| `--table-head-h` | 32px | 40px |
| `--cell-px` | 12px | 12px |
| `--card-pad` | 12px | 16px |
| `--section-gap` (between stacked blocks; also the padding of the attention band's tiles and all-clear field) | 16px | 20px |
| `--field-gap-y` / `--field-gap-x` | 12px / 16px | 16px / 16px |
| `--gutter` | 20px | 16px |
| `--tap-min` | 0px | 44px |

The same block carries the one type token, `--text-display` with `-lh`, `-weight` and `-tracking` (28px, 1.2, 800, -0.015em),
used through the `text-display` utility. It is not a density token: it does not flip with the pointer.

`lg` buttons are `--control-h` + 4px (36px / 48px). Mobile bottom-nav links, Tabs, sidebar and drawer items and
standalone action links carry a `--tap-min` floor.

### Form grid: width by content
`lib/formGrid.ts` supplies a 12-column grid. One column below 768px; two columns from `md`; twelve from
`xl` (1280px). Each field declares a span by the size of its content: `short` (codes, numbers, dates,
status: 3 of 12), `medium` (names, pickers, email: 6 of 12), `long` (notes, addresses, textareas: full
row). Modal bodies use the narrower `modalGrid` (two columns from `sm`, `half` / `full` spans).

### Tables
Body rows are `--row-h` and the header `--table-head-h`; cells take `--cell-px` horizontally. Plain-string
cells are capped at 24rem with an ellipsis and a `title` carrying the full text.
Below 768px a table becomes a stack of cards, one per row, each cell labelled by `data-label` in a 12px caption. Under a coarse pointer the cells of a card sit 12px apart
(8px otherwise), so two neighbouring 44px hit areas never overlap.

**The Column Rule.** A column is never removed at md and up. The #161 overflow fix hid columns by breakpoint (`priority`: below xl, 2xl and 1792px), so at 1280 a
task's Trip and Type, a staff member's Manual and Overnight flags, a reservation's Ref and Nights, a billable event's Stream and Day Type were not on the page at all:
the data was deleted to fix the layout. Now every column stays, text is capped with an ellipsis (`maxWidth`, `CellText`), and a table wider than its box scrolls
sideways inside its own box (the page never does). Two columns stay put while it does, so a row is never anonymous and its actions are never out of reach: the first
labelled column (the one that says who the row is; an unlabelled tick or avatar column and the select-all checkbox column scroll away) pins to the start edge, and
the column keyed `actions` pins to the end edge (`pin: 'start' | 'end' | false` picks or opts out). A pinned cell is filled opaque, with a hairline, only while
content is scrolled under it, so a tinted row keeps its tint at rest, and the fill follows the row's hover tint. `priority` is retired and ignored;
`src/test/dataTableColumnRule.test.ts` stops a page asking for it. Derivable secondary text inside a cell (a trip's "(4d)") may still give way by breakpoint; a column may not.

**The Density Rule.** Row height comes from `--row-h`, never from added padding. If a table is too tall,
the answer is a tighter cell (a cap, an ellipsis), not more air, and never a deleted column.

**The Row Action Reveal Rule.** Row actions are `Button size="sm"` / `iconOnly` (24px) and are revealed by
opacity alone (row hover, row focus-within, or control focus), so they stay in the tab order and the
accessibility tree. On a mouse the cluster may overlay the row's trailing cells so it costs no column
width. Under a coarse pointer there is no hover, so they are always shown and stay in the flow.

### Touch hit areas
Two mechanisms, both driven by `--tap-min` (0px on a mouse, 44px on touch), so the desktop look is unchanged.
`TAP_AREA` (`components/tapArea.ts`) is a transparent pseudo-element centred on a control and sized
`max(100%, --tap-min)`: on touch a 36px or 24px control gets a 44px hit area without growing. Two padded
neighbours must sit far enough apart that the pads do not overlap (row-action clusters and `ActionButtons`
widen their gap to 8px on coarse). An `overflow-hidden` ancestor, or a `truncate` link, clips its own pad; a
truncating name link takes `TAP_TRUNCATED_LINK` vertical padding from `md` instead, so its own box is 44px.
`TAP_ICON_SQUARE` is the touch shape of a small icon control in a row cluster (the 36px `--control-h-sm` square
plus the pad; `ActionButtons`, the trip Bookings and Staff tabs). `TAP_AREA_LINKS` (one `tap-area-links` utility in
`index.css`) is the same pad written once for every link in a table body cell, so `DataTable` gives a name link 44px with no caller code, and its pager buttons take
`--control-h`; a cell that mixes a link with small icon buttons must give those buttons the same shape, or the link's
pad overlaps them. `TAP_FLOOR`
(a `min-h-[var(--tap-min)]` with `inline-flex` centring under coarse only) is the other route, for a standalone
link with a line to itself ("View All", "← Back to Trips"): the link is 44px tall and centred, which adds real
height on touch and needs no neighbour spacing. Controls that already floor to `--tap-min` (Tabs, sidebar and drawer items,
bottom-nav links, the header switchers) need neither.

### Page states

A page that does not have its record yet shows `PageState` in place of itself, never a `div` of its own: **loading** (a muted, centred "Loading trip…", a polite
status), **error** (a danger Callout, announced at once, with "Try again" when a retry exists) and **not found** (the message, and a Back to where the user can go).
They are three facts and three states: a failed request is not a missing record, and a 404 from the API is the answer "no such record", not a failure. None of them
adds a heading: the screen's one `h1` still comes from `PageHeader`.

## Elevation & Depth

Depth is tonal, not shadowed. Cards are flat, white and bordered; separation comes from Warm Paper
against white and the warm-grey container steps. Shadows belong to elements that act or float above the page.

### Shadow Vocabulary
- **Tinted Button Halo** (`shadow-md shadow-[var(--color-primary)]/20`): primary buttons.
- **Floating Panel** (`0 24px 40px -12px rgba(27,28,26,0.14)`): dropdown and searchable-select panels.
- **Side Panel** (`shadow-xl`): the `SlideOver` panel docked to the right edge over its scrim.
- **Header Hairline** (`0 24px 32px -12px rgba(27,28,26,0.04)`): the sticky 48px header, a near-invisible
  ambient lift over scrolling content.
- **Focus Ring** (`ring-2 ring-[var(--color-ring)]`): every focusable element; ring only, the border does
  not move.

**The Flat-By-Default Rule.** Surfaces are flat at rest. If a panel in the page flow needs a drop shadow
to be visible, its background is wrong. Floating layers may carry one.

### Layers

Overlays share a short z-scale, and equal z means the later element in the DOM paints on top, so a dialog rendered after a
panel covers it.

| z | Layer |
|---|---|
| 40 | `SlideOver` scrim (`bg-black/40`) |
| 50 | `Modal` and its backdrop (`bg-black/50`), the `SlideOver` panel, the desktop sidebar, the mobile bottom nav |
| 55 / 60 | The mobile nav drawer's scrim / the drawer, below `lg` only: above the bottom nav it overlays |

**Dialog stacking.** Every modal layer runs on `useDialogBehavior`, which keeps the open layers in the order they opened:
Escape and the Tab trap act on the topmost only, focus returns to the control that opened it, and the page stays locked until
the last layer closes. A ConfirmDialog opened from a panel therefore closes by itself and leaves the panel (and its focus)
where it was. Below `lg` the `SlideOver` stops above the bottom nav (which is z-50 and later in the DOM) instead of
running under it.

## Shapes

Gently rounded, driven by radius tokens (`@theme`, used as `rounded-[var(--radius-*)]` and the matching
Tailwind `rounded-sm/md/lg`). Three steps: `sm` (0.375rem, 6px) for controls (buttons, inputs, selects,
row actions); `md` (0.5rem, 8px) for cards, fact bars, nav items and stat cards; `lg` (0.75rem, 12px) for
modals. Status badges, count chips and tab counters are fully round pills. Borders are 1px Ruled Line.
The earlier 1rem / 2rem card and hero radii are retired.

## Components

Primitives live in `frontend/src/components` and are documented in its `README.md`; feature code builds
on them rather than hand-rolling. Tokens do the sizing, so the values below are the fine-pointer state.

### Buttons

Tactile and plain, like a well-used key on a desk.

- **Shape:** `--radius-sm` (6px)
- **Sizes:** `sm` 24px (`text-xs`, `px-3`, table rows), `md` 32px (default, `text-sm`, `px-4`), `lg` 36px
  (a page's single primary action). `iconOnly` is a 24px square. Coarse: 36 / 44 / 48px; `sm` and
  `iconOnly` carry the `TAP_AREA` 44px hit area.
- **Primary:** Ledger Olive fill, white text, tinted halo; hover 90% fill
- **Variants:** `secondary` (white fill, ruled border, Mist hover), `danger` (red fill), `ghost` (muted
  text, Mist fill and olive text on hover)
- **Focus:** 2px olive ring. Renders a router `Link` when given `to`.

### Inputs / Fields

- **Style:** Field Grey fill, 1px ruled border, `--radius-sm`, `px-3`, height `--control-h` (32px; 44px
  coarse); textareas grow from that minimum
- **Focus:** ring only; the border does not move or change colour
- **Labels:** 13px / 500 muted, 4px above the field. Checkbox fields wrap label and box as one
  `--control-h` target.
- **Helper / error:** 12px directly under the field; an error takes the helper's slot (`role="alert"`)
  so the layout does not jump.

### Cards / Containers

- **Corner Style:** `--radius-md` (8px), 1px Ruled Line border, white on Warm Paper, no shadow
- **Internal Padding:** `--card-pad` (12px; 16px coarse); `compact` is 8px. Titles are `text-sm`
  semibold with 8px below.
- **Empty sections:** a section with nothing recorded is one strip, a bordered, centred, muted line about 60px
  tall, the same in Health Conditions, the ADL grids and Risks; `EmptyState` (icon, title, guidance, button) is for a
  page-level void, never inside a card.
- **StatCard:** a Card with a 12px label, a `text-xl` display-bold value and an optional caption; tone
  (neutral, info, success, warning, danger) tints the fill with the tone's soft wash and sets the figure in its ink (`src/lib/tone.ts`). Its opt-in `variant="attention"` is the
  attention band's tile, and given an `action` it is the band's tall tile (see Attention band); the default tile, which Vehicles still uses for its three fleet figures, is unchanged.

### Fact list and fact bar

The read-only counterpart to the form. `FactList` is a `<dl>` with a fixed 10rem label column (13px muted)
and a flowing value column (14px), 24px row pitch; empty values render an em dash. `FactBar` is a single
bordered strip of label/value segments (12px label, 14px medium value) separated by 1px rules, at least
44px tall, with a 16px icon slot. Use them on detail pages instead of a card of disabled inputs.
`FactBar` also has an opt-in `variant="glance"` (big figures, attention tint); it is part of the Detail header
pattern below and the default bar is untouched by it.

### Tables

`DataTable` is the one table (see Layout). Header text is 12px medium muted; body is 14px tabular.
Selection, sorting, inline editing, an optional footer/pager (`--row-h` tall) and vertical dividers are options.

### Boards

The schedule matrix and the roster board are grids of `--row-h` rows with a sticky first column, so each
first column is sized by arithmetic on its content, not by taste. **Schedule:** the Resources column is 20rem
(23rem from `xl`); a staff row is name, then the role ALONE (the region lives in the title), then the
qualification strip, so "Senior Support Worker" reads whole beside a name. **Roster:** the participant label
column is 195px, 280px from 1500px. A participant row header is one line: name (with the restrictive-practice
marker, which survives truncation), the support-ratio chip, and a compact coverage badge, a warning icon and
the number of uncovered days on the amber tint, or a check when the week is fully covered. "6 days uncovered"
and "Fully covered" are the badge's title and accessible name, not text in the row, so the name is what keeps
the room ("Grace Palmer-Hughes" reads whole at 1920).

### Navigation

- **Menu:** one config (`components/layout/navConfig.ts`) feeds the sidebar, the drawer and the bottom bar, so a page is added, moved or
  renamed in one place. Eight top-level entries, four of them collapsible groups: Dashboard, My Shifts, **Trips** (All Trips, Schedule,
  Bookings, Accommodation, Vehicles, Tasks), **Participants** (Participants, Medications, Caregiver forms), **Staff & roster** (Board,
  Patterns, Compatibility, Leave, Completions, Staff, Qualifications), **Finance** (Billing, Claim batches), Incidents, Settings.
  Incidents stays flat on purpose: it is time-critical and one click. The menu is per role. A SupportWorker starts from My Shifts (`/`
  sends them there) and sees only that, Trips (All Trips, Schedule, Tasks), Participants (Participants, Medications) and Incidents.
  ReadOnly is not offered what its API refuses: the five Rostering pages, Finance, Caregiver forms and Settings. A group left with one
  visible page is drawn as that page, and one with none is not drawn.
- **Sidebar:** 232px, Sidebar Grey (`#f5f3ef`) surface, 12px padding, 48px brand block, and the nav
  straight under it: there is no call-to-action slot, and no create shortcut anywhere in the shell (a trip
  is created from the "New Trip" Button in the Trips page header). Items are 32px tall, `rounded-md` (not
  pills), `text-sm`; group children are 28px. Every item, and "Sign Out", carries a `--tap-min` floor, so
  on touch (the drawer, or a touch tablet's permanent sidebar) they are 44px and the list scrolls inside
  the drawer. The active item is Pale Sprout with near-black bold text; inactive is Slate Blue medium with
  a Mist-step hover. A group header is a toggle (a native button with `aria-expanded`), not a link. Which groups are open is remembered
  (localStorage, by group id: only the user's own toggles are saved, and a group opens by itself for the page you are on). A closed group
  shows the total of its children's pending counts and announces it ("7 approvals pending, Staff & roster"); one that holds the current
  page takes the Pale Sprout fill and `aria-current`. Icon ligatures are `aria-hidden`, so a name is the label alone.
- **Header:** 48px sticky, translucent Warm Paper with backdrop blur; global search is 32px tall and 360px
  wide from `md` and 44px on touch (the box takes the floor, the input stretches to fill it). The SuperAdmin tenant and user switchers take a `--tap-min` floor (44px fits the header)
  and show only their badge below `sm`, the name moving into the button's accessible name and tooltip.
- **Mobile:** below `lg` a bottom bar of four pages and **More**, generated from the same config. Office roles: Dashboard, Trips, Roster
  (the Staff & roster group, with its pending count) and Participants. A SupportWorker: My Shifts (with its count), Trips, Participants and
  Incidents. A group's cell is lit on any page of the group, and **More** opens the drawer and is lit on every page the bar does not list,
  so the bar always says where you are. The five cells share the row in equal widths (`flex-1`), each with a `--tap-min` floor; the bar has
  no create action. The active item is olive text.
- **Drawer:** the sidebar, slid over the page below `lg`. Open, it is a modal dialog ("Main menu"): Escape closes it, Tab stays inside it,
  the page behind does not scroll, and focus goes onto its first item and comes back to what opened it (the header toggle or More).
  Closed below `lg` it is `inert`, so its links are out of the Tab order and the accessibility tree; from `lg` it is the permanent
  sidebar and none of this applies. The open drawer and its scrim sit above the bottom bar (z 60 and 55 over 50; from `lg` the sidebar
  drops back to 50 so modals still cover it), so "Sign Out" is never covered by it.
- **A page that throws, or is still loading,** takes over the page area, not the shell: the sidebar, header and bar stay (a lazy chunk
  shows "Loading..." in the page area, and a crash shows the error with its nav a click from safety), and navigating away clears the error.
- **Tabs:** `text-sm` medium, olive underline on the active tab, `--tap-min` minimum height; the active tab lives in the URL (`?tab=`, through `useTabParam`: written with `replace`, dropped at the default, other params kept), so a reload and a shared link land on the same tab; count
  chips are round. Below `md` the strip is ONE row that scrolls sideways (`flex-nowrap`, scrollbar hidden),
  so ten tabs cost a single 44px row on a phone instead of five wrapped ones, and the active tab is scrolled
  into view inside the strip when it changes; from `md` the strip wraps as it always did. Keyboard
  (arrows, Home, End, roving tabindex) and ARIA are the same at every width.
- Icons are Material Symbols Outlined, always preceding the label (16-20px in chrome).

### Page header

One `h1` (20px bold) with the 13px muted subtitle inline after it on desktop, actions on the right. A record's own
page, and the dashboard, can opt into `variant="detail"` (below); every other page keeps this header exactly.

### Detail header pattern

The header of a record's own page, built from three opt-in parts. Each defaults to today's behaviour, so a page that does not
ask for them renders pixel-for-pixel as before (checked by comparing element rects before and after: participant, staff, claim
and accommodation detail, the lists, the dashboard and the schedule at 1920, 1280, 800 and 390 touch for the trip build; trips, trip detail,
participants, staff and incidents at 1920, 1280 and 390 touch for the dashboard build). **The trip detail page opts in to all three parts and
the dashboard takes the title and the meta row; the participant, staff, claim and accommodation detail pages adopt it next**, each mapping
their own facts to tones. It stops at the header: the tab strip and every panel below stay the ordinary dense page, which is what makes the header read as the peak.

- **Title.** `PageHeader variant="detail"`: the display step (28px, Plus Jakarta Sans 800, balanced wrap), still the page's one
  `h1`. The title and its meta row are ONE block, so `--section-gap` opens below the pair rather than between them. The
  actions stay on the right and wrap under the title below 768px exactly as the default header does. Two opt-in props serve the dashboard: `titleNote` sets a second phrase
  in the same `h1`, in the muted ink at the same size (the date after the greeting; each part wraps as a unit, so a phone breaks between them and never inside the date), and
  `documentTitle` names the tab when the `h1` says something else (the greeting changes with the hour, the tab stays "Management Dashboard"). The greeting is
  "Good morning, Sarah" (before noon, then afternoon until 6 pm, then evening; the first word of the signed-in full name, none if there is none) and the date is "Friday 2 October",
  both from the viewer's own clock and refreshed every minute (`lib/greeting.ts`, `hooks/useNow.ts`), so a page left open does not go stale; the one figure that depends on the day, Qualification
  Issues (a credential's warning window opens on a day), is recounted when the day turns over, in step with the date beside it.
- **Meta row.** `PageHeaderMeta` in the subtitle slot. The status leads as `StatusBadge size="md"` (13px semibold, 24px tall); the
  quiet facts follow in 13px muted, joined by middots: "Confirmed · Caloundra QLD · SCB-2608 · 14–17 Aug 2026 · 4 days". A missing
  fact is dropped before the separators are placed, so there is never a dangling dot; a separator belongs to the item before it, so a
  wrapped line can end with one but never begins with one. Date ranges come from `formatDateRange` and always keep the year. The
  dashboard's meta row has no status: it is one line of the everyday counts ("3 upcoming trips · 5 active participants · 4 outstanding tasks"),
  each noun agreeing with its count ("1 upcoming trip", "0 active participants"), in tabular figures.
- **Glance strip.** `FactBar variant="glance"`: equal cells in one ruled `--radius-md` strip. Each cell is a display-step tabular figure
  with the state chip beside it and the icon and a 13px label beneath (source order is label then value, so a screen reader hears "Outstanding
  Tasks, 2, Action Needed"). Two columns (2×2) below 768px, one row from there; a chip that does not fit wraps under its figure instead
  of overflowing. Figures are counts, ratios or short amounts: anything longer belongs in a `FactList`. A ratio is always spelled
  "x / y", a space each side of the slash, through the one `formatRatio` formatter (`glanceRatio` is its earlier name), so no two figures drift ("12 / 10" beside "12/14").

- **Back.** `BackButton` is the header's first action: secondary, an arrow and the word "Back", and it names its destination ("Back to staff") in its
  accessible name, so the one word on screen never leaves a screen-reader user guessing. It is always a real link, 44px on touch, and has three shapes: the secondary
  `button` in the action cluster, a ghost `icon` square beside the title on a form or wizard page, and a `link` for a page with no cluster (the portal). Where it
  goes is `to`; with `history` on (the default) the previous in-app screen wins and `to` is the fallback for a deep link.

**The Attention Tint Rule.** A glance segment is filled only when its own badge signals attention, and the fill is that badge's own tone family:
`warning-container` for pending or time-bound (Waitlist), `error-container` for action needed or outstanding (Action Needed, Outstanding). Everything in
the cell (figure, label, icon) takes the matching on-container colour, so secondary text is tinted from the hue, never grey, and the chip becomes a
card-white pill so it does not vanish into its own fill. Positive and neutral segments stay on the card fill: on a glance segment, or a compact attention tile, an all-clear is a lime chip, never a fill
(the dashboard's all-clear row and field are the one deliberate exception, a whole surface in Pale Sprout that says nothing needs anybody: see Attention band). One
tone decides both chip and fill (`glanceState`), so they cannot disagree, and no colour outside the two containers is ever used. The two fills are
`TONE.warning.solid` and `TONE.danger.solid` (the pairs the status badges wear, `src/lib/tone.ts`), and `attentionOf` decides which tones ask for a tint,
so the glance strip, the attention tile and a badge cannot drift apart. Colour is never the only cue:
the chip text says the same thing. If most segments end up tinted the strip has stopped saying anything, so review the tones, not the tint. The attention band's tiles
follow the same rule with a count as the signal: a danger or warning count above zero takes the error or warning container, and a zero is not a tile at all (it is named in the
All clear row).

### Attention band

The dashboard's answer to "what needs me?", directly under the title, and the peak of the page: as big as the day's trouble. An item that needs action is a **tall tile**, an item at
zero is only a name in ONE **All clear** row, and when nothing needs anybody the whole band is one Pale Sprout field. It replaces the row of equal KPI tiles, which gave "3 upcoming trips"
the same weight as "2 QSC overdue"; those everyday counts now live in the header's meta row. It is `StatCard variant="attention"` tiles in a
`<section aria-label="Needs attention">`, composed by `pages/dashboard/AttentionBand.tsx`, opt-in, so every other StatCard is unchanged.

**Items, in a fixed order**, so a position among the tiles always means the same thing. Each has a tone (what a count above zero takes), a line that says what the count is, in the server's own
terms, and a link to where it is fixed, a route that exists today:

| Item | Tone | The line | The link |
|---|---|---|---|
| Qualification Issues (the Qualifications page) | danger | Expired, undated or due within 30 days, across 3 staff members. | Review qualifications, `/qualifications` |
| Critical Participant Alerts (`canViewAlerts`) | danger | Critical alerts across 2 participants. | Review participants, `/participants` |
| Overdue | danger | Tasks past their due date and still open. | Open overdue tasks, `/tasks?status=Overdue` |
| Missing Accommodation | warning | Trips start within 60 days with no accommodation reserved. | Open trips, `/trips` |
| Missing Vehicles | warning | Trips start within 60 days with no vehicle assigned. | Assign vehicles, `/schedule` |
| Missing Staff | warning | Trips start within 60 days with no staff assigned. | Assign staff, `/schedule` |
| Open Incidents | warning | Incidents not yet resolved or closed. | Open incidents, `/incidents` |
| QSC Overdue | danger | Reportable incidents with no QSC report after 24 hours. | Review QSC reports, `/incidents?qsc=overdue` |
| Pending Leave (`canApproveLeave`) | warning | Leave and unavailability requests waiting for a decision. | Review leave requests, `/rostering/leave` |
| Shift Completions (`canReviewCompletions`) | warning | Submitted shifts waiting for review before they are billed. | Review completions, `/rostering/completions` |

Only what the role can open drops an item (the Qualifications page, `canViewAlerts`, `canApproveLeave`, `canReviewCompletions`: the nav's own gates). Pending Leave and Shift Completions are the two queues the Staff & roster badge adds together, so the band never says nothing needs you beside a badge that does. The summary's `conflictCount` is deliberately not an item: no page lists or fixes conflicts, and it counts every flagged record regardless of date, including the staff overrides a coordinator has already acknowledged. The lines are the server's rules in words (`DashboardController.GetSummary`: a trip counts when it starts today or within 60 days; the Qualifications
page's own warning window; QSC overdue is a reportable incident with no report after 24 hours), and a count of one reads in the singular ("Trip starts", "1 staff member"). A vehicle or a staff
member is assigned to a trip on the Schedule (the assignments the count reads) and accommodation on the trip's own tab, so that tile opens the Trips list to choose the trip; QSC Overdue and
Overdue open their lists already filtered to the rule the figure counts. ReadOnly reaches the Schedule but its writes are refused, so for ReadOnly both Schedule links read "Open schedule" (the same page, no verb it cannot use).

- **Tall tile.** Stacked: the display-step tabular figure, the label at the title step (14px, 600), the line at body secondary (13px) and the link (14px, 700, with a chevron), padded
  `--section-gap` on every side (16px, 20px on touch), the airier step that no dense page uses. Nothing sits beside the figure, so the tile stays tall at any width; four lines deep it is the biggest
  colour field on the page. The fill is the tone's solid pair (`TONE.danger.solid` the error container, `TONE.warning.solid` the warning container, the Attention Tint Rule), and the figure, label, line
  and link all take the matching on-container colour, so secondary text is tinted from the hue, never grey (6.4:1 on the warning container, 7.2:1 on the error container). No icon, no chip. The tile is a
  named group, so its accessible name carries the number and the label ("Overdue 2"), and holds ONE link whose name says what it does ("Open overdue tasks"). The link's pad stretches over the whole tile
  (`after:inset-0`), so the tile is one big target and the focus ring (`ring-2`, the olive ring token) surrounds the tile and not the words; the link's own box keeps a `--tap-min` floor.
- **A zero is a name, not a tile.** The items at zero are named in ONE row after the tiles on Pale Sprout (`TONE.success.solid`, `#bbf37c` with `#0f2000`) with a check: "All clear on trips missing vehicles,
  open incidents and overdue QSC reports" (each item names itself by a NOUN that reads without its tile, since the row has no line under it: "overdue tasks" and "overdue QSC reports" for the labels
  "Overdue" and "QSC Overdue", "trips missing staff" for "Missing Staff"; the tile keeps its label; the names joined "A, B and C", no serial comma). A zero is never tinted and never a tile, so the band's weight is the day's trouble.
- **Nothing needs you.** When every item has data and is at zero the band is one full-width Pale Sprout field, a larger check, "All clear. Nothing needs you right now." and, under it, "Checked and at
  zero:" and every item's noun, so the claim can be audited. It is the same green at the same strength as the row, only the whole band. The sentence is only as true as the list, which is why the list carries what the nav badges count.
- **Loading and failure are not zero.** An item computed from its own request shows an en dash (`–`) in the muted figure style, never a definite 0, while that request is waiting (in flight, or PAUSED while the
  browser is offline, which TanStack reports as pending with `isLoading` false: `awaitsData` in `lib/queryPhase.ts`; a disabled query is not waiting) (`aria-busy="true"` and a
  screen-reader-only "Loading") and after it fails (not busy, and a screen-reader-only "Couldn't load"). It is the compact tile (card fill, a link to the page it counts), has no line and no action, is never
  tinted, is not named in the All clear row, and while one exists the band is not the all-clear field: an all-clear is never claimed without data. The summary itself is held to the same rule: while it is waiting the page is the greeting and the date (they need no data, so the personality is the first thing on screen) over a spinner, with no counts line and no band, never a summary of zeros. Qualification Issues (the staff list), Critical Participant
  Alerts (the participant-alerts aggregate), Pending Leave (the approvals queue, `usePendingLeaveQueue`) and Shift Completions (the review queue, `usePendingCompletionQueue`) do this: a queue's count is 0 while loading and after a failure, so the hooks say which it is.
- **Shape.** The band is a size container and its tiles are dealt into balanced rows by ITS width (the 232px sidebar and the pointer's gutter do not matter): up to 1, 2, 3, 4 and 5 tiles a row from band
  widths of 0, 36, 56, 72 and 96rem (a 390 phone gets 1, a 768 tablet 2, 1280 gets 3, 1440 gets 4 and 1920 gets 5). With n tiles and r to a row there are ceil(n / r) rows, the tiles dealt out evenly (7 at 4 a row
  is 4 + 3) and equal in width within a row, so every row is full and none has a hole (`pages/dashboard/bandLayout.ts`: a 60-track grid, each tile spanning 60 / its row length). The 8px between tiles is padding,
  not a grid gap (60 tracks would add 59 gaps). Nothing truncates, scrolls sideways or shrinks the type, and no label wraps inside its tile at any width.
- **Touch.** The whole tile is the target and the link keeps a `--tap-min` floor, so it is a 44px target.

**The Quiet Zero Rule.** Only a count somebody can act on is loud, and only that is a tile. A zero is a name in the All clear row (Pale Sprout, never a tint), and a value that is not known yet, or failed to load,
is an en dash tile, never a 0 and never an "All clear". The band is the all-clear field only when every item has data and is at zero. If most items are tiles the band has stopped saying anything, so review
the tones, not the tint.

### Status Badges & Alerts

Status is colour-plus-text, never colour alone: the word is always printed, and the tone only says how to read it. `StatusBadge` is the 12px pill
everywhere; `size="md"` (13px semibold, 24px tall) is the one opt-in step up, for the status that leads a detail header's meta row. Critical, Warning and
Info counts render as tinted badges with icon and numeral.

**The tones** (`TONE` in `src/lib/tone.ts`; The Tone Rule). Each tone has a solid pair (a badge, a chip, a glance cell or attention tile: a container and its
on-container text), a soft wash (a tile or a row, paired with the ink) and an ink (text only). The washes are the container at partial opacity.

| Tone | Solid (fill / text) | Soft wash | Ink | Reads as | Used by (examples) |
|---|---|---|---|---|---|
| `neutral` | Field Grey `input` / `muted-foreground` | `surface-container` | `muted-foreground` | no state yet, or no longer | Draft, None, Archived, Not started, Closed, Researching, Planned, Not required, Self managed, anything unlisted |
| `info` | `secondary-container` / `info` | `secondary-container` at 60% | `info` | in the pipeline, nothing wrong; a category | Low, Submitted, Ready, Planning, **In progress**, Published, Validated, NDIA / Agency managed |
| `success` | Pale Sprout `primary-fixed` / `on-primary-fixed` | `primary-fixed` at 40% | `primary` | go, confirmed, paid, all clear | Confirmed, Open for bookings, Completed, Paid, Active, Approved, Resolved, Claimed, Administered |
| `warning` | `warning-container` / `on-warning-container` | `warning-container` | `on-warning-container` | awaiting somebody: a decision, a reply, a confirmation, a hold running out | Pending, Enquiry, Held, Waitlist, Requested, Booked, Under review, Pending review, Withheld, Medium, Partially paid |
| `danger` | `error-container` / `on-error-container` | `error-container` at 30% | `destructive` | action needed, failed, refused, over | Cancelled, Overdue, High, Urgent, Rejected, Expired, Escalated, Declined, Refused, Missed, Wrong medication |
| `accessible` | `accessible-container` / `on-accessible-container` | `accessible-container` at 60% | `on-accessible-container` | accessibility, and the categories that already use its pink; never a state | Plan managed, Shift claim |

- **One mapping per intent.** A trip status is coloured the same in the trip header, the dashboard, the schedule and the trips list (Planning info, Open for
  bookings and Confirmed and Completed success, Waitlist only warning, In progress info, Cancelled danger, Draft and Archived neutral). A task priority is
  coloured the same on the Tasks page, the trip Tasks tab and the dashboard (Low info, Medium warning, High and Urgent danger). The three plan types stay
  apart as categories: NDIA / Agency managed info, Plan managed accessible, Self managed neutral.
- **In progress is information (owner decision, 2026-10-02).** Blue for a trip, a task and a shift alike: it is in the pipeline and nothing is wrong. The
  accessibility pink is for accessibility and for categories (Plan managed, Shift claim), never for a state.
- **Every status the API sends has a row, and a status nobody listed is neutral.** `STATUS_TONE` carries every value of every status enum, and the fallback
  (`StatusBadge`, `statusClass`, `getStatusColor`) is the quiet neutral pair, never the amber "awaiting a decision" one: an unknown word must not claim
  attention (it used to, and the register showed a Closed incident, an Approved claim and a wrong-medication dose in amber). `src/lib/statusToneCoverage.test.ts`
  walks the frontend's `as const` status arrays and, where the backend source sits next to the frontend, the C# enums: a new value, or a new `*Status` enum,
  fails it until somebody has given it a tone. How to read a tone for a new status: neutral is no state yet or no longer, info is in the pipeline with
  nothing wrong, success is done or good, warning is awaiting somebody, danger is a failure, a refusal or something that needs action. A domain whose word
  means something else still passes a `colorMap` (a cancelled leave request is over, not a failure).
- **API.** `StatusBadge` takes a `status` word (looked up in `STATUS_TONE`), or a `tone` and a `label` (`<StatusBadge tone="danger" label="Refused" />`). Its
  `colorMap` overrides the map for one domain, and its values are tones. The older tone words still work: Callout `error` is `danger`, FactChip `positive` is
  `success` and `negative` is `danger`.
- **The status words, by domain** (every real value; `STATUS_TONE` is the source). Incidents: Draft neutral, Submitted info, Under review warning, Escalated danger,
  Resolved success, Closed neutral. Claims and billable events: Draft neutral, Ready, Submitted, Validated, Routed info, Approved, Claimed, Invoiced, Paid success,
  Partially paid warning, Rejected and Cancelled danger. Bookings, reservations, vehicle requests and activities: Enquiry, Held, Waitlist, Requested, Booked warning
  (not yet on the trip, or not yet confirmed), Researching and Planned neutral, Confirmed and Completed success, Cancelled and Unavailable danger. Shifts and tasks:
  Draft and Not started neutral, Published and In progress info, Pending review warning, Completed success, Overdue and Cancelled danger. Payments: Not invoiced neutral,
  Invoice sent info, Partial warning, Paid success, Overdue danger. Medication: Administered success, Withheld and On hold warning, Refused, Missed, Wrong medication
  and Ceased danger. Notifications and submissions: Sent and Accepted success, Skipped neutral, Failed, Revoked and Rejected danger.
- **Contrast.** Every pair above is held to WCAG AA (4.5:1) by `src/test/toneContrast.test.ts`, which reads the palette from `src/index.css`; the closest is the info
  solid at 5.0:1. `--color-warning` (amber) is for fills, borders and rings, never text or an icon (2.15:1 on the card): warning text is `TONE.warning.ink`.
- **Readiness note.** A participant who is not fully ready shows a quiet, never-blocking warning-tone note (`ReadinessNote`): a chip in a row or beside a
  detail header's status badge, or a line under a field, reading "Not ready: Intake not complete · No signed service agreement" in the server's own words,
  truncated with the whole text in a `title`. It is informational (never an alert, never disables a control) and a ready participant draws nothing.

**Deadline wording** (`deadlineState`, `deadlineLabel` and `DEADLINE_TONE` in `src/lib/deadline.ts`). A dated deadline (a credential's expiry, a review
due date) has one state and one set of words, never a string of its own. The date is a calendar day, so the count cannot shift with the time zone or a
daylight-saving change (`src/lib/dateOnly.ts`). The badge is `<StatusBadge tone={DEADLINE_TONE[state.status]} label={deadlineLabel(state)} />`.

| State | Long (a badge on its own) | Compact (no room for the lead-in) | Tone |
|---|---|---|---|
| Overdue (the day has passed) | Expired | Expired | `danger` |
| Today | Expires today | Expires today | `warning` |
| Soon (within the warning window) | Expires in 12 days | 12 days | `warning` |
| Fine | Current | Current | `success` |
| No date | No date set | No date set | `neutral` |

Capitalised like a sentence ("Expired", never "EXPIRED"). Use the long form unless the cell has no room for "Expires in": a staff member's Credentials tab is long, the
Qualifications table (each row a wrapping card on a phone) is compact. Which credentials count is
`src/lib/credentials.ts`: a flagged credential applies with or without a date, and worker screening (no flag) applies only once it has an expiry date. The
Qualifications list, a staff member's Credentials tab and the Dashboard's Qualification Issues figure all read it, so the figure is the sum of the list's
issue counts.

### Time on the wire

Every date and time that crosses the API is exactly ONE of three kinds, and the screen reads each with the helper for its kind. A new field is an instant
unless a person typed it as a clock reading or it is a calendar date.

| Kind | On the wire | Examples | Read it with |
|---|---|---|---|
| **Instant** (a moment that happened) | UTC with a trailing Z: `2026-10-03T05:00:00Z` | created, updated, last login, dose given (`administeredAt`), submitted, claim-batch times, a shift's actual start | `parseApiDate`, then `formatWithTimeZone`, `formatRelative`, `formatAge`, `formatDateTimeAu` |
| **Wall clock** (provider-local digits) | NO zone: `2026-10-03T08:00:00` | a dose slot (`scheduledAt`, `occursAt`), the incident time and the notified-at times typed into a `datetime-local` input, a medication's start, end and review dates, a staff availability day | `formatWallClock`, `toDatetimeInputValue`, `datetimeInputNow` (`src/lib/wallClock.ts`); never converted |
| **Date** (a calendar day) | `DateOnly`: `2026-10-05` | trip dates, plan dates, due and expiry dates | `src/lib/dateOnly.ts`: `parseDateOnly`, `calendarDaysUntil`, `eachDay`, `localIsoDate`; due-day rules through `deadlineState` / `isPastDue` |

**Why.** 136 of the 138 timestamp columns are `timestamp without time zone` and the API runs Npgsql's legacy timestamp switch, so a UTC instant read back from
the database has Kind Unspecified, and System.Text.Json used to write it with no suffix. A browser reads a zone-less ISO string as LOCAL time, so in Sydney (UTC+10,
UTC+11 from Sun 4 Oct 2026) every instant read 10-11 hours wrong ("Last dose 10 hrs ago" for a dose given 10 minutes earlier). Marking each instant where it is built
would be a hundred edits, so it is done once, at the boundary.

**On the server.** `UtcInstantDateTimeConverter` is registered in `ApiJsonOptions.Configure`: every DateTime is UTC with Z. A member that is a wall-clock value or a
calendar date held in a DateTime carries `[WallClock]` (`WallClockDateTimeConverter`: no zone, never shifted, read back as exactly the digits sent). `DateOnly`, `TimeOnly`
and `DateTimeOffset` are untouched. `DateTimeWireInventoryTests` walks every DateTime reachable from a controller and fails unless it is an instant with Z or one of the listed
wall-clock fields, each with its reason: adding a wall-clock field means adding it to that list.

**Rules.**
- A wall-clock value is never turned into an instant: no `parseApiDate`, no `formatWithTimeZone`, no `new Date(x)` then `toLocaleString`. Read as UTC it moved by the offset
  (an incident typed as 08:00 showed "6:00 pm" in Sydney and "4:00 am" in New York).
- "Today" for a calendar rule is the PROVIDER's date. On the server that is `ProviderTimeZoneResolver.TodayAsync` (never `DateTime.UtcNow`, which is still yesterday until
  10:00 or 11:00 in Sydney); in the browser it is the viewer's local date (`localIsoDate`, `deadlineState`; the dashboard's greeting and date are read the same way, `lib/greeting.ts`: the browser has no provider zone of its own, so the viewer's own day is the stand-in), never `new Date().toISOString().split('T')[0]` (the UTC date).
- A due day is overdue from the day AFTER it, never on it (`deadlineState`, `isPastDue`), and a count of days or nights is whole calendar days (`calendarDaysUntil`,
  `eachDay`), never milliseconds divided by 86 400 000 (a day is 23 hours long when the clocks go forward).
- A wall-clock value is compared with "now" only after the provider's zone is applied (`ProviderLocalTime.LocalToUtc`), the way the MAR decides a dose is overdue.
- Three traps: `new Date("2026-10-03T08:00:00")` is LOCAL, `new Date("2026-10-03")` is UTC midnight (10:00 in Sydney), and `toISOString()` is always the UTC date.

### Shift package

The support worker's shift screen (`/portal/shifts/:id`) is a "Shift Checklist" in three phases: Before (handover, At a glance in a fixed order, emergency contacts with `tel:` links, then Start), During (a time-grouped list of doses and routines, "As needed" as its own group), End (a checklist that must clear, then a read-only summary and Finish). On tablet and desktop At a glance is pinned beside the checklist.

- Overdue doses rise to the top in the warning tone and nothing else is warning. Danger is for anaphylaxis only. Plain words: "Give by 12:30", "Not given this shift".
- Every empty At a glance field prints "Not recorded"; a null is never shown as "No".
- Recording a dose is a sheet, not a page. A failed save keeps every entry and the same idempotency key, so a retry cannot record twice.
- Times follow "Time on the wire": slots and routines are wall clock; a time typed into a datetime-local control (break edits, time given) is read in the provider zone and sent as a UTC instant with Z.
- The screen is online-only: offline shows a banner and switches the actions off. Start is refused more than 60 minutes before the rostered start; the server message names when it opens.

### Modals

`--radius-lg`, 16px padding, 90vh max height with internal scroll.

**Side panel (`SlideOver`).** Creating or editing a record from a list opens a panel docked to the right edge, not a centred
modal, so the list stays in view behind it: full height, 28rem wide (`md`) or 32rem (`lg`), a ruled left edge, the
Side Panel shadow, over a `bg-black/40` scrim. The header is a `font-display` 16px title and a ghost icon-only close button
(a 44px hit area on touch). The body scrolls and the footer (Cancel and Save on the right, a destructive action on the left)
stays put. The panel slides in over 200ms and simply appears under reduced motion. It behaves as a dialog: focus moves in and
returns to the opener, Tab stays inside, Escape closes, and the page behind does not scroll. A form with unsaved edits asks
"Discard changes?" before Escape, the scrim or the close button closes it; a footer Cancel is an explicit discard and does
not. Never hand-roll a `fixed right-0` panel: use `SlideOver`.

## Do's and Don'ts

### Do:
- **Do** size every control, row, card and gap from the density tokens (`h-[var(--control-h)]`,
  `--row-h`, `--card-pad`, `--section-gap`, `--gutter`) so the coarse-pointer flip is automatic
- **Do** reach 44px on touch by token (`--control-h`), a `--tap-min` floor (`TAP_FLOOR`, for a link with a
  line to itself) or the `TAP_AREA` pad, never by inflating the desktop size
- **Do** lay forms out with `formGrid` and `span.short | medium | long` by the width of the content
- **Do** put row actions in `RowActions` (opacity reveal, always visible on coarse) and keep an action
  that must always be seen (a status pill, a queue's only call to action) outside it
- **Do** show read-only detail with `FactList` / `FactBar`
- **Do** render one `<h1>` per screen via `PageHeader`
- **Do** give a record's own page the detail header pattern by opting in (`variant="detail"`, `variant="glance"`), never by restyling the default header or bar
- **Do** derive a glance segment's chip and tint from one tone with `glanceState`
- **Do** colour a status by its tone: add the word to `STATUS_TONE` (or pass a `colorMap` of tones for a domain whose word means something else), never a class string of its own
- **Do** make nouns agree with counts through `plural()`, spell ratios through `formatRatio()` ("x / y") and relative times through `formatRelative()` (`src/lib/format.ts`), and state a dated deadline through `deadlineState()` and `deadlineLabel()` (`src/lib/deadline.ts`), never by hand
- **Do** early-return a record that is loading, failed or missing through `PageState`, give a detail page one `BackButton` that names its destination, and keep its active tab in the URL with `useTabParam`
- **Do** put what needs action in the attention band, as a tall tile with its figure, a line saying what it means and a link to where it is fixed, and the everyday counts in the header's meta row, so the loudest thing on the dashboard is the thing to act on; **do** let the all-clear be the Pale Sprout row and field and nothing else
- **Do** show an en dash, not a `0`, for a figure whose request is still loading (`aria-busy`) or has failed ("Couldn't load"), and never an "All clear" without data
- **Do** read every date and time by its kind (instant, wall clock, date: "Time on the wire"), take "today" from the provider (server) or the viewer's local date (browser), and call a due day overdue only from the day after it (`deadlineState`, `isPastDue`)
- **Do** use `Button` for every action; it owns height, radius and focus
- **Do** keep compliance state, alerts and countdowns visually equal to ordinary data
- **Do** express depth with warm tonal surfaces; reserve shadow for the primary button, floating panels,
  the side panel and the header hairline
- **Do** open a record from a list in a `SlideOver`, and run any dialog on `useDialogBehavior`: Escape, the Tab trap, focus return and the scroll lock come with it, and a dialog opened over another closes alone

### Don't:
- **Don't** hardcode hex, `rgb()` or any literal colour in feature code; use `var(--color-*)` or a
  `Button` variant
- **Don't** restate a pixel size for control, row or card padding inside a component; point at the token
- **Don't** add padding to a table row to make it breathe, or set text below 12px to save width
- **Don't** hide row actions with `display: none`, `visibility: hidden` or `pointer-events: none`;
  hide by opacity so focus, screen readers and voice control still reach them
- **Don't** use pure `#ffffff` as a page background or pure `#000000` as text
- **Don't** invent a colour outside the semantic list to express a new state
- **Don't** give a category (a plan type, a witness type) the warning or danger tone, or use `--color-warning` for text or an icon: warning text is `TONE.warning.ink`
- **Don't** parse a wall-clock value as an instant, or compare a due date with `Date.now()`, or save `new Date().toISOString().split('T')[0]` as "today" (the UTC date), or do day maths in milliseconds
- **Don't** add a second page heading
- **Don't** use the display step (`text-display`) anywhere but a detail page's title, the dashboard's title and the figures of a glance strip or the attention band, or add a second display size
- **Don't** tint a glance segment its own badge calls fine, or fill one with anything but the warning-container or error-container
- **Don't** make a tile of a zero or tint one, or claim "All clear" without data (while its request is in flight, or after it failed)
- **Don't** restyle a single module more heavily than any other; design effort is uniform by commitment

## Marketing surface (/welcome/)

The public landing page ("Living Canopy Light") is the same product seen from outside, documented in `frontend/welcome/DESIGN.md`. It shares this system's tokens by value: `frontend/welcome/welcome.css` repeats the `@theme` values from `src/index.css` under the same names (the greens, Warm Paper, Ledger Ink, Ruled Line, Field Grey, the warning and error tones, the radii and both faces), and `frontend/welcome/tokens.test.ts` fails if any of them drifts from the app.

- **Change a shared token here first.** When this file or `src/index.css` changes a colour, radius or face that the landing declares, update `welcome.css` in the same change, or the test fails.
- **Copy, never import.** The landing is its own Vite entry and does not import `src/index.css`, so the app's base styles and components do not leak onto it, and its canopy styles do not leak into the app.
- **What the landing adds** is a forest canopy ground (`#0f2000`, the app's `on-primary-fixed`), warm-paper text at 84% and 70%, Sprout hairlines at 20%, and a WebGL light field. Its paper surfaces ("clearings") follow this system exactly. None of these additions belong in the app.
