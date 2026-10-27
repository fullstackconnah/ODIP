# Enquiries "Open" list width: design note

Written before the first edit (2026-10-27). Mode: Operate.

## Problem
At 1280 the Open list needs about 1155 px and has 1006, so the page scrolls sideways. The pinned Actions cell holds primary action, Edit and a More menu on one non-wrapping row (md:flex-nowrap), which is the widest cell.

## What changes (InquiriesPage.tsx, one file plus its test)
- Actions column opts into `wrap: true` (house DataTable flag) so its td drops md:whitespace-nowrap.
- The cluster keeps `whitespace-nowrap` (button labels never break) and between md and 1400 px gets `w-40` (10rem) so the buttons stack to two lines instead of widening the table; from 1400 up it stays one row (`min-[1400px]:flex-nowrap`).
- The More menu (house Dropdown, variant icon) aligns right at md and up (the cell is at the pinned right edge, a left-aligned panel runs off screen); phone keeps left (existing behaviour, via useIsBelowMd).
- Comment above the columns array explains the constrained-width rule.

## States
- 1280 desktop: no horizontal scroll (page and list container); actions on two lines; menu panel inside viewport.
- 1440+ : unchanged single-line cluster.
- 390 phone card: unchanged composition (md: classes do not apply, ROW_ACTIONS_CARD keeps 44 px targets, flex-wrap as before); menu opens left-aligned, inside viewport.
- Row action menu open: panel stays within viewport at both widths.
- Long names: Participant column already `wrap: true`; unaffected.
- No new copy, colour, motion or components.

## apple-design rules applied
Touch targets kept at 44 px on phone (not shrunk); spatial consistency (menu opens toward the free side, anchored to its trigger); simplicity (reflow, not hide); no new motion.

## Addendum after the first measurement (before the second UI edit)
The cherry-picked fix left the table 1100 px wide in a 1006 px box. Added: below 1440 Contact (12.5rem to 9rem) and Provenance (8rem to 5rem) truncate harder (full text stays in `title`); the one-row Actions threshold moves 1400 to 1440 because the table needs about 1166 px at 1440. The icon Dropdown panel is clamped 8 px inside the viewport when left-aligned (phone card menu ran off the right edge: right edge 454 of 390).

## Addendum, fix round 2 (before the edit)
Finish review found a dead band: in Tailwind v4 `max-[1439px]` is width < 1439 and `min-[1440px]` is width >= 1440, so at exactly 1439 (and fractional widths from 1439 to 1440 under zoom) neither rule applied and Contact, Provenance and Actions fell back to the wide composition by luck. Change the three `md:max-[1439px]` classes to `md:max-[1440px]` so the pair is complementary (< 1440 and >= 1440), same idiom as `max-md:` beside `md:`. States unchanged: 1440+ one-row Actions and no tighter caps; 1280, 1366 and 1400; the Closed table; the 390 phone menu. No new copy, colour, motion or component.
DESIGN.md gets one sentence in the Column Rule: the Enquiries Open list wraps its Actions below 1440 instead of scrolling in its box, so rows reach about 118 px at 1280 (the one named exception to the Density Rule).
apple-design rules applied: simplicity and consistency (one complementary breakpoint, no band where the layout is accidental); craft (every width resolves to a designed rule).
