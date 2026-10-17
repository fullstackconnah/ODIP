---
name: Odip Landing (The Admin Day)
description: The public /welcome/ page. One admin day by the clock on a pure white ground; the old way sits plain beside the same job on an olive field, shown with real captured screens.
colors:
  white: "#ffffff"
  ink: "#1b1c1a"
  muted: "#43493a"
  olive: "#396200"
  lime: "#bbf37c"
  deep: "#0f2000"
  slate: "#515f74"
  surface: "#f5f3ef"
  hair: "#e4e2de"
  rule: "#c3c9b5"
  edge: "#8a9180"
  error: "#ba1a1a"
  error-bg: "#ffdad6"
  on-error: "#93000a"
  warn-bg: "#fef3c7"
  on-warn: "#92400e"
  on-olive-2: "#e3eedb"
  on-deep-2: "#c8e8a4"
  on-lime-2: "#2b3f12"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.5rem, 1.2rem + 4.4vw, 5rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  join-headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.25rem, 1.4rem + 3vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
  section-headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.875rem, 1.2rem + 2.2vw, 3.25rem)"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  slot-headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 1.6vw, 2.625rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  slot-time:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1rem, 0.9rem + 0.3vw, 1.125rem)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.005em"
    fontFeature: "tnum"
  slot-label:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  term:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  wordmark:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.04em"
  lede:
    fontFamily: "Manrope, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.0625rem, 0.96rem + 0.35vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Manrope, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "Manrope, system-ui, -apple-system, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.01em"
  label:
    fontFamily: "Manrope, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
rounded:
  badge: "4px"
  md: "8px"
  lg: "12px"
  panel: "16px"
  phone: "28px"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 4vw, 48px)"
  wrap: "1200px"
  bar-h: "64px"
  slot-pad: "clamp(44px, 5vw, 80px)"
  section-pad: "clamp(72px, 8vw, 128px)"
components:
  button-olive:
    backgroundColor: "{colors.olive}"
    textColor: "{colors.white}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "44px"
  button-olive-hover:
    backgroundColor: "{colors.deep}"
  button-quiet:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "44px"
  button-large:
    height: "52px"
    padding: "0 24px"
  signin-link:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  signin-link-hover:
    backgroundColor: "{colors.surface}"
  alpha-tag:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.deep}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 9px 4px"
  sample-tag:
    textColor: "{colors.lime}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 8px 3px"
  field-olive:
    backgroundColor: "{colors.olive}"
    textColor: "{colors.white}"
    padding: "80px 0 80px 48px"
  field-deep:
    backgroundColor: "{colors.deep}"
    textColor: "{colors.white}"
  field-lime:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.deep}"
  screen-frame:
    rounded: "{rounded.lg}"
  screen-frame-phone:
    rounded: "{rounded.phone}"
  join-panel:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "40px"
  input-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    height: "48px"
  status-error:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.on-error}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  status-wait:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.on-warn}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
---

# Design System: Odip Landing (The Admin Day)

Scope: `welcome/` only, the public page at `/welcome/`. It takes the app's tokens by value (pinned by `tokens.test.ts`) and imports nothing from the app's components. Recorded from the shipped build at b6bf5db3 (welcome.css, index.html, motion.ts, assets/screens/manifest.json), after the finish reviews FINISH.md and FINISH-R2.md.

## Overview

**Creative North Star: "The Admin Day"**

The page follows one admin day by the clock. Seven slots (8:30 am to "On shift") each put the old way, plain on white, beside the same job in Bunya Support on a coloured field, so "less admin" is shown by a real captured screen rather than claimed. The ground is pure white everywhere; the only colour fields are the "after" halves, the join band and the lime and deep variants. There are no cards, no icon tiles, no illustration, no photography and no gradient.

The one authored moment is the "now" dot, the brand's lime dot ringed olive. It drops onto 8:30 in the hero's day plan, then travels a sticky rail beside the slots as each crosses the centre of the viewport. Type is Plus Jakarta Sans 800 for headings with tabular times, Manrope for body. Colour is the app's own green family with white, ink and hairlines.

**Key Characteristics:**
- Pure white ground (#ffffff); sections are told apart by a 1px hair rule and padding, never by tone.
- Before sits left on white, after sits right on a full-bleed field; this holds in all seven slots.
- One glass element: the sticky bar (white at 86%, saturate 160%, blur 14px), solid when transparency is reduced, contrast is more, or backdrop-filter is unsupported.
- Real product captures in plain bordered frames, each tagged "Sample data".
- Motion is transform and opacity only, on strong ease-out curves, with no overshoot.

## Colors

A white ground, ink text, and one green family in three depths (olive, deep, lime). Values are the app's tokens by value (`--color-*` in `:root`, short aliases such as `--olive` used in rules).

### Primary
- **Ledger Olive** (#396200): the primary action, the "after" field, links, focus ring, the strike line, the rail dot's ring and `em` in the h1.
- **Pale Sprout** (#bbf37c): the "now" dot fill, the "With Bunya Support" label on olive and deep, bullets on olive, the Alpha pill, the On-shift field, `::selection`.
- **Deep Bunya** (#0f2000): the incident slot field, the join band, button hover, text on lime.

### Secondary
- **Slate** (#515f74): defined as `--slate` (the app's secondary) and pinned by the token test, but used by no rule in welcome.css.

### Neutral
- **White** (#ffffff): the page ground, the join panel, input fill, the bar's solid fallback.
- **Ink** (#1b1c1a): body and heading text on white, the quiet button, the first terms rule.
- **Moss Grey** (#43493a): secondary text, the "Before" text, hints, footer copy.
- **Hair** (#e4e2de): 1px dividers, bar bottom border, rail line, frame border.
- **Rule** (#c3c9b5): terms and footer rules, unvisited stop rings.
- **Edge** (#8a9180): landing-only; input border and quiet-button ring.
- **Warm Paper** (#f5f3ef, `--surface`): see the open question below.
- **Second-tone text** on each field: #e3eedb on olive, #c8e8a4 on deep, #2b3f12 on lime (notes and figure captions).
- Translucent whites and limes in use: white at 0.86 (bar), 0.92 / 0.9 / 0.88 (text on olive and deep), lime at 0.35 / 0.3 (hairlines on olive and deep), ink at 0.2 (frame shadow on a field), olive at 0.25 (input focus ring), deep at 0.3 (frame border on lime).

### States
- **Error** (#ba1a1a text, #ffdad6 fill, #93000a on fill) and **Wait / no-JS** (#fef3c7 fill, #92400e text), used only by the form.

### Named Rules
**The White Ground Rule.** The page ground is #ffffff. The owner said so verbatim ("we dont use the off white background and just use white"). Section breaks are a 1px hair rule plus padding (`.section--surface`, `.section--surface + .section`, `.site-footer`).

**The Three Fields Rule.** Olive owns the "after" half of a slot by default. Deep belongs to the incident slot, lime to "On shift", and deep to the join band. A new field colour needs a slot that earns it.

**The Captured-Warmth Rule.** The warm off-white inside screen captures is the app's own UI and stays. It never becomes a page colour.

**Open owner question (flagged, not decided).** `--surface` (#f5f3ef) still exists as a token and tints exactly two hover states: `.signin:hover` and `.plan a:hover`. The owner has not said whether a hover tint counts as "off-white". Nothing at rest paints it. Until decided, do not add a third use.

## Typography

**Display Font:** Plus Jakarta Sans (500, 700, 800), fallback system-ui.
**Body Font:** Manrope (400 to 700), fallback system-ui.

**Character:** Heavy, tightly tracked headings over a calm body, so the times and slot names read like diary headings. Both faces load from Google Fonts with a woff2 preload for each.

### Hierarchy
- **Display** (800, clamp(2.5rem, 1.2rem + 4.4vw, 5rem), 0.98, -0.035em): the hero h1, two lines, max 19ch, `em` in olive.
- **Join headline** (800, clamp(2.25rem, 1.4rem + 3vw, 4.25rem), 1, -0.035em): "Join the alpha."
- **Section headline** (800, clamp(1.875rem, 1.2rem + 2.2vw, 3.25rem), 1.04, -0.03em): "Before day one.", "What alpha means."
- **Slot headline** (800, clamp(1.75rem, 1.2rem + 1.6vw, 2.625rem), 1.05, -0.03em): the slot name, set in the sticky left column.
- **Slot time** (800, clamp(1rem, 0.9rem + 0.3vw, 1.125rem), 1.2, tabular, olive): the `.t` span inside each slot h2, on its own line above the name. It is the heading's own text, so it stays.
- **Slot label** (700, 1.25rem, 1.25, -0.01em, sentence case): the h3s "Before" (Moss Grey, struck) and "With Bunya Support" (lime on olive and deep, olive on lime).
- **Term** (700, 1.125rem, 1.35): terms list titles.
- **Lede** (Manrope 400, clamp(1.0625rem, 0.96rem + 0.35vw, 1.25rem), 1.55, 46ch).
- **Body** (400, 1rem, 1.6). Small text is 0.9375rem or 0.875rem with +0.01em.
- **Label** (700, 0.75rem, +0.04em): the "Sample data" tag. The Alpha pill is the same size, uppercase, +0.08em.
- **Wordmark** (500 "bunya" ink, 800 "support" olive, -0.04em, 1.375rem, 1.1875rem under 480px).

### Named Rules
**The Slot Heading Rule.** Slot labels are real headings: sentence case, 20px, Jakarta 700, no uppercase and no tracking, larger than the paragraph they head. The review round 1 refused 13px tracked uppercase labels (14 of them) as an eyebrow pattern; this is the repair.

**The Punctuation Kern Rule.** A trailing comma or period in a display heading is wrapped alone in `<span class="pk">` with `margin-left: -0.09em`. Jakarta 800's punctuation sidebearings read as a space under -0.035em tracking. `textContent` is unchanged. Used on the h1 comma and period and on the three section h2 periods.

**The Tabular Times Rule.** Times use `font-variant-numeric: tabular-nums` (plan, rail, slot time).

## Layout

A 1200px `.wrap` (`min(100% - 2 * gutter, 1200px)`, gutter `clamp(16px, 4vw, 48px)`) on a seven-column grid. The hero is copy over columns 1 to 4 and the day plan over 5 to 7. The day is a grid whose column 1 holds the sticky rail and columns 2 to 7 hold the slots; each slot splits into six columns: before 1 to 2 (sticky at `bar-h + 8px`), after 3 to 6. The after field bleeds to the right edge with `box-shadow: 0 0 0 100vmax` plus `clip-path: inset(0 -100vmax 0 0)`; this is a bleed technique, not a drop shadow. Vertical rhythm: slot padding `clamp(44px, 5vw, 80px)`, section padding `clamp(72px, 8vw, 128px)`. Screens in a field sit in a `.shots` grid; a second screen is 74% wide and right-aligned (86% at 768 to 1023, 100% below 768). The two phones sit in a two-column pair, the second dropped by `clamp(40px, 6vw, 88px)`.

Breakpoints: **1024+** rail visible and the full slot grid. **768 to 1023** rail hidden, slots on a seven-column grid (before 1 to 3, after 4 to 7), lists and form to one column. **Below 768** everything is one column and each after field bleeds both sides. **Below 640** CTAs stack full width and the phone pair tightens. **Below 480** the Alpha pill hides, the wordmark shrinks and "Join the alpha" becomes "Join". Screens swap to `-m` crops below 640px through `<source media>`.

Targets are 44px minimum (48px inputs, 52px large buttons); anchors use `scroll-padding-top: bar-h + 16px`.

## Elevation & Depth

Flat. Depth comes from the colour fields and hair rules, not shadows. The exceptions are small: a `0 2px 6px rgb(27 28 26 / 0.2)` shadow lifting a screen frame off an olive or deep field (removed on lime, which uses a deep-tinted border instead), a `0 0 0 3px` olive focus ring on inputs, and the rail dot's `0 0 0 4px white` knockout ring. The bar is the only translucent surface.

### Named Rules
**The One Glass Rule.** Only the sticky bar is glass (white 0.86, `saturate(160%) blur(14px)`). It falls back to solid white under `prefers-reduced-transparency`, `prefers-contrast: more`, or no backdrop-filter support. No glass on content.

**The No Offset Shadow Rule.** There are no hard offset shadows anywhere on this page.

## Shapes

Soft, small corners: 8px on buttons, inputs, plan rows and status blocks; 12px on screen frames; 28px on phone frames; 16px on the white join panel; pills (999px) for the Alpha tag and Sample-data tags; 2px squares for list bullets; 6px for the numbered steps. Frames are plain: a 1px hair border, no device chrome. The rail and the plan share one geometry: a 2px hair line and 10 to 16px dots, with the first plan stop and the rail dot in lime ringed olive.

## Components

### Buttons
- **Olive** (`.btn--olive`): olive fill, white text, 44px, 8px radius, 700 0.9375rem. Hover to deep. Press `scale(0.97)` over 120ms. The arrow icon slides 3px only under `(hover: hover) and (pointer: fine)`.
- **Quiet** (`.btn--quiet`): transparent, ink text, a 1px edge ring that thickens to a 2px olive ring on hover.
- **Large**: 52px, 24px side padding.
- A button in flight carries `aria-disabled` with a progress cursor; a disabled button is at 0.55 opacity.

### Bar
Sticky, 64px minimum. Wordmark with Alpha pill on the left; "Sign in" (a text link with a surface hover tint) and the olive "Join the alpha" on the right.

### Day plan
The hero's index: an ordered list of the seven slots as links, a 2px hair line threading 12px dots (the first 16px lime ringed olive, dropped in once), tabular times, a surface hover tint.

### Day rail
A sticky column at 1024px and up: seven stops on a 2px hair line, the current stop in ink bold, and the lime "now" dot travelling to it.

### Slot (before / after)
Before: time, name, struck "Before" label and one paragraph, on white. After: "With Bunya Support" label, a lede, a bullet list (olive or lime squares), an optional note under a rule, and the screens. The strike is a 2px olive line drawn left to right across "Before" when the slot arrives.

### Screen frame
A `<picture>` in a bordered rounded frame, sized by the manifest's width and height. Always paired with a caption that carries the lime "Sample data" tag. Provenance of each raster is in `assets/screens/manifest.json`: route, role, a `fixture` flag and notes. The manifest holds 18 entries (11 wide screens plus 7 mobile crops). Three screens are fixture-fed (4 entries with the roster-board crop): roster-board (a By staff week built from mock staff, leave and participants, because the mock ignores groupBy), claim-preview (a fixed two-line response, because the mock ignores From and To) and myshifts-week (the mock's portal shifts plus one more day shift). The rest are the mock's own state. Every screen is tagged Sample data.

### Terms list and lists
A definition list under hair-then-ink rules (Jakarta 700 term, Moss Grey definition) for "Before day one"; a two-column square-bullet list for "What alpha means".

### Join panel and form
A white 16px-radius panel on the deep band. Two-column field grid (one under 1024). Inputs are 48px with an edge border, a hover darkening to Moss Grey, and an olive border plus 3px olive ring on focus. Invalid fields take a red border and a bold red message. A honeypot field is parked off-screen. Status blocks use the error and wait colours; after a 202 the form is replaced by a "Received" panel that fades in over 200ms and takes focus.

### Footer
Hair rule on top, white ground. Acknowledgement of Country, a brand column and Product, Company, Legal and Support columns (44px link targets), then the Sample-data note.

### Focus
`outline: 3px solid olive; offset 3px; radius 4px` everywhere; lime on dark fields (`.on-dark`), olive inside the white panel.

### Motion
Tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`; durations press 120ms, hover 150ms, strike 300ms, frame 420ms (delay 80ms, stagger 60ms), dot 420ms, label 200ms, drop 400ms (delay 200ms), fade 200ms. Observers only (`motion.ts`), no scroll handlers, no parallax, no `will-change`, no `transition: all`, no overshoot.
- **Hero dot** drops 14px onto 8:30 on first load, once. It is not gated on `.js`: the script is deferred and a gate would paint it at rest, hide it, then drop it.
- **Per-screen arrival.** Each slot arrives once (its "Before" is struck) and each screen arrives once, on its own, when it crosses 88% of the viewport (`rootMargin: 0 0 -12% 0`): opacity 0 to 1 and `translateY(24px) scale(0.98)` to none, 420ms, +60ms for a second screen. A slot's screens sit well below its heading, so arriving with the slot would settle them out of sight. Anything already in view at load, or the deep-link target, arrives before the hidden starts exist, so it never flashes.
- **Rail dot** moves to the slot in the centre band (`rootMargin: -45% 0 -50% 0`) by a `translateY` set on the dot itself, a 420ms transition, so a fast scroll retargets from where it is. The stop label recolours over 200ms.
- **Received panel** fades in over 200ms.
- **Hidden starts exist only under `html.js`**, which `motion.ts` adds last, and only after IntersectionObserver is confirmed. Text never hides; only screens and the strike do. Print and no-JS show everything.
- **Reduced motion** is gentler, not zero: screens fade over 200ms without the move or scale; the strike fades instead of drawing; the hero dot fades in; button press and arrow movement stop. The rail dot does not fade: it moves to its stop without animating (`transition: none`), a jump.

## Do's and Don'ts

### Do:
- **Do** keep the ground #ffffff and separate sections with a 1px Hair rule and padding.
- **Do** put the old way on white at the left and the Bunya Support version on a field at the right, with the strike drawing left to right toward it.
- **Do** keep slot labels as real sentence-case headings at 20px or larger.
- **Do** show real captures only, at the manifest's sizes, with a Sample data tag, and record route, role and fixture state in the manifest for each new raster.
- **Do** keep every triggered motion a transition on transform or opacity so it retargets from its live value, and keep hidden starts behind `html.js`.
- **Do** wrap trailing punctuation of a display heading in `.pk`.
- **Do** keep focus visible at 3px with a 3px offset, and tap targets at 44px or more.

### Don't:
- **Don't** paint any ground, band or section in #f5f3ef. Do not add uses of `--surface`.
- **Don't** set small tracked uppercase labels above or over headings (the refused eyebrow pattern). The Alpha pill is a status badge, not a precedent for section labels.
- **Don't** add cards, icon tiles, illustration, gradients, stock or AI-generated photography, carousels, video or chat.
- **Don't** use glass on content, hard offset shadows, springs, overshoot, `ease-in`, `scale(0)`, `will-change` or scroll-linked motion.
- **Don't** hide text until JS runs, or gate the hero dot on `.js`.
- **Don't** ship a capture with an unexplained red warning, a dead band under its content, or a clipped row at its edge.
- **Don't** import tokens or components from the app, or change a green here without the app's `src/index.css` changing first (the token test pins them).

## Recorded, not canonized

- The class name `.section--surface` is a leftover: it paints nothing and only carries the hair rule. Rename when next touched.
- `--slate` is defined and unused.
- The `AccessibilityPage.tsx` line that says reduced motion turns everything into "short fades" is not true of the rail dot; FINISH-R2 carries a one-line copy fix to the owner.
- Phone-width proof frames (incident and agreement `-m`) show about 7 to 8px app text at 1x; accepted as a ceiling, not a rule.
