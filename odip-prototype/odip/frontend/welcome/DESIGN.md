---
name: Odip Landing (Living Canopy Light)
description: The public /welcome/ page. A living gum-canopy light field in the app's own greens, with the product appearing in it as clearings of the app's warm paper.
colors:
  primary: "#396200"
  primary-container: "#4d7c0f"
  primary-fixed: "#bbf37c"
  on-primary-fixed: "#0f2000"
  background: "#fbf9f5"
  foreground: "#1b1c1a"
  muted-foreground: "#43493a"
  border: "#c3c9b5"
  input: "#e4e2de"
  destructive: "#ba1a1a"
  error-container: "#ffdad6"
  on-error-container: "#93000a"
  warning-container: "#fef3c7"
  on-warning-container: "#92400e"
  canopy-text: "rgb(251 249 245 / 0.84)"
  canopy-text-quiet: "rgb(251 249 245 / 0.7)"
  canopy-hairline: "rgb(187 243 124 / 0.2)"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.125rem, 1.1rem + 4.4vw, 5.6rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.25rem, 1.2rem + 3vw, 4rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline-sm:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.75rem, 1.3rem + 1.4vw, 2.25rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.3rem, 0.9rem + 0.9vw, 1.75rem)"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  numeral:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.25rem, 1.6rem + 1.6vw, 3rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
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
  caption:
    fontFamily: "Manrope, system-ui, -apple-system, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: "Manrope, system-ui, -apple-system, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  label:
    fontFamily: "Manrope, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.16em"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 4vw, 48px)"
  act-gap: "clamp(112px, 14vw, 200px)"
  header: "64px"
  rail: "136px"
  pill-bar: "76px"
  wrap: "1200px"
components:
  button-sprout:
    backgroundColor: "{colors.primary-fixed}"
    textColor: "{colors.on-primary-fixed}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "44px"
  button-sprout-lg:
    backgroundColor: "{colors.primary-fixed}"
    textColor: "{colors.on-primary-fixed}"
    rounded: "{rounded.sm}"
    padding: "0 24px"
    height: "52px"
  button-ghost:
    backgroundColor: "rgb(15 32 0 / 0.45)"
    textColor: "{colors.background}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "44px"
  button-ghost-hover:
    textColor: "{colors.primary-fixed}"
  button-olive:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    height: "48px"
  light-toggle:
    backgroundColor: "rgb(15 32 0 / 0.78)"
    textColor: "{colors.canopy-text}"
    rounded: "{rounded.pill}"
    padding: "0 16px 0 13px"
    height: "44px"
  section-pill-current:
    backgroundColor: "{colors.primary-fixed}"
    textColor: "{colors.on-primary-fixed}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "44px"
  paper-clearing:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "clamp(20px, 3.4vw, 48px)"
  readout-tile:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.on-warning-container}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "52px"
  tag-sample-data:
    backgroundColor: "{colors.input}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  input-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "44px"
  crossing-carrier-arrived:
    backgroundColor: "{colors.primary-fixed}"
    textColor: "{colors.on-primary-fixed}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  crossing-carrier-travelling:
    backgroundColor: "{colors.on-primary-fixed}"
    textColor: "{colors.primary-fixed}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
---

<!-- Recorded from the shipped build (feat/landing-canopy, b25faca8, finish review verdict SHIP), not from the brief.
     Sources: welcome.css, canopy-shader.ts, canopy.ts, canopy-math.ts, crossing-machine.ts, index.html, and the r3
     screenshot set. The Tourist Drive world this file used to describe is gone; nothing of it carries over. -->

# Design System: Odip Landing (Living Canopy Light)

## Overview

**Creative North Star: "Clearings in the Canopy"**

The landing page is the same product as the app, seen from outside. Its ground is a living light field: you look up into a eucalypt canopy at late sun, drawn in the app's own greens by one WebGL fragment shader. The product appears in that field as clearings of the app's warm paper: a dashboard readout in the first viewport, a record at the end of each crossing, and proof bands and the early-access form below. The nature side is the lived trip; the paper side is the record. The page's job is to show one becoming the other.

There is one canopy and many clearings, and they never blur into each other. Canopy text is warm paper at three strengths on forest, with Sprout as the single lit accent. Paper clearings are the app exactly: Ledger Ink text, Ruled Line borders, Field Grey inputs, the app's warning and error tones, and real screenshots of the app. Density is low on the canopy (big type, generous act gaps) and app-normal inside the clearings.

The page shares the app's tokens by value, not by import: `welcome.css` repeats the app's `@theme` values under the same names, and `welcome/tokens.test.ts` fails if the app changes a green and this page does not follow. This replaces the earlier stance that the landing was a separate world.

**Key Characteristics:**
- One full-bleed, fixed canopy behind everything, with a still poster as first paint and fallback.
- Sickle-shaped gum leaves hanging in sprays from drooping twigs, in parallax layers, dense along the top edge and thinning downward; one sun, high on the right.
- Soft, irregular pools of Sprout light dappling the field; no discs, no particles, no tile seams.
- Paper clearings in the app's exact palette, holding the app's real screens.
- The translation gate: a moment on the canopy crosses a seam of Sprout light and arrives as a record on paper.
- Small tracked labels and instrument-style readouts in the margins, carrying Odip's own facts.

## Colors

The app's olive family and warm neutrals, used in two modes: forest ground with paper-coloured text on the canopy, and the app's own paper surface inside every clearing.

### Primary
- **Ledger Olive** (primary): on paper only. The form's submit button, the success icon, link buttons and the focus ring inside clearings, exactly as the app uses it. In the shader it is the mid-tone of lit-through far leaves.
- **Deep Fern** (primary-container): the wordmark tile behind the brand glyph, and the brighter leaf tone in the shader.
- **Pale Sprout** (primary-fixed): the one incandescent accent. The primary CTA fill on the canopy, the current section marker, the crossing seam and carrier, the readings' figures and tick marks, the "Live" state word, the canopy focus ring, and the dapples of sunlight in the field. It keeps the app's meaning, "you are here / all clear".

### Neutral
- **Forest** (on-primary-fixed): the canopy ground. The page background, the opaque header, the poster's base, the text on Sprout fills, and the dark ring around the crossing carrier. The browser theme colour.
- **Warm Paper** (background): every clearing's surface, and the canopy's text colour at full strength (headlines).
- **Canopy Text** (canopy-text, Warm Paper at 84%): ledes, captions on the canopy, footer copy, inactive pill items.
- **Canopy Text Quiet** (canopy-text-quiet, Warm Paper at 70%): margin index labels, reading labels, footer headings.
- **Canopy Hairline** (canopy-hairline, Sprout at 20%): the header's bottom rule, the index rail, the readings' rules, the provenance box, the pause control's border.
- **Ledger Ink** (foreground): text inside clearings; also the phone frame around phone screenshots.
- **Moss Ink** (muted-foreground): secondary text in clearings (readout caption and note, form labels and notice).
- **Ruled Line** (border): screenshot frames, input borders, and the rule between screens in a proof band.
- **Field Grey** (input): input fills and the "Sample data" tag.

### Status (on paper, the app's tones)
- **Amber wash and amber ink** (warning-container, on-warning-container): the hero readout's attention tiles, the no-JS notice and the form's "wait" status.
- **Error blush, error ink and alarm red** (error-container, on-error-container, destructive): the form's error status, invalid input borders and field errors.

### Named Rules
**The Same Greens Rule.** Every colour on this page is an app token by value, declared under the app's own name in `welcome.css` `:root` and pinned by `tokens.test.ts`. A new colour needs a new app token first. Canopy text and hairlines are alpha mixes of Warm Paper and Sprout, never new hues.

**The One Lamp Rule.** Pale Sprout is the only lit thing on the canopy: the primary CTA, the current place, the seam and the sunlight. Never use it for body text, large fills or decoration on paper.

**The Warm Base Rule.** Never pure white and never pure black, on either ground. `tokens.test.ts` fails on `#fff`, `#000`, `white`, `black` or their `rgb()` forms in the stylesheet.

## Typography

**Display Font:** Plus Jakarta Sans 700 to 800 (with system-ui)
**Body Font:** Manrope 400 to 700 (with system-ui)

**Character:** the app's two faces. Plus Jakarta at 800 with tight negative tracking gives the canopy its big, confident statements; Manrope carries everything that is read rather than seen, and the small tracked labels that act as the page's instrument lettering.

### Hierarchy
- **Display**: the hero headline only, "You run the trip. / Odip keeps the record." Two lines from 1024px up, three on phones.
- **Headline**: each act's heading on the canopy. The readings heading is a step smaller (clamp(2rem, 1.2rem + 2.4vw, 3.25rem)), and **Headline-sm** heads the early-access clearing.
- **Title**: the lived moment in each crossing, held to about 21ch.
- **Numeral**: the readings' figures, in Sprout with tabular figures. The readout tiles' counts use the same face at 1.75rem.
- **Lede**: the hero sub and the act ledes, at most 36 to 40rem wide, in Canopy Text.
- **Body**: 1rem / 1.6, for the form, notices and footer notes (62ch maximum).
- **Caption**: screenshot captions on paper.
- **Label**: uppercase, tracked 0.16em, 12px, never smaller. Crossing "when" lines in Sprout; reading labels and footer headings in Canopy Text Quiet. The pause control uses the same treatment at 0.14em.

### Named Rules
**The Twelve Pixel Floor Rule.** No text below 0.75rem (12px), including tags, labels and the pill.

**The Small Caps Instrument Rule.** Small tracked uppercase labels are for wayfinding and readouts only (section index, crossing "when", reading labels, the pause control, footer headings). Below 1200px the pill drops the uppercase and tracking so the four items fit.

## Layout

- **Container:** `min(100% - 2 * gutter, 1200px)`, centred, with a fluid gutter of 16 to 48px. From 1200px the page gains a 136px left rail for the section index.
- **Rhythm:** acts are separated by a large act gap (112 to 200px). More space above headings than below. Inside a proof band, screens are separated by 28 to 40px and a ruled line.
- **First viewport:** full-height hero. From 1024px a two-column grid: the headline spans both columns, the copy and actions sit left, the paper readout (300 to 400px) right. Below 1024px everything stacks, the readout capped at 440px; below 680px the hero buttons go full width.
- **Fixed furniture:** the header (64px, opaque forest) on top. From 1200px the section index sits in the left margin, centred vertically, and the "Canopy light · Live" pause control sits bottom right. Below 1200px the index becomes a bottom pill (76px reserved) and the pause control moves into the header, icon only below 900px. Below 640px the pill drops its numbers; below 380px the wordmark text hides; below 360px the header tightens so it stays one line at 320px.
- **The crossing:** from 1100px a three-column grid (moment 4fr, 64px gate, record 8fr), with a vertical seam, and narrow records set their caption beside them. Below 1100px it stacks, the seam turns horizontal, and moments pass downward.
- **Proof bands:** one paper surface per act, screens stacked or paired. From 1280px some screens set their caption to the side. Below 680px wide screens scroll sideways inside their frame at natural size (with a hint line), and phones get the app's own art-directed `-m` crops.
- **Readings:** five columns divided by hairlines; three below 1024px; one below 760px, where each reading becomes a row (figure left, label and description right).
- **Scroll:** native scroll only. Anchors and focus clear the header and the pill via `scroll-padding`. Smooth scrolling only without reduced motion.

## Elevation & Depth

Depth lives in the canopy, not in shadows. The shader builds it from parallax: four leaf layers (three in low power), far leaves small and lit through like fern-green glass, near leaves large, dark and soft with only their rims lit, under one sun high on the right that sets a real luminance gradient across the field. Scrolling drifts the camera through the layers. Paper clearings sit flat on the canopy, with no shadow; they read as forward because they are the brightest, flattest things on screen and because the field brightens round them ("light finds the work"). The few shadows below are glows and separations, not elevation.

### Shadow Vocabulary
- **Sprout glow** (`box-shadow: 0 10px 24px -14px rgb(187 243 124 / 0.7)`): under the Sprout CTA only.
- **Olive glow** (`box-shadow: 0 8px 20px -12px rgb(57 98 0 / 0.75)`): under the olive button on paper.
- **Pill lift** (`box-shadow: 0 12px 32px -12px rgb(15 32 0 / 0.9)`): the bottom section pill, to separate it from the content it floats over.
- **Carrier halo** (`box-shadow: 0 0 0 5px rgb(15 32 0 / 0.85)`): a forest ring that cuts the crossing carrier out of the seam and track.

### Named Rules
**The Quiet Zone Rule.** Text on the canopy never sits on moving light without a guaranteed ground. Every canopy text block carries `data-quiet`: live, the shader darkens the field behind it (six content zones plus two fixed ones, for the index and the pause control); on the poster, a soft forest scrim (80%, blurred 24px) does the same and fades out when the live field takes over. Worst sampled contrast at b25faca8 is 5.69:1 over 507 positions.

**The Flat Clearing Rule.** Paper clearings never take a drop shadow. Their depth comes from the light pool the field throws round them (`data-pool`, up to six in view).

## Shapes

The app's radii, unchanged: small (0.375rem) for buttons, inputs, the skip link and the wordmark's focus; medium (0.5rem) for screenshot frames, readout tiles and form statuses; large (0.75rem) for every paper clearing and the wordmark tile. Fully round pills for the pause control, Replay, the crossing carrier, the section pill and the "Sample data" tag. One exception: the phone frame around phone screenshots is 36px with a 27px screen radius, to read as a device. Lines are hairlines (1px) everywhere; the only 2px strokes are the crossing seam, the current section's left bar and the readings' Sprout ticks.

## Components

### Buttons
- **Shape:** gently rounded (0.375rem), at least 44px tall; the large hero variant is 52px.
- **Sprout (primary, on the canopy):** Sprout fill, forest text, Sprout glow. Hover mixes 16% Warm Paper into the fill. Used for "Request early access" in the hero and header (the header shortens it to "Early access" below 640px).
- **Ghost (on the canopy):** 45% forest fill, 45% paper border, paper text; hover turns border and text Sprout. Used for "See it at work".
- **Olive (on paper):** the app's primary button for the form's submit, full width, 48px. Disabled at 55% opacity; submitting at 80% with a progress cursor.
- **Link button (on paper):** olive, underlined 3px below, 44px tall.
- **Transitions:** background, border and colour over 0.15s ease-out.

### Chips
- **Sample data tag:** Field Grey pill, Moss Ink text, 12px semibold. One on every figure, with the hero readout counted as a figure.

### Cards / Containers
- **Paper clearing:** Warm Paper, large radius, no border, no shadow, padding 20 to 48px. Variants: the hero readout (20px), the crossing record (28px, 16px on phones), the proof band (screens ruled off from each other), and the early-access clearing (at most 560px).
- **Screenshot frame:** Ruled Line border, medium radius, the image at 1:1. A right-edge paper fade marks a screen that is cropped.
- **Readout tiles:** the app's attention tiles in the warning tone, laid as rows: the count at 1.75rem 800, then what is missing.

### Inputs / Fields
- **Style:** Field Grey fill, Ruled Line border, small radius, 44px tall, 1rem Manrope; the label is 13px Moss Ink above it.
- **Focus:** the app's olive ring (2px, 2px offset), because the form is on paper.
- **Error:** alarm-red border with a 12px semibold alarm-red message below. Status blocks use the error or warning container tones. The form's states (idle, invalid, submitting, success, duplicate, error, no-JS) behave as they did before the redesign.

### Navigation
- **Header:** opaque forest with a hairline below. The wordmark (Deep Fern tile, Sprout glyph, "Odip" in Plus Jakarta 800), then Sign in (paper, Sprout on hover) and the Sprout CTA. It never wraps, down to 320px.
- **Section index, wide:** 01 Before, 02 During, 03 After, 04 Early access in the left margin on a hairline rail. Numbers in Plus Jakarta 700, labels as tracked uppercase. The current item turns paper, its number Sprout, with a 2px Sprout bar on the rail.
- **Section index, below 1200px:** a forest pill at the bottom centre (95% forest, hairline border, pill lift). The current item is a Sprout pill with forest text.
- **Focus:** a Sprout ring (2px, 3px offset) anywhere on the canopy; the olive ring inside clearings.

### The canopy field (signature)
One fixed, aria-hidden canvas behind the page, drawn by a raw WebGL 1 fragment shader (no libraries, no external assets). It renders at 0.5 scale (0.35 in low power, a coarse pointer or below 768px), with the device pixel ratio capped at 2, and is scaled up by CSS. The wind is a slow sway plus gust fronts travelling in from the left; the pointer is a breeze, so nearby leaves flutter and settle with inertia. The canvas fades in over the poster in 0.9s (cubic-bezier(0.16, 1, 0.3, 1)). It rests when paused (the choice is remembered), when the tab is hidden, and when no canopy is on screen. Under reduced motion it is one still frame and ignores the pointer. Without WebGL, or with a lost context, the poster (`assets/canopy-poster.webp`, the shader's own frame at t = 21.5s) is the field.

### The pause control: "Canopy light · Live"
A forest pill at 78%, hairline border, tracked uppercase 12px label, a Sprout pause glyph and a Sprout "Live" state word ("Paused" in Canopy Text when pressed). Its accessible name stays "Pause the Canopy light" at every width; `aria-pressed` carries the state.

### The translation gate (signature)
Three crossings, one per act. On the canopy side, a tracked Sprout "when" label, the lived moment as a Title, and a Replay pill. A 2px Sprout seam with a blurred glow divides the scene; a hairline track carries a pill (forest with a Sprout label while travelling, Sprout with forest text on arrival) across to the record. The record is a paper clearing that opens outward from the seam. One crossing lasts 2.6s: the carrier travels over the first half (ease-in-out cubic), the seam flares between 30% and 75%, the record reveals from 42% (ease-out expo), and the caption settles last from 62% (ease-out cubic). Each plays once when its seam reaches mid-screen, can be replayed, and can be dragged with a mouse or pen from 1100px. Under reduced motion it shows the arrived state at once. All text is in the DOM throughout, and a polite live region announces each arrival.

### Readings
Provenance and numbers as instrument readouts: a hairline-boxed provenance line with its key phrase in Sprout, then five readings, each with a tracked label, a Sprout numeral and a short description, under a hairline with a 24px Sprout tick.

## Do's and Don'ts

### Do:
- **Do** take every colour, radius and face from the app's `@theme` by value, under the app's token name, and keep `tokens.test.ts` green.
- **Do** give every block of text on the canopy a quiet zone (`data-quiet`) and re-run the pixel-sampled contrast check after any shader change: 4.5:1 for body text, 3:1 for large text, at the worst frame.
- **Do** put the product on paper: real app screens with accurate alt text, one "Sample data" tag per figure.
- **Do** keep Pale Sprout for the single brightest thing in each view: the CTA, the current place, the seam, the light.
- **Do** keep every target at least 44px and the header on one line from 320px up.
- **Do** recapture the poster with `capture/poster.mjs` after any change to `canopy-shader.ts` or `STILL_TIME`, and keep it well under 60 KB.

### Don't:
- **Don't** use pure white or pure black anywhere, on either ground.
- **Don't** add a colour, font or radius that the app does not have.
- **Don't** set text over moving light without a quiet zone, or animate anything except the field, the crossings, the canvas fade-in and the 0.15s colour changes on controls.
- **Don't** draw the light as discs, bokeh, particles or fireflies, or the leaves as straight blades; the light is soft pools under a gum canopy, and the leaves are sickle-shaped and hang from petioles.
- **Don't** clip a leaf or a pool of light at a shader cell edge; no straight edge may appear in the field.
- **Don't** make the header translucent: copy scrolling under a 95% header ghosts through it.
- **Don't** scroll-jack, fake a loader, or put a screenshot on a gradient.
- **Don't** shadow a paper clearing.
