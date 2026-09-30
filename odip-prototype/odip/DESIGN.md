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
    fontWeight: 600
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
---

# Design System: ODIP

> Recorded from the shipped density-redesign build (2026-09), not from the plan. Where the build and
> `docs/specs/density-redesign-2026-09.md` differ, the build is recorded and the difference is noted.

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
The ramp is short and flat because the density comes from layout. Measured at 1920: h1 20px, table cells 14px.
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
  (neutral, info, success, warning, danger) tints the fill from the semantic containers.

### Fact list and fact bar

The read-only counterpart to the form. `FactList` is a `<dl>` with a fixed 10rem label column (13px muted)
and a flowing value column (14px), 24px row pitch; empty values render an em dash. `FactBar` is a single
bordered strip of label/value segments (12px label, 14px medium value) separated by 1px rules, at least
44px tall, with a 16px icon slot. Use them on detail pages instead of a card of disabled inputs.

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
- **Tabs:** `text-sm` medium, olive underline on the active tab, `--tap-min` minimum height; count
  chips are round. Below `md` the strip is ONE row that scrolls sideways (`flex-nowrap`, scrollbar hidden),
  so ten tabs cost a single 44px row on a phone instead of five wrapped ones, and the active tab is scrolled
  into view inside the strip when it changes; from `md` the strip wraps as it always did. Keyboard
  (arrows, Home, End, roving tabindex) and ARIA are the same at every width.
- Icons are Material Symbols Outlined, always preceding the label (16-20px in chrome).

### Page header

One `h1` (20px bold) with the 13px muted subtitle inline after it on desktop, actions on the right.

### Status Badges & Alerts

Status is colour-plus-text, never colour alone. Confirmed/active use Pale Sprout, draft/none use Field
Grey, cancelled/overdue/conflict use the error container, pending uses the warning container, info the
Pale Slate. Critical, Warning and Info counts render as tinted badges with icon and numeral.

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
- **Don't** add a second page heading
- **Don't** restyle a single module more heavily than any other; design effort is uniform by commitment
