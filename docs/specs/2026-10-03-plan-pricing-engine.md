# Plan builder phase B: the pricing engine

**Status:** implemented on `feat/plan-pricing-engine` (phase B of 4). **Date:** 2026-10-03.
**Not in this phase:** the builder screen (C), agreement storage of blocks and "Mark approved" (D), roster patterns, any change to the existing claim engines.

## What it is

A pure, deterministic engine that turns a participant's weekly support blocks and an agreement period into dated NDIS claim lines and prices
(`Odip.Domain/Billing/Pricing`, entry point `PlanPricingEngine.Quote`). It reads no clock, no database and no randomness: every input is on the
request, so the same request always gives the same quote. `PlanPricingService` loads the inputs (settings, the catalogue rows that can price the period,
the holidays) and an internal endpoint exposes it. Prices are never constants: each is the catalogue maximum for (item, zone, service date), found by
the phase A classifier (`CatalogueClassifier.KeysFor`) and the phase A date-effective lookup (`EffectiveCatalogueResolver.Find`).

## The block (input)

One weekly routine of one support type: support type (personal care, community access, group activity, STA support), intensity, weekdays, local start
and end (the end is on the next day when it is not after the start, derived; start = end is 24 hours), workers and participants present (plus
`headcountChanges` inside the block), setting (community, centre, at home, accommodation), delivery location (state, price zone National / Remote /
Very Remote, optional Modified Monash level), `workerMaySleep` with an optional `sleepoverWindow` and `sleepoverActiveHours`, `onPublicHoliday`
(Review by default, Charge, Skip), provider travel, activity-based transport and STA accommodation nights. `PlanBlock.Validate()` names every problem; the
engine reports them as issues and prices nothing from the block.

Two fields go beyond the research's block model because its own examples need them: a **sleepover window** (example 6 is a 16 hour block with a
22:00 to 06:00 sleepover inside it, which `workerMaySleep` alone cannot say) and **headcount changes** (example 8, a participant leaving at 12:00).

Rules `Validate()` enforces beyond the obvious ranges (each is an `InvalidInput` issue naming the block, never a 500):
- **Headcount changes:** at most 10 a block (each one cuts every occurrence into another line), strictly inside the block, one per time. A null list or a
  null entry is a message, not an exception, and the list then counts as empty.
- **Sleepover window:** a block of more than 12 hours where the worker may sleep must give the window (without one the whole block is the night, and a 24
  hour block was one 311.79 item). 12 hours exactly is fine.
- **Id:** at most 64 characters. A longer id is refused, and every message and issue about a block shows only its first 64 characters and an ellipsis (a
  request under 1 MiB can carry one block with a million-character id that is wrong in a couple of dozen ways: repeating the id in each message and each
  issue made about 56 MB of answer).
- **Numbers are checked in their own units:** any decimal or integer a request can carry is a message and never an overflow (the sleepover's active hours
  are compared with the window in hours, not multiplied into minutes), so one bad block is one block's issue and never a 500 for the quote.
- **Sharing:** `participantsSharing` on provider travel and on activity-based transport is optional. Left out, it is the participants present (the trip is one
  claim, not one per participant's plan); giving 1 still means one participant takes the whole trip. It cannot be more than the most participants present at
  any time in the block.

## The pipeline (NDIS-CODES 11.2)

1. **Occurrences:** the roster's `ShiftPatternExpander` gives each block's dates in the period; an occurrence belongs to the period by the date it starts.
2. **Holidays:** the delivery state's calendar (national rows and that state's), from the synced `PublicHoliday` rows and the `PublicHolidayOverride`
   rows together. A public holiday beats Saturday and Sunday. A part-day holiday is the holiday rate only inside its hours; no end, or an end of 00:00 on a
   row that has a start, means to midnight. 26 December and 25 April are named public holidays in the pricing schedule: when the calendar has no row for the
   delivery state on one (a weekend or substitute day the feed leaves out) the occurrence is priced as an ordinary day, every line is Review with the issue
   `NamedDateNotInCalendar` and question 8; the block saying Charge prices it as a whole-day holiday, Skip drops it.
3. **Bands:** a weekday splits at 06:00 (night), 20:00 (evening) and midnight; Saturday, Sunday and a public holiday are one band for the calendar day.
   The occurrence also splits where the headcount changes. Hours are **elapsed** hours in the delivery zone (a clock-change night is 7 or 9 hours). The hour
   the clocks skip going forward does not exist: a boundary in it is the instant the clocks jump, a part wholly inside it is no line, and a support wholly inside
   it is the issue `SupportInSkippedHour`. Without a tz database the host's zones are a fixed +10:00 and every quote says so (`timeBasis`).
4. **Sleepover:** 8 elapsed hours or more across midnight with the worker allowed to sleep: one Each item (01_010, or 01_206 in STA), whatever the day.
   Active hours beyond 2 are extra hourly lines at the Saturday rate on a weekday, or the rate of the day the sleepover starts. A sleepover that starts on a
   Saturday or a Sunday runs past midnight into a day with another rate and the engine does not know when the active hours are worked, so those lines are
   Provisional with question 14 (a group fraction on them is Provisional with question 5, like the Each line). A worker who may sleep in a window that is not
   a sleepover is priced hourly and flagged. On a night the clocks change, the 8 hours counted on the clock and elapsed disagree: elapsed hours decide, and
   every line of that occurrence is Provisional and Review, with the issue `SleepoverClockChange` and question 13. Community and group blocks have no
   sleepover item: the night is an unpriced Review line, never another family.
5. **Crossing policy** (provider setting): **A** prices each part at its own item; **B** prices a one-worker support at the higher of its parts,
   claimed on one service date (the day it starts, so a later price import cannot change it), never across a sleepover, not when the headcount changes or
   a part has no item. A crossing is a support that runs across more than one day span: a split for a headcount change alone is not labelled one.
6. **Price:** the maximum for (item, zone, service date) x workers / participants present, floored to the cent; total = unit price x elapsed hours, floored.
   More than one worker for more than one participant is the divisor NDIA has not answered (NDIS-CODES 6, question 5): every hourly line it touches is
   Provisional and names question 5.
7. **Companions:** provider travel time (capped 30 minutes a leg in MM1-3, 60 in MM4-5, none in MM6-7, for each worker; on the support item), provider travel kilometres
   (the non-labour item of the support's registration group), activity-based transport (kilometres by vehicle, tolls and parking at cost, shared),
   centre capital cost (per participant per hour, not divided), STA accommodation nights (01_250, and 01_251 when a worker must stay).
8. **Lines:** `PlannedLine` with item, unit, quantity, unit price, total, service date, local times, band, budget category, flags and a trace. **`total` is
   authoritative**: add up and claim totals, never quantity x unit price (the quantity is rounded to 4 decimal places, so 40 minutes at 73.58 is quantity
   0.6667 and total 49.05, not 49.06), and claim hours as hours and minutes (0:40).

A weekday community or group support in the Weekday Night band (00:00 to 06:00) has no item in any catalogue: it is an unpriced line with the Review
flag and the reason `NoItem`.

## Output

- **Flags:** `Review` (a person must decide: a public holiday nobody has ruled on, a band with no item, a sleepover that does not qualify, a catalogue
  gap; a holiday stops asking once the block says Charge or Skip, and Move is a builder action: the coordinator edits the block),
  `HolidayExposure` (priced at a public holiday item), `Provisional` (a 2025-26 travel rate or cap, or a reading NDIA has not confirmed).
- **Trace:** rule ids, a sentence of why, the catalogue version and the start of the row that priced it (the price basis date), the maximum before the
  group arithmetic, workers and participants, the crossing policy, the holiday, and the numbers of the open questions it depends on.
- **Issues** (typed, deduplicated with a count and the first date), **notices** (the registration groups are unconfirmed; the holiday calendar cannot be
  trusted: `holiday-calendar-missing` when the period reaches a year with no rows for a delivery state, `holiday-overrides-end` when it runs past the last
  override row; both question 8), **holiday occurrences** (what the holiday adds over an ordinary day: Monday 5 October 2026 in NSW is 653.84 against
  294.32), **skipped occurrences**, **totals** by budget category (PACE) and by block, and the **owner questions** (NDIS-CODES 11.3) the quote depends
  on: 1 (groups unconfirmed), 5 (group divisor on a sleepover or its active hours, worker accommodation, a headcount change, two workers for several
  participants, shared travel), 6 (travel caps and rates), 8 (part-day holidays, named dates, calendar gaps), 13 (the night the clocks change), 14
  (active hours of a sleepover that starts on a Saturday or a Sunday).
- **Overlapping blocks:** two blocks on at the same time on the same date are each priced in full, so the same participant's hour could be billed twice. It is
  a Review issue `BlocksOverlap` naming both blocks, once per pair with a count. Two workers at once are one block with `workers` 2.
- **`timeBasis`:** `tz-database` or `fixed+10:00` (the host had no tz database). The same request gives the same quote on the same basis; the 3 October 2026
  Saturday night is 8 hours and one sleepover item on a fixed +10:00 and 7 hours priced hourly with the database.
- A weekly figure is a quote over one week; there is no separate weekly mode.
- `PlanCancellation.MaximumClaim` is the short-notice ceiling a line implies (up to 100% inside 7 days, none for a program of support).

## Provider settings and the override table

`PlanPricingSettings` (one row per tenant; no row means the defaults): registration groups held (all six, `registrationGroupsConfirmed` false until set),
crossing policy A, provider travel claimed at 0.99 and 2.76 a kilometre marked provisional (2025-26 values), group outings under RG 0136, STA planned
with the hourly items plus accommodation (the legacy per-day items are refused: they end on 30 June 2027), approvers Admin and Coordinator (stored for
phase D). A family whose registration group is off is refused with `RegistrationGroupNotHeld`. The per-kilometre rates are at most $5 (a slipped decimal
point, 9.90 for 0.99, was once accepted). Two first PUTs for one tenant at once both succeed: the loser re-reads the row that won and applies its change.

`PublicHolidayOverride` (global): date, state or national, name, part-day start and end, source. The migration seeds the gaps NDIS-CODES 5.3 found
against the Nager.Date feed: Boxing Day 26 December 2026 (ACT, NSW, NT, QLD, VIC, WA; SA's Proclamation Day), Anzac Day 25 April 2027 (NSW, WA, and the
ACT's extra day), and the part-day rows (NT and SA 19:00, QLD 18:00, to midnight, on Christmas Eve and New Year's Eve). Not seeded: the Tasmanian
area-limited days (the table has no area). After the seed the table is the owner's to maintain; there is no screen or route for it yet (SQL, or a
migration), and a whole-day holiday can also be added with `POST api/v1/public-holidays`. That route, `DELETE api/v1/public-holidays/{id}` and
`POST api/v1/public-holidays/sync` are SuperAdmin only (the table is global and a row moves every tenant's prices), the state must be one of the eight
codes or left out for a national holiday, and `PublicHoliday` is an audited entity like the overrides (review M6).

One migration, `AddPlanPricingSettingsAndHolidayOverrides`: two `CreateTable`s, their indexes and the seed rows. It touches nothing that exists. Each seed row
has its own literal id (never one derived from its place in the list: a row inserted mid-list would renumber the rest and `HasData` would rewrite rows the owner
has edited).

## Internal endpoint

`POST api/v1/plan-pricing/quote` (SuperAdmin, Admin, Coordinator; **internal**, phase C's builder is the only caller): body `blocks`, `periodFrom`,
`periodTo`, `includeLines`. The server reads the caller's tenant's settings, the catalogue rows that touch the period and the holidays; the client sends
no price and no policy. At most 200 blocks, 800 days, 25,000 dated occurrences and about 100,000 lines (each block's occurrences times an upper bound of its lines: a plain block is 3, and every headcount change, up to 10 a block, adds one); a bigger plan is an issue in the answer, not work done. The bound is tight (the heaviest short-term accommodation shape makes 20 lines, 22 with a mid-day part-day holiday, against a bound of 22; a test sweeps it) as long as a date has at most one part-day holiday row. `includeLines: false` keeps the answer small. `GET` and `PUT api/v1/plan-pricing/settings` (PUT: Admin and SuperAdmin; only the fields sent
change; sending the registration groups confirms them). An answer with `includeLines` true is refused above 60,000 lines (ask for the totals only, or shorten
the period); the quote is rate limited with the app's `api` policy (100 a minute a client), has at most two quotes in flight per organisation (a third is
refused at once with a 429, "Try again shortly" and `Retry-After: 1`, never queued; the key is the tenant, or the user when there is none) and stops when the
client cancels it.

## Known limits

- Provider travel caps and per-kilometre rates are 2025-26 values (flagged). The group divisor on a sleepover, worker accommodation, a changing headcount
  and shared travel are applied as the research reads them and flagged. Part-day holidays are the holiday rate only inside their hours (flagged).
- The named dates (26 December, 25 April) are only a Review-only fallback when the calendar has no row for the state on them; otherwise the calendar is data.
  A year the feed gets wrong needs override rows, and the override table has no screen yet (SQL or a migration): the owner needs a way to maintain it before
  the 2027 calendar runs out (the feed syncs this year and the next, the seeded overrides end on 25 April 2027, and the quote notices say so).
- **Skip drops the whole occurrence** (for phase C's copy of the choice): a block set to Skip on a public holiday drops the whole occurrence for any minute that
  touches the holiday, not only the holiday part. Monday 22:00 to Tuesday 02:00 with a Tuesday holiday also loses Monday's 2 hour evening (162.14). It is
  deliberate and pinned by a test (`PlanPricingHolidayTests`); the builder should say "the whole shift is skipped" next to the choice.
- Two blocks that overlap are flagged, not merged; a person resolves them (`workers` 2 is the way to price two workers at once).
- Regional holidays (Tasmania) are not modelled. Legacy per-day STA items, quotable items, GST, self-managed prices and plan budgets are out of scope.
- The block has one headcount timeline and one worker count; two workers who do not stay for the whole block are not modelled.
