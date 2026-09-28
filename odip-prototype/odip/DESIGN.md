---
name: ODIP
description: Operational ledger for Australian NDIS trip and participant management — calm, high-density, audit-first.
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
    fontSize: "1.5rem"
  title:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontWeight: 600
  body:
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif"
    fontWeight: 400
  label:
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif"
    fontWeight: 500
rounded:
  sm: "0.5rem"
  md: "1rem"
  lg: "2rem"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.sm}"
    padding: "1rem 1.25rem"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "1rem 1.25rem"
  button-danger:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.sm}"
  button-ghost:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.sm}"
  input-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "0.625rem 1rem"
  card-surface:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
    padding: "1.25rem"
---

# Design System: ODIP

## Overview

**Creative North Star: "The Operational Ledger"**

ODIP is a working record before it is a product. It is used by office coordinators running the
operational day of Australian NDIS disability services — participant bookings, staff and vehicle
rostering, accommodation, compliance countdowns. Someone sits in this system for hours. The design's
job is to make a long day of dense, consequential work feel calm and legible rather than clinical or
flattering. Everything here is in service of reading a lot of state quickly and trusting that what
is on screen is what is true.

The palette is earthy and deliberately un-glossy: a deep olive primary on a warm off-white
background, never pure white as the page, never pure black as text. Surfaces separate by warm-grey
tonal stepping rather than by shadow. Density is a feature. This is a ledger: rows, columns,
badges, timestamps and state chips, laid out so a coordinator can scan for the one thing that is
wrong. The interface should feel like good stationery — plain, durable, already in use.

Compliance is core behaviour, not an add-on. Timers, alerts and audit state are given the same
visual weight as ordinary data, because in this domain they are ordinary data. Nothing in the system
may read as a warning unless it genuinely is one.

**Key Characteristics:**
- Warm, earthy, low-gloss; depth by tonal stepping, not by shadow
- High information density with a strict, repeated row-and-column rhythm
- Colour used semantically and sparingly — a ledger's colours mean something
- Compliance state (alerts, countdowns, audit) is first-class, never decorative
- 44px minimum touch targets throughout; built for shared kiosks and long sessions

## Colors

A single olive-green accent family on a warm neutral base, with slate and rose reserved strictly
for the secondary and accessibility roles.

### Primary
- **Ledger Olive** (`#396200`): the single accent. Primary buttons, focus rings, selected state,
  success and "go" actions. Its rarity is what gives it meaning.
- **Deep Fern** (`#4d7c0f`): the container step, used where the primary needs to sit beneath other
  content without becoming the loudest thing on screen.
- **Pale Sprout** (`#bbf37c`): the *fixed* step — a high-visibility tint reserved for the active
  navigation item and similar "you are here" surfaces, paired with near-black text.

### Secondary
- **Slate Blue** (`#515f74`): informational and neutral-support colour — also reused as the `info`
  status. It never competes with the olive.
- **Pale Slate** (`#d5e3fc`): secondary container, for informational blocks.

### Neutral
- **Warm Paper** (`#fbf9f5`): the page background. Warm, never pure white — the ledger is paper.
- **Ledger Ink** (`#1b1c1a`): body and heading text. Near-black with a green undertone, never `#000`.
- **Mist** (`#efeeea`): muted and accent surfaces, table zebra striping, hover fills.
- **Ruled Line** (`#c3c9b5`): all borders and outlines. Slightly green-grey, never a neutral grey.
- **Field Grey** (`#e4e2de`): input backgrounds, so a field reads as writable.

### Named Rules

**The Semantic Colour Rule.** A colour never carries meaning twice. `primary` is "go / selected /
success", `secondary` is "information", `destructive` is "destructive", `warning` is "time-bound
compliance", `accessible-container` is "accessibility". If a screen is reaching for a colour that
isn't on this list, it is reaching for the wrong thing.

**The Warm Base Rule.** The page is never `#ffffff` and text is never `#000000`. Warm off-white
(`#fbf9f5`) and near-black (`#1b1c1a`) are what separate ODIP from a generic Material dashboard.

## Typography

**Display Font:** Plus Jakarta Sans (system-ui fallback)
**Body Font:** Manrope (system-ui fallback)
**Label/Mono Font:** Manrope at medium weight; tabular figures for IDs, numbers and timers

**Character:** A geometric-humanist sans pairing — Jakarta's open apertures for headings,
Manrope's slightly warmer, more even rhythm for body and data. Both are calm rather than
authoritative, which is the point: the authority comes from the layout, not the type.

### Hierarchy
- **Display** (600–800): page-level statements. Rare.
- **Headline** (700, 1.5rem / `text-2xl`): the page title in `PageHeader`, one per screen.
- **Title** (600): card and section headings, column-group headers.
- **Body** (400, `text-sm`): the default. Table cells, descriptive copy.
- **Label** (500, `text-sm` and down): form labels, badges, navigation. Small type is used, never
  shrunk to illegibility — the density comes from layout, not from micro-type.

**The One Heading Rule.** Exactly one `<h1>` per screen, and it comes from `PageHeader`. Tabbed
pages render the tab body, not a second heading — a screen that needs two titles is two screens.

## Layout

A fixed desktop sidebar plus a fluid content column, collapsing to a bottom bar on mobile. Spacing
follows a 4/8/12/16/24px rhythm; the 1rem step is the default gutter. Grids are two-column for form
fields (`md:grid-cols-2`) and full-width for data.

Data density is the layout's primary job. Tables own as much horizontal space as they need; the
sidebar yields before a table does. Onboarding and enquiry tables keep their primary action in the
first column (Provenance is capped) so the eye lands on what can be acted on.

**The Density Rule.** Never add vertical padding to a table row to make it breathe. If a table is
too tall, the answer is fewer columns, not more air.

## Elevation & Depth

Depth is tonal, not shadowed. Overlays, active navigation and the fixed primary tint carry
separation; the page itself stays flat. Shadows appear in exactly one place — the primary button —
and only as a faint tinted halo.

### Shadow Vocabulary
- **Tinted Button Halo** (`shadow-md shadow-[var(--color-primary)]/20`): primary buttons only, to
  lift the one element that acts.
- **Focus Ring** (`ring-2 ring-[var(--color-ring)]`): every focusable element. The main depth cue in
  the system.

**The Flat-By-Default Rule.** Surfaces are flat at rest. Separation comes from warm tonal steps
(`surface-container` → `-low` → `-high`). If a panel needs a drop shadow to be visible, its
background is wrong.

## Shapes

Gently rounded, never sharp, never pill-shaped. Three steps: small (0.5rem) for buttons and inputs,
medium (1rem) for cards, large (2rem) reserved for the most prominent single surfaces. Borders are
1px `Ruled Line`; clipping follows the radius. No element is a pure rectangle.

## Components

### Buttons

Tactile and plain, like a well-used key on a desk.

- **Shape:** gently rounded (0.5rem / `rounded-lg`)
- **Primary:** Ledger Olive fill, white text, `px-4 py-2` at medium
- **Hover / Focus:** 90% opacity fill; 2px olive focus ring
- **Variants:** `secondary` (white fill, ruled border, mist hover), `danger` (deep red fill),
  `ghost` (text only, shifts to olive on hover)
- **Sizes:** `sm` for table rows, `md` default, `lg` for a page's single primary action

### Inputs / Fields

- **Style:** Field Grey fill, 1px ruled border, 0.5rem radius, full width
- **Focus:** ring-only — the border does not move or change colour
- **Height:** a minimum 44px touch target, enforced on checkboxes and row actions
- **Labels:** always visible and wrapped, so label *and* field are one tap target

### Cards / Containers

- **Corner Style:** 1rem (`rounded-xl`)
- **Background:** pure white card on warm paper page
- **Shadow Strategy:** none — see Elevation
- **Border:** 1px Ruled Line
- **Internal Padding:** 1.25rem, or 0.75rem in compact form

### Navigation

- **Sidebar:** warm off-white, rounded-full active pill in Pale Sprout with near-black bold text
- **Default state:** slate text on the sidebar surface
- **Mobile:** a bottom bar; the active item keeps the same pill treatment
- Icons are Material Symbols Outlined, 18px, always preceding the label

### Status Badges & Alerts

Status is colour-plus-text, never colour alone. Critical, Warning and Info counts render as tinted
badges with their icon and numeral, so a count is legible without relying on hue.

## Do's and Don'ts

### Do:
- **Do** express depth with warm tonal surfaces and reserve shadows for primary buttons
- **Do** keep 44px minimum touch targets on every actionable element
- **Do** render one `<h1>` per screen via `PageHeader`
- **Do** use `Button` for every action rather than hand-rolled button classes
- **Do** keep compliance state, alerts and countdowns visually equal to ordinary data
- **Do** cap long free-text cells (Provenance) and lead rows with the primary action

### Don't:
- **Don't** hardcode hex, `rgb()` or any literal colour — always `var(--color-*)` or a `Button` variant
- **Don't** use pure `#ffffff` as a page background or pure `#000000` as text
- **Don't** invent a colour outside the semantic list to express a new state
- **Don't** hand-roll button styling; the shared `Button` owns padding, radius and focus
- **Don't** add a second page heading, or shrink table text to save width
- **Don't** restyle a single module more heavily than any other — design effort is uniform by commitment
