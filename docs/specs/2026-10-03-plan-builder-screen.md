# Plan builder phase C: the builder screen

**Status:** implemented on `feat/plan-builder-ui` (phase C of 4). **Date:** 2026-10-03.
**Not in this phase:** "Mark approved" and what approval locks (D), roster patterns, the catalogue list redesign, a holiday-override editor, any change to the engine's pricing.

## What it is

The "Support plan" section of the service agreement draft page (`/participants/:id/agreement-draft`). A plan is a list of support blocks (phase B's `PlanBlock`); the
server prices them, so nobody types an item code, a quantity or a price. Every save is a new immutable revision that stores the blocks, what each block asks of a
worker, the engine's answer and the lines it produced. The page keeps one working copy (the agreement's details and the blocks), seeded from the newest revision, and
saves it whole.

## What a revision stores (backend)

- `ServiceAgreementDraftBlock` is a child of `ServiceAgreementDraft`: its position, the block's id, the block as phase B takes it (`jsonb`) and the worker requirements
  (`jsonb`, separate because the engine never sees them: gender, driver, skills; they are never names). JSON because the block has nested lists (headcount changes,
  transport) the engine reads whole, and nothing queries into them. One additive migration (`AddServiceAgreementDraftBlocks`).
- `PricingJson` is the engine's answer without its lines (totals, issues, notices, holiday occurrences, open questions), so an old revision shows what a person had to look
  at when it was saved. The generated lines go in the existing `ServiceAgreementDraftLine` rows, grouped per block, item, band, price and flags, with the block, band, unit,
  total, shifts and catalogue provenance beside them. A line's `total` is the engine's; the client never computes it.
- `POST participants/:id/service-agreement-drafts` takes blocks or hand-typed lines, never both (`Lines` is no longer required to have one). With blocks it checks the period
  and the block count, that each block's delivery state is the agreement's, and the requirements, re-prices through `PlanPricingService`, and refuses with the engine's own
  words when a block cannot be priced at all (`InvalidInput`, `RegistrationGroupNotHeld`, `StaLegacyNotSupported`). Anything softer (a Review line, a catalogue gap) is saved
  with the revision. The body is capped at 1 MiB and rate limited like the other API routes.
- **Two coordinators.** The body may carry `baseVersion`, the version the working copy started from (0 for a participant with none). If a newer one has been saved since, the answer is a 409
  with `code: "draft-version-conflict"` and the newer version in `data.currentVersion`, and nothing is saved, so a save never makes one coordinator's plan the newest over another's. Two saves
  racing past that check meet the unique index on (tenant, participant, version) and get the same 409, not a 500. A body without `baseVersion` is saved as before.
- **The cap covers a save.** Pricing a plan on save is the same work as a quote, so a save with blocks takes a permit from the same per-organisation limiter (two at once, in its own partition so
  a save is never refused because the screen's own quotes are in flight): 429 with `Retry-After: 1` when none is free.
- **The list is not every revision in full.** `GET participants/:id/service-agreement-drafts` returns the newest revision in full and every older one as a summary (`isSummary`, `blockCount`,
  `lineCount`, `total`, `caveats`: no blocks, lines or answer), and `GET participants/:id/service-agreement-drafts/:draftId` returns one in full, which the page asks for when somebody
  opens an older version. A total that leaves work out says so beside the figure (`caveats`, and on the PDF).
- A revision made before this has lines and no blocks. It is read-only, shown as it was, with a note that it can only be rebuilt from blocks.

## The overview

The default view. A week strip across the whole row (Mon to Sun, the 06:00 and 20:00 weekday price changes marked on the five weekday columns only, hours under each day; a bar carries its
block's number when it is tall enough and a title naming the block) above one table row per block: "1. Mon, Wed · 09:00–13:00 · Community access 1:1 ·
+20 km transport", what it asks of a worker, its hours and cost in an ordinary week and over the agreement, and the chips that open the stepper at the step you choose
(Times, Support, Travel, Review), Duplicate and Remove: the six are one toolbar and one Tab stop (arrow keys inside), and the chip that fixes what a refused block needs is where Tab lands.
A refused block has an en dash, not zeros, for its figures and says on its row what to do about it, with the step that does it (Open Support). Duplicate makes a block being added just
after the one it copies; it joins the plan on Add to plan, so cancelling leaves nothing behind. That the registration groups are not confirmed is one quiet line under the heading (a link to
Settings for an Admin, "Ask an Admin to confirm them" for anyone else), never the loudest block on the screen. With no blocks the six templates are the start. A running budget is docked at the foot of both views: hours and cost
a week, the cost for the period by budget category, and the plan budget when the participant has one (the budgets of their active NDIS funding sources whose plan dates meet the
agreement, added up: the sources keep their category as free text, so only the total is compared, never a category). Over the plan budget is a warning that says by how much and
that the draft can still be saved. The figures are the largest thing in the bar, over the plan budget is a warning-tinted cell, and a total that leaves work out says so beside the figure, in
shifts ("186 shifts with a part not priced · 1 block cannot be priced · 15 public holiday shifts to decide · some lines use provisional rates"; a block short of two items is not counted
twice). Below 1280px the bar is one line with Details (it was a third of a tablet's screen), "Not fully priced" and "Over budget" chips beside it, and, while the plan has changes nobody
has saved, "Not saved" with a Save: Add to plan does not save, and the save row is a long scroll below the blocks. A quote error and its Try again are outside Details, where a phone sees them.

"An ordinary week" is the first whole week counted from the agreement's start in which no block meets a public holiday, else the first seven days; there is none when the agreement
is shorter than a week. The budget is two quotes, one after the other because the week needs the period's holiday dates: the period without lines, then that week. A quote is
asked for when a coordinator pauses (350 ms), for the plan as it would be saved: the block being changed stands in for its saved self, and a block that is not complete yet is
left out and said to be. A figure on its way is three dots, never a zero; one that will not come is a dash.

## The stepper

Template, Days and times, Requirements, Travel and transport, Review: a rail on the left from 1024px wide, "Step 2 of 5 · Days and times" below that, with Back and Next beside it (the step's
heading is for focus and the announcement there, not said twice; the foot row's primary takes the width). When new times take a sleepover off the block, a note says so. Once a block exists every step is
reachable from the rail; Back and Next move one at a time and Enter in a field is Next. A step shows its problems next to its fields only after somebody tries to leave it, and
the block cannot be added until it has none. The block is a copy: Cancel leaves the plan as it was, and abandoning a changed block asks first. Add to plan (a new block) or Save
block (an edited one) is the only thing that changes the plan.

- **Times** shows "ends the next day" as derived, a one-day band preview (night, daytime, evening) with the hours that fall in each, and offers a sleepover only when
  the block qualifies (a block of more than 12 hours asks for the sleeping window, filled in from 22:00).
- **Requirements** offers only the support families the provider holds (settings), shows the registration group the choice falls in, and says in a sentence what the worker to
  participant ratio does to the price (1:3 is a third of the hourly price each).
- **Travel** is provider travel (minutes and kilometres each way, capped by the zone), activity-based transport and, for short-term accommodation, nights. Each says when the settings
  turn it off or a rate is provisional.
- **Review** is, in this order, the block on the week beside the others; what needs a person (when anything does); the lines it produces over the whole agreement (code, band, hours a week,
  unit price, a week, the agreement, flags) with the block's total in bold directly under them (a line with no price has en dashes, never $0.00; the hours are the priced ones, and the others
  are said apart, so Review and the budget bar agree); one "Why" panel at a time, which opens with focus on it (the engine's sentence, each rule in plain words, the catalogue version and the
  price row's date, the NDIS maximum before the group arithmetic); the public holidays it meets, with the choice for the block above the dates (decide later, charge, skip; skipping drops the
  whole shift) and the dates in a details that is open for one or two; the notices; and the questions it waits on. Only this view asks for lines, so the 60,000-line limit is met here and
  nowhere else. The lines dim and say "updating" while the answer on screen is the previous block's. When the budget has not answered yet the ordinary week is worked out here from the block's own holidays.
  **Deviation from the brief:** the engine has one `OnPublicHoliday` for a block, so the choice is one for every holiday shift of the block, not one for each occurrence group, and there is no
  Move (the way to move a shift is to change the block's days); the screen says both under the choice.

## What the screen says about issues

Issues, flags and notices are the engine's, in plain English, beside what they affect, and block nothing in this phase. The engine keeps one issue for each block, reason and message, with
`count` the shifts it met it on, and a message names the item and never a date, so a catalogue that ends mid-agreement is one issue and a block short of two items is two issues counting the
same shifts. `groupIssues` makes the two one (the largest count and the first date: never the sum, which counted such a block's shifts twice), and a rule broken in two fields, or a block
overlapping two others, stay separate. (An earlier version of this section, the screen's tests and the mock API all described one issue for every date: a shape the engine never produces.
The tests now read quotes the engine wrote, see below.) Dates in an engine sentence are written the way the screen writes them. Blocks are named by their place in the plan ("Block 2", "Blocks 1 and 2"), never by the id the screen gave them,
including in a server's save errors. A **refusal** (three reasons, above) is an error: the overview marks the block, says "N blocks cannot be priced", and holds Save draft back, so
the server does not have to. Everything else is a warning (a line with no price is "Not priced" in the same warning tone as the notice that explains it): Review, Provisional and Holiday rate
badges say it in words, and the notices say that the registration groups were never confirmed (a quiet line, with a way to Settings for an Admin) and where the holiday calendar cannot be trusted. Questions 1, 5, 6, 8, 13 and 14 of NDIS-CODES 11.3 are shown as the questions a line
rests on, not as errors.

## Settings, Plan pricing

A tab for Admin and SuperAdmin (`/settings?tab=pricing`): the six registration groups with Confirm (until somebody does, every plan carries the notice), the crossing policy with one
sentence each (A: parts at their own items, B: the higher of, never across a sleepover), claim provider travel on or off, the two per-kilometre rates (capped at $5, with a provisional
flag while they are the 2025-26 values), group outings under 0136 or 0125, short-term accommodation shown as it is (the new hourly items; the legacy per-day items end on 30 June 2027),
and the approver roles. Saves send only what changed, so a stale form cannot undo someone else's setting.

## States

Empty (the templates), loading and "pricing the plan…", an error with Try again, a catalogue missing for part of the period (explained, with who can import it), refusals by their
typed reason, a plan nobody but a reader may see (the blocks and the saved versions, no figures: a reader cannot ask the engine anything), save errors in the server's words with the
plan and what was typed kept, a busy server (429) and a too-large plan (413) in plain words, and the 60,000-line limit in Review.

## Layout, keyboard and screen readers

The overview table is DataTable's own: below 768px it is a card per block, and above it scrolls with its first and last columns pinned when it is narrower than its box. (It was
first given `overflow-hidden`, which hid the action buttons below about 1300px and cut a phone card off at the right edge, and a page-level `scrollWidth` check cannot see that:
check the boxes that hide their own overflow.) A Callout's `actions` slot sits beside the text, so a long button goes under it instead. Focus follows the stepper: when a template card,
an edit chip or Add block opens it, or Add to plan, Save block or Cancel closes it, focus goes to the first heading, and when a removed block takes its opener with it, to the block
that took its place. The sticky budget bar and the phone's bottom navigation are cleared with `scroll-mb`, so a control focused from the keyboard is never behind them. Every toggle is a
named radio group or an `aria-pressed` button, text that changes under your hands (the hours in each band, the ratio's effect on the price, what a holiday choice does) is in a polite live
region, and nothing is told by colour alone. The budget is not a live region: it reprices while somebody types, and would speak on every keystroke, so the bar is `aria-busy` while it works; the
Review lines say "Updating prices" once, politely, after a choice. Standing notices are not announced again each time their view comes back, and a block's actions are one toolbar.

## Tests and checks

Backend (`DraftBlocksTests`): block storage, re-pricing on save, immutability (each save is a new version, the old one untouched), tenant scoping (a participant of another tenant is
not found, not saved to), the refusals, the legacy path and the shape of the payload. Frontend: the block model, the quote helpers, the hooks (the exact request bodies), every component and each
flow through `PlanBuilder` and the page, and the settings tab. Where a test needs a quote it reads one the engine wrote: `frontend/src/test/fixtures/golden/*.json`, written by the C# test
`PlanQuoteFrontendFixtureTests` (real 2026-27 catalogue, the API's JSON options), which fails when the engine's answer is no longer the file (regenerate with `ODIP_REGENERATE_GOLDEN=1`, then
run the frontend tests; skipped where there is no frontend beside the backend). The contract tests that read the C# (every rule id and refusal reason has words; the refusals the screen holds
Save back for are `SaveRefusals`) are skipped visibly, not passed, where the backend is absent. A real browser (Playwright over the mock API and Vite) at 1440 and 390, and at 768, 1024 and 1280 for the overview: the
screens, no horizontal overflow, nothing cut off, the whole flow with the keyboard and a visible focus ring on every stop.

## Known limits and open questions

- Two things the brief asked for that the screen does not do, and why: **Move** for a holiday shift (the engine has no such decision; change the block's days), and a holiday choice **for each
  occurrence group** (the engine has one per block). A reader's access to figures is unchanged: `GET` on the drafts is open to every signed-in role and returns unit prices, totals and the
  pricing answer, as the unit prices already were; whether readers may see money is a decision for the owner (open). `Lines` is still accepted on save for old callers until phase D
  requires blocks at approval.
- The settings tab is the ninth on the Settings page, which wraps at 1440px and leaves the last tab alone on a second row: the page's tab bar, not this tab, is what would change.
- What a Review issue stops, and who approves: phase D. Today an issue, a flag or an over-budget plan stops nothing; only an engine refusal holds a save back.
- The plan budget is compared as a total. The funding sources keep their budget category as free text, so a category by category comparison needs the data to change first.
- The owner's open questions (NDIS-CODES 11.3) are shown beside the lines that rest on them and are not decided here: whether all six registration groups may be assumed (1), how
  NDIA divides a group price (5), the 2026-27 travel time caps and per-kilometre rates (6), part-day and regional holidays and Boxing Day or Anzac Day missing from the calendar (8),
  the night the clocks change (13) and a sleepover's active hours at a weekend (14).
- A plan whose every whole week meets a public holiday shows its first seven days as "an ordinary week", holiday included, and says nothing more: the Review step is where the holidays are priced.
