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
  with the revision. The body is capped at 1 MiB and rate limited like the other API routes. A representative with a control character (a NUL, a line break, a tab) is refused with a 400 that says
  so, after the participant is found, and nothing is saved: the database would have refused it as a 500, as it did a control character in a block id; the screen turns a tab or a line break pasted
  into the box into a space and drops any other, so a person never meets it. The same refusal covers the hand-typed path's free text (a line's service type and item code, and the service types, which
  also have limits: 20, 100 characters each, and what the 4000-character column holds once written as JSON); the blocks path derives its service types from the blocks.
- **Two coordinators.** The body may carry `baseVersion`, the version the working copy started from (0 for a participant with none). If a newer one has been saved since, the answer is a 409
  with `code: "draft-version-conflict"` and the newer version in `data.currentVersion`, and nothing is saved, so a save never makes one coordinator's plan the newest over another's. Two saves
  racing past that check meet the unique index on (tenant, participant, version) and get the same 409, not a 500. A body without `baseVersion` is saved as before.
- **The cap covers a save.** Pricing a plan on save is the same work as a quote, so a save with blocks takes a permit from the same per-organisation limiter (two at once, in its own partition so
  a save is never refused because the screen's own quotes are in flight): 429 with `Retry-After: 1` when none is free.
- **The list is not every revision in full.** `GET participants/:id/service-agreement-drafts` returns the newest revision in full and every older one as a summary (`isSummary`, `blockCount`,
  `lineCount`, `total`, `caveats`: no blocks, lines or answer), and `GET participants/:id/service-agreement-drafts/:draftId` returns one in full, which the page asks for when somebody
  opens an older version. A total that leaves work out says so beside the figure (`caveats`, and on the PDF).
- A revision made before this has lines and no blocks. It is read-only, shown as it was, with a note that it can only be rebuilt from blocks.
- A stored block whose text can no longer be read (the model it was written with has changed; a golden stored-JSON test fails first, so this is the net under it) comes back with
  `unreadable: true` and an empty block. The page does not load such a revision for editing (an empty block would look like a plan nobody made) and says so; the version card says "A block that
  could not be read" and keeps the lines as they were saved.

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
twice, and a block with more than one such gap counts its largest, so the figure reads "at least 186 shifts": a lower bound is not printed as the count; the PDF says the same, "At least 186 shifts
have a part that is not priced"). A plan that prices to nothing shows an en dash for its figures, not $0.00, and says there is nothing to compare the plan budget with. With the agreement's dates
not typed, no day, or an end before the start, the bar says so ("Enter the agreement dates to price the plan", "The agreement ends before it starts") and is not busy; nothing of the answer for
the dates before is shown. Below 1280px the bar is one line with Details (it was a third of a tablet's screen), "Not fully priced" and "Over budget" chips beside it, and, while the plan has changes nobody
has saved, "Not saved" with a Save: Add to plan does not save, and the save row is a long scroll below the blocks. What a save said is drawn with the bar, docked in the overview and through every
step of a block, so a Save pressed from the stepper is answered where the person is looking: the problems found, the server's refusal, a newer version somebody else saved (with Load and Keep editing),
and "Saved as version N" in the bar's one polite status. Each notice has a close button ("Close this message"), and an edit to the details or the plan lets go of the problems and the failure
(the newer-version notice is not about what was typed, and stays until it is answered or closed); closing returns focus to the Save that asked. While a newer version is being read to be loaded, Save and
the notice's own buttons are held. The bar has no other live region but a visually hidden "Over the plan budget." that changes only when the plan crosses its budget and a visually hidden "The plan has
changes that are not saved." that is said once, when it becomes so. While a block is refused the reason is an alert in the same dock, beside the Save it switches off ("Block 1 cannot be priced yet, so the
plan cannot be saved."), in the overview and in every step, and the sentence that the draft can still be saved is left out. A week that prices to nothing in an agreement that does not is an en dash.
The dock is as tall as its notice, up to 40vh, so a control the keyboard moves focus to is scrolled clear of it by the dock's own measured height (a ResizeObserver, `--plan-dock-h` on the plan
builder's section), plus the bottom nav below lg, and never by a fixed margin (WCAG 2.4.11). Loading another version closes the block that is open in the stepper (it is a copy from the plan that is
replaced) and the dialog says so first. A quote error and its Try again are outside Details, where a phone sees them.

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
typed reason, a plan nobody but a reader may see (a role that may open the page but not change it; the page keeps that mode as a guard, though today the roles that may open it are the ones that may change it: see Known limits), save errors in the server's words with the
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
  occurrence group** (the engine has one per block). **Who may see an agreement draft (decided):** it carries money (unit prices, totals, the pricing answer, the PDF), and money is never
  visible to SupportWorker or ReadOnly, so the list, the one-revision GET and the PDF GET are admitted to Admin, Coordinator and SuperAdmin like the writes (a test holds every GET on the
  controller to that). The page is the `agreement-drafts` page key, which ReadOnly is refused like Billing and Claims and SupportWorker's allow-list does not name; the participant page and the
  onboarding gate offer the link only to the roles that may open it. (ReadOnly satisfies `canWrite`, so the route used to admit it and the page would now only meet a 403.) The page's read-only
  mode is therefore a guard no role reaches today. `Lines` is still accepted on save for old callers; phase D will refuse to approve a draft that has them ("Rebuild it from blocks to approve it").
- The settings tab is the ninth on the Settings page, which wraps at 1440px and leaves the last tab alone on a second row: the page's tab bar, not this tab, is what would change.
- What a Review issue stops, and who approves: phase D (written below; it stops approving for rostering, never a save). In phase C an issue, a flag or an over-budget plan stopped nothing; only an engine refusal held a save back.
- The plan budget is compared as a total. The funding sources keep their budget category as free text, so a category by category comparison needs the data to change first.
- The owner's open questions (NDIS-CODES 11.3) are shown beside the lines that rest on them and are not decided here: whether all six registration groups may be assumed (1), how
  NDIA divides a group price (5), the 2026-27 travel time caps and per-kilometre rates (6), part-day and regional holidays and Boxing Day or Anzac Day missing from the calendar (8),
  the night the clocks change (13) and a sleepover's active hours at a weekend (14).
- A plan whose every whole week meets a public holiday shows its first seven days as "an ordinary week", holiday included, and says nothing more: the Review step is where the holidays are priced.


---

# Plan builder phase D: "Mark approved" makes roster patterns and open shifts

**Status:** implemented on `feat/plan-approval-patterns` (phase D of 4, after phase C). **Date:** 2026-10-04.
**Not in this phase:** matching what a block asks of a worker to a person (the asks travel and show as chips), a way to un-approve, a warning for a plan that is over its budget (the budget feature), and
making shifts the moment a participant becomes active (the daily job does it on the provider's next day).

## What it does

"Mark approved" on the NEWEST revision of an agreement draft records who approved it and when, makes the weekly roster patterns of its blocks, ends the patterns of the revision approved before it, and makes the
open (unassigned) shifts from the provider's today to 56 days on. It is separate from signing: nothing is signed, the template `status` is untouched, and nothing here activates the participant, invoices or claims.
There is no un-approve. To change anything, save a new revision and approve that: the old patterns end the day before the new revision starts. No shift that exists is changed, cancelled or deleted.

- **Who.** A role in `PlanPricingSettings.ApproverRoles` (Admin and Coordinator by default; the settings tab now says what it is for), and a SuperAdmin with a tenant context. Any other role gets a 403 from both the preview
  and the approval, and the card does not offer the button once the settings say so.
- **What stops it.** Anything flagged in the STORED pricing (`PlanQuote.NeedsReview`: any issue, or any Review line), never a re-quote. The reasons, each with a code the screen has words for:
  `HandTyped` (no blocks or no stored answer: "Rebuild it from blocks to approve it"), `BlockUnreadable`, `BlockInvalid`, the engine's own reasons (catalogue gap, overlapping blocks, travel or sleepover trouble) by name,
  `HolidayUndecided` (a public holiday with no Charge or Skip choice), `ReviewFlag`, `AgreementEnded` (it ended before the provider's today), `TimeZoneMismatch` (the delivery state's zone is not the provider's; both are named,
  nothing is converted), `TooManyPatterns` (more than 100; the count is in the message), `Superseded` and `AlreadyApproved`. Being over budget stops nothing. Unconfirmed registration groups are a notice, not an issue, so they
  stop nothing either: phase C decided that only an Admin confirms them and that saves are not held back, and phase D changed neither (a test pins it).
- **Approving twice** answers 200 with the existing approval and writes nothing, not even an audit row. Two approvals at once give one: the participant's roster lock makes them take turns (PostgreSQL), the unique approval
  per revision and the partial unique pattern key decide a race that gets past it, and the loser reloads and answers with the winner's approval.
- **Hand-made patterns that overlap** (same participant, same weekday, overlapping times and dates, no source) are listed and need `acknowledgeOverlaps: true`. They are never ended or changed.
- **A participant who is not active yet** (an onboarding draft) gets the patterns and no shifts, and the dialog says "Open shifts are created once {first name} is active." The daily job makes them once the readiness
  check allows it.
- **Old shifts.** Shifts the previous approved revisions made, dated on or after this one starts, that still stand (not cancelled, not completed), are counted (open and assigned apart, with the first date and the version) in
  the preview, the answer and the card, with a link to the roster board filtered to them. They are left alone: a coordinator tidies them by hand.

## Endpoints (`ServiceAgreementDraftsController`, Admin, Coordinator, SuperAdmin)

- `GET participants/:id/service-agreement-drafts/:draftId/approval-preview` is what approving would do and nothing done: `canApprove`, `alreadyApproved`, `reasons` (`code`, `message`, `blockId`, `count`, `firstDate`),
  `patternsToCreate`, `patternsToEnd`, `endsFromVersion`, `endsOn`, `shiftsToCreate`, `shiftsNote`, `horizonEnd`, `oldShiftsRemaining` and `overlappingPatterns`. A read, so it sits with the money reads.
- `POST participants/:id/service-agreement-drafts/:draftId/approve` takes `{ "acknowledgeOverlaps": bool }` (4 KiB cap, the "api" rate limit) and answers with the revision as the list shows it, `approval` and
  `oldShiftsRemaining` included: 200 (first approval and repeat alike), 400 with the refusals in `errors` (or the overlaps not acknowledged), 403 not an approver, 404, 409 `code: "draft-superseded"` with the newest version in
  `data.currentVersion`.
- The list and the one-revision GET carry `approval` (who, when, the counts, the first shift day and the horizon's end) and `oldShiftsRemaining`. A pattern carries `sourceDraftId`, `sourceBlockKey`, `sourceDraftVersion`, `workerSlot` and
  `requirements`; a shift carries `requirements`.

## Block to pattern (the defaults the owner may overrule)

| Block | Patterns |
|---|---|
| each listed day, each worker | one pattern per (day, worker slot): a 2:1 support (2 workers, 1 participant) is slots 1 and 2, both `TwoToOne`, both open |
| ratio from (workers, participants present) | (1,1) OneToOne, (2,1) TwoToOne, (1,2) OneToTwo, (1,3) OneToThree, (1,4) OneToFour, (1,5) OneToFive, (1, more than 5) SharedSupport, anything else Other |
| night type | the worker may sleep: Sleepover; else the block crosses midnight: ActiveNight; else None |
| times | the block's start and end on its START day; a block whose start and end are the same time is 24 hours (ends the next day) |
| dates | the revision's agreement start and end, both inclusive, never clamped to today |
| the rest | no default worker, active, notes "From agreement v{n}: {support}, {setting}", the block's requirements copied, tenant taken from the revision |

Pricing facts with no roster home (travel, transport, accommodation nights, headcount changes, the holiday decision) are not copied. A public holiday the plan SKIPS gets no shift: the generator leaves out the
(block, date) pairs the stored pricing marks `skipped`.

## Data (one additive migration, `AddServiceAgreementApprovalAndPatternSource`)

- `ShiftPatterns` gets nullable `SourceDraftId` (FK to `ServiceAgreementDrafts`, Restrict), `SourceBlockKey` (64), `WorkerSlot` and `RequirementsJson` (`jsonb`), a plain index on `SourceDraftId`, and a PARTIAL UNIQUE
  index `IX_ShiftPatterns_SourceDraft_Block_Day_Slot` on (`SourceDraftId`, `SourceBlockKey`, `DayOfWeek`, `WorkerSlot`) `WHERE "SourceDraftId" IS NOT NULL`, so a hand-made or demo pattern is outside it.
- `Shifts` gets a nullable `RequirementsJson` (`jsonb`), copied from the pattern when a shift is made. There is NO unique index on `Shifts`: the demo pack places its shifts by deterministic id and a natural key
  there would wedge it. The advisory lock below is what keeps generation from doubling a shift.
- A new table `ServiceAgreementDraftApprovals`, unique on `DraftId`, FKs Restrict, audited: who, when (the injected clock), the counts (`PatternsCreated`, `PatternsEnded`, `ShiftsCreated`), the first day shifts were made for and the
  end of the horizon they were made to (`FirstShiftDate`, `HorizonEnd`: two columns beyond the brief, so the card can say "open shifts to {date}" and link to the first one without counting). The revision rows are not touched, so a revision stays immutable.
- Every new column is nullable, so every existing row is a hand-made pattern or a shift as it always was. The demo suites keep their pattern counts; the one test that accounts for unique indexes knows the new one.

## One generator, a lock and a daily job

- `RosterShiftGenerator` (Infrastructure) is the single place a pattern becomes shifts: the Generate button, the approval and the job all use it. On PostgreSQL it takes
  `pg_advisory_xact_lock(hashtext('roster-generate:' || participantId))` (a no-op elsewhere, and it joins a transaction already open), reads the patterns again, looks up the shifts the pattern already has in one query
  and adds the missing days. The Generate endpoint answers as it did.
- `RosterTopUpBackgroundService` ticks hourly (the first run a minute after start). Once for each organisation's PROVIDER day, kept in memory (a restart does it again, which is harmless), it generates from the provider's
  today to today plus the horizon for the active, not-ended agreement patterns of participants who may be rostered. Hand-made, demo, ended and switched-off patterns are never read. A participant who fails is logged and counted
  without stopping the rest; each run logs one summary line (organisations, participants, patterns, shifts made, participants not ready, failures).
- The readiness check lives in the API project, which Infrastructure cannot reference, so the approval and the job ask it through `IRosterPlacementGate`; the API registers it over `ParticipantReadiness.CheckAsync`.

**Settings** (`appsettings.json`, the compose environment and `.env.example`):

| Setting | Environment variable | Default | Meaning |
|---|---|---|---|
| `RosterTopUp:Enabled` | `ROSTER_TOP_UP_ENABLED` | `true` | the daily job runs; `false` stops it (approval still makes shifts) |
| `RosterTopUp:HorizonDays` | `ROSTER_TOP_UP_HORIZON_DAYS` | `56` | how far ahead shifts are made, from the provider's today; 7 to 366, and an unusable value reads as 56 |

Approval uses the same horizon. "Today" is always the PROVIDER's day (its state's zone), from the injected clock: at 2am UTC on Friday 2 October it is already Saturday 3 October in Sydney.

## What the screens do

- **The revision card.** A "Mark approved" row on the newest revision that was built from blocks, for a role that may approve; it opens the confirm dialog. A role the organisation does not let approve is told who may ("Your
  organisation lets only Admin approve plans."), and an older or hand-typed revision offers nothing. An approved revision, newest or not, shows who and when, "{n} weekly patterns, open shifts to {date}." with "Open on the roster" (the board
  filtered to this participant's open shifts from the first one; "Open the shift patterns" when no shift was made, with "Open shifts are created each day as the dates come within 8 weeks, once the participant is
  active."), and "Approved for rostering, separate from signing: the agreement itself is not signed."
- **The confirm dialog.** "Approve for rostering?" says what it will do ("Creates {n} weekly patterns and the open shifts up to {date}. Ends {m} patterns from version {k} the day before {start}."), the old shifts it leaves ("{o} open and {a} assigned shifts from
  version {k} on or after {start} stay on the roster.") with a "Review them" link, and, when hand-made patterns overlap, each of them and a required "These hand-made patterns stay as they are. I have checked them." box. When something stops it, the title is "Not ready to approve"
  and each reason is in plain words with a "Go to block N" that closes the dialog and puts focus on the step to fix. One place has the words, so the card does not print them a second time.
- **The approved page is read only.** The plan shows as it was priced, without the "ordinary week" column when nothing was stored for it, and "Start a new revision" makes it editable again as a working copy of this
  revision. The page's banner says approving makes patterns and open shifts and nothing else.
- **The roster board** opens from an address: `/rostering?date=<Monday>&participant=<id>[&unfilled=1]`, filtered, so "Review them" and "Open on the roster" land on the right week. **Patterns** has a "From agreement" column
  ("From agreement v2" and what the agreement asks as chips), and an agreement pattern stays editable, with a warning in its form: "This pattern came from agreement v{n}; changing it here makes the roster differ from the
  agreement." The shift form shows the asks as chips too.
- The mock API keeps approval stateful (`mock-api/planApproval.js`) so every screen above runs offline; `MOCK_TODAY` pins its date.

## Tests and checks

Backend: the schema (`PlanApprovalSchemaTests`), the generator (`RosterShiftGeneratorTests`: horizon, holidays skipped, the existing shifts left alone, 24-hour and overnight blocks), the mapper
(`AgreementPatternMapperTests`: the ratio and night type tables, two patterns for 2:1, the cap), the service (`ServiceAgreementApprovalServiceTests`, on a fixed clock: every refusal, ending old patterns, overlaps, the
horizon, a participant not ready, the Sydney versus UTC day, idempotence, roles, another tenant's draft), the endpoints (`ServiceAgreementApprovalControllerTests`), the DTOs, the job
(`RosterTopUpBackgroundServiceTests`) and six PostgreSQL tests in `PlanApprovalPostgresTests` that SKIP where there is no database and run in CI: the migration over live rows, the partial unique index and the Restrict
FKs, `jsonb`, four concurrent approvals giving one, a next revision ending the old patterns and the job topping up, and eight concurrent generations giving no duplicate shift. Frontend: the hooks (the exact request
bodies, and which queries a success or an error refreshes), the card, the dialog, the page's whole approve flow, the read-only page, the roster board's address, the Patterns page and the two slide-overs. The
demo-data suites are unchanged and stay green.

## Known limits and open questions

- Defaults the owner is asked to confirm (each is a test and one line of code): a 2:1 block makes two open patterns a day; a time-zone mismatch is refused, never converted; the cap is 100 patterns; hand-made overlaps are listed,
  never ended; a public holiday the plan Skips gets no shift; an agreement pattern stays editable (badge and warning, no lock).
- What a block asks of a worker (gender, driver, skills) is copied to the pattern and shown, and nothing matches it to a person. A "female worker" ask could not be checked today in any case: staff have no gender field.
- A participant who is not active when the revision is approved gets the shifts from the job on the provider's next day after they become active (it does each organisation once a day), not at the moment of
  activation. Making them at activation is a later change.
- An approved revision cannot be un-approved, and an older approved revision's shifts past a new one's start are listed, not removed. A "clear future open shifts" action for them is the likely next ask.
