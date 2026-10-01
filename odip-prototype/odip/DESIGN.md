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
  near-black text.

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
  headline, in Plus Jakarta Sans. Only the title of a detail page and of the dashboard (`PageHeader variant="detail"`), the figures of a
  glance strip (`FactBar variant="glance"`) and the figures of the attention band (`StatCard variant="attention"`), all in tabular figures.
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
| `--section-gap` | 16px | 20px |
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
cells are capped at 24rem with an ellipsis and a `title` carrying the full text. Columns carry a priority
(`high`, `medium`, `low`, `lowest`) and drop out below xl / 2xl / 1792px rather than squeezing the rest.
Below 768px a table becomes a stack of cards, one per row, each cell labelled by `data-label` in a 12px caption. Under a coarse pointer the cells of a card sit 12px apart
(8px otherwise), so two neighbouring 44px hit areas never overlap.

**The Density Rule.** Row height comes from `--row-h`, never from added padding. If a table is too tall,
the answer is fewer columns, not more air.

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
- **Header Hairline** (`0 24px 32px -12px rgba(27,28,26,0.04)`): the sticky 48px header, a near-invisible
  ambient lift over scrolling content.
- **Focus Ring** (`ring-2 ring-[var(--color-ring)]`): every focusable element; ring only, the border does
  not move.

**The Flat-By-Default Rule.** Surfaces are flat at rest. If a panel in the page flow needs a drop shadow
to be visible, its background is wrong. Floating layers may carry one.

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
  attention band's tile (see Attention band); the default tile, which Vehicles still uses for its three fleet figures, is unchanged.

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

- **Sidebar:** 232px, Sidebar Grey (`#f5f3ef`) surface, 12px padding, 48px brand block, and the nav
  straight under it: there is no call-to-action slot, and no create shortcut anywhere in the shell (a trip
  is created from the "New Trip" Button in the Trips page header). Items are 32px tall, `rounded-md` (not
  pills), `text-sm`; group children are 28px. Every item, and "Sign Out", carries a `--tap-min` floor, so
  on touch (the drawer, or a touch tablet's permanent sidebar) they are 44px and the list scrolls inside
  the drawer. The active item is Pale Sprout with near-black bold text; inactive is Slate Blue medium with
  a Mist-step hover.
- **Header:** 48px sticky, translucent Warm Paper with backdrop blur; global search is 32px tall and 360px
  wide from `md` and 44px on touch (the box takes the floor, the input stretches to fill it). The SuperAdmin tenant and user switchers take a `--tap-min` floor (44px fits the header)
  and show only their badge below `sm`, the name moving into the button's accessible name and tooltip.
- **Mobile:** below `lg` a bottom bar of the page links a role may open (Dashboard, Trips, People,
  Settings; a SupportWorker sees the first three). They share the row in equal-width cells, so the spacing
  stays even whichever are gated out, and each has a `--tap-min` floor; the bar has no create action. The
  active item is olive text. The open drawer and its scrim sit above the bottom bar (z 60 and 55 over 50;
  from `lg` the sidebar drops back to 50 so modals still cover it), so "Sign Out" is never covered by it.
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
  actions stay on the right and wrap under the title below 768px exactly as the default header does.
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
card-white pill so it does not vanish into its own fill. Positive and neutral segments stay on the card fill: an all-clear is a lime chip, never a fill. One
tone decides both chip and fill (`glanceState`), so they cannot disagree, and no colour outside the two containers is ever used. The two fills are
`TONE.warning.solid` and `TONE.danger.solid` (the pairs the status badges wear, `src/lib/tone.ts`), and `attentionOf` decides which tones ask for a tint,
so the glance strip, the attention tile and a badge cannot drift apart. Colour is never the only cue:
the chip text says the same thing. If most segments end up tinted the strip has stopped saying anything, so review the tones, not the tint. The attention band's tiles
follow the same rule with a count as the signal: a non-zero danger or warning count takes the error or warning container, and a zero stays
on the card fill.

### Attention band

The dashboard's answer to "what needs me?": one band of display-step figures directly under the title, where an item that needs action is the
loudest thing on the page and an item at zero goes quiet. It replaces the row of equal KPI tiles, which gave "3 upcoming trips" the same weight
as "2 QSC overdue"; those everyday counts now live in the header's meta row. It is `StatCard variant="attention"` tiles in a
`<section aria-label="Needs attention">`, opt-in, so every other StatCard is unchanged.

- **Items, in a fixed order**, so a position always means the same thing: Qualification Issues (link `/qualifications`, danger), Critical
  Participant Alerts (only with `canViewAlerts`; link `/participants`; danger), Overdue (danger), Missing Accommodation, Missing Vehicles, Missing
  Staff and Open Incidents (warning), QSC Overdue (danger), Pending Leave (only with `canApproveLeave` and a non-empty queue; link
  `/rostering/leave`; warning). Only those two conditions drop an item; every other one keeps its place at zero, so the layout is stable.
- **Tile.** A display-step tabular figure over a 13px medium label, in its own bordered `--radius-md` tile with `--card-pad` above and below and 8px at the sides
  (the compact card's inset: the glance cell's 12px, 16px from xl, wrapped "Critical Participant Alerts" at 1920). No icon, and no chip on an
  item that needs attention. Source order is label then figure (the strip's order), so a screen reader hears "Overdue, 2". A
  linked tile's accessible name is its content ("Qualification Issues 5") and an unlinked one is a named group ("Overdue 2"), so the number and
  the label are always in the name and colour never carries the meaning alone.
- **Non-zero is loud, zero is quiet.** A non-zero count is tinted exactly as a glance segment is (The Attention Tint Rule): danger takes the error
  container (`TONE.danger.solid`), warning the warning container (`TONE.warning.solid`), and the figure and the label take the matching on-container colour. A zero is untinted, on the card fill,
  with the figure and the label in `muted-foreground`. The two items that carry a caption say "All clear" at zero, as the lime positive chip beside
  the figure (the glance strip's own all-clear); it never appears on a tint.
- **Loading and failure are not zero.** An item computed from its own request shows an en dash (`–`) in the muted figure style, never a definite 0,
  while that request is in flight (`aria-busy="true"` and a screen-reader-only "Loading") and after it fails (not busy, and a screen-reader-only
  "Couldn't load"). Either way it is untinted and never says "All clear": an all-clear is never claimed without data. Qualification Issues (the
  staff list) and Critical Participant Alerts (the participant-alerts aggregate) do this.
- **Shape.** Two columns below 768px (an odd last item takes the whole row, as on the trip strip). From 768px two balanced rows: ceil(n / 2) columns,
  an odd last item stretching over the spare slot so no row has a hole. ONE row when the band's own width gives every item 173px, measured by a
  container query so the 232px sidebar does not matter: n × 173 + (n − 1) × 8px, which is 1259, 1440 and 1621px for 7, 8 and 9 items. 173px is what
  the widest label ("Critical Participant Alerts", 152.6px at 13px) needs on one line inside the tile's 8px sides and borders, so a one-row band is
  78px tall and never wraps a label. So the band is one row at a 1920 viewport for every role, and two balanced rows at 1440 and 1280. A label wraps
  only where its tile is narrower than that (a 360px phone, a tablet); nothing truncates, scrolls sideways or shrinks the type.
- **Touch.** A linked item is the whole tile and keeps a `--tap-min` floor (it is already taller than 44px).

**The Quiet Zero Rule.** Only a count somebody can act on is loud. A zero never takes a tint and its figure is muted, and a value that is not
known yet, or failed to load, is an en dash, never a 0 and never an "All clear". If most items are tinted the band has stopped saying anything,
so review the tones, not the tint.

### Status Badges & Alerts

Status is colour-plus-text, never colour alone: the word is always printed, and the tone only says how to read it. `StatusBadge` is the 12px pill
everywhere; `size="md"` (13px semibold, 24px tall) is the one opt-in step up, for the status that leads a detail header's meta row. Critical, Warning and
Info counts render as tinted badges with icon and numeral.

**The tones** (`TONE` in `src/lib/tone.ts`; The Tone Rule). Each tone has a solid pair (a badge, a chip, a glance cell or attention tile: a container and its
on-container text), a soft wash (a tile or a row, paired with the ink) and an ink (text only). The washes are the container at partial opacity.

| Tone | Solid (fill / text) | Soft wash | Ink | Reads as | Used by (examples) |
|---|---|---|---|---|---|
| `neutral` | Field Grey `input` / `muted-foreground` | `surface-container` | `muted-foreground` | no state | Draft, None, Archived, Not required, Self managed |
| `info` | `secondary-container` / `info` | `secondary-container` at 60% | `info` | information, a category | Low, Submitted, Planning, NDIA / Agency managed |
| `success` | Pale Sprout `primary-fixed` / `on-primary-fixed` | `primary-fixed` at 40% | `primary` | go, confirmed, paid, all clear | Confirmed, Open for bookings, Completed, Paid, Active |
| `warning` | `warning-container` / `on-warning-container` | `warning-container` | `on-warning-container` | pending or time-bound | Pending, Waitlist only, Medium, Partially paid |
| `danger` | `error-container` / `on-error-container` | `error-container` at 30% | `destructive` | action needed, failed, over | Cancelled, Overdue, High, Urgent, Rejected, Expired |
| `accessible` | `accessible-container` / `on-accessible-container` | `accessible-container` at 60% | `on-accessible-container` | accessibility, and the categories that already use its pink | Plan managed, In progress (a trip), Shift claim |

- **One mapping per intent.** A trip status is coloured the same in the trip header, the dashboard, the schedule and the trips list (Planning info, Open for
  bookings and Confirmed and Completed success, Waitlist only warning, In progress accessible, Cancelled danger, Draft and Archived neutral). A task priority is
  coloured the same on the Tasks page, the trip Tasks tab and the dashboard (Low info, Medium warning, High and Urgent danger). The three plan types stay
  apart as categories: NDIA / Agency managed info, Plan managed accessible, Self managed neutral.
- **API.** `StatusBadge` takes a `status` word (looked up in `STATUS_TONE`), or a `tone` and a `label` (`<StatusBadge tone="danger" label="Refused" />`). Its
  `colorMap` overrides the map for one domain, and its values are tones. The older tone words still work: Callout `error` is `danger`, FactChip `positive` is
  `success` and `negative` is `danger`.
- **Contrast.** Every pair above is held to WCAG AA (4.5:1) by `src/test/toneContrast.test.ts`, which reads the palette from `src/index.css`; the closest is the info
  solid at 5.0:1. `--color-warning` (amber) is for fills, borders and rings, never text or an icon (2.15:1 on the card): warning text is `TONE.warning.ink`.

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

### Modals

`--radius-lg`, 16px padding, 90vh max height with internal scroll.

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
- **Do** put what needs action in the attention band and the everyday counts in the header's meta row, so the loudest thing on the dashboard is the thing to act on
- **Do** show an en dash, not a `0`, for a figure whose request is still loading (`aria-busy`) or has failed ("Couldn't load"), and never an "All clear" without data
- **Do** use `Button` for every action; it owns height, radius and focus
- **Do** keep compliance state, alerts and countdowns visually equal to ordinary data
- **Do** express depth with warm tonal surfaces; reserve shadow for the primary button, floating panels
  and the header hairline

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
- **Don't** add a second page heading
- **Don't** use the display step (`text-display`) anywhere but a detail page's title, the dashboard's title and the figures of a glance strip or the attention band, or add a second display size
- **Don't** tint a glance segment its own badge calls fine, or fill one with anything but the warning-container or error-container
- **Don't** tint an attention tile at zero, or claim "All clear" without data (while its request is in flight, or after it failed)
- **Don't** restyle a single module more heavily than any other; design effort is uniform by commitment
