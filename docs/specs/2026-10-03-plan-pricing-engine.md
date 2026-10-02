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

## The pipeline (NDIS-CODES 11.2)

1. **Occurrences:** the roster's `ShiftPatternExpander` gives each block's dates in the period; an occurrence belongs to the period by the date it starts.
2. **Holidays:** the delivery state's calendar (national rows and that state's), from the synced `PublicHoliday` rows and the `PublicHolidayOverride`
   rows together. A public holiday beats Saturday and Sunday. A part-day holiday is the holiday rate only inside its hours.
3. **Bands:** a weekday splits at 06:00 (night), 20:00 (evening) and midnight; Saturday, Sunday and a public holiday are one band for the calendar day.
   The occurrence also splits where the headcount changes. Hours are **elapsed** hours in the delivery zone (a clock-change night is 7 or 9 hours).
4. **Sleepover:** 8 hours or more across midnight with the worker allowed to sleep: one Each item (01_010, or 01_206 in STA), whatever the day. Active
   hours beyond 2 are extra hourly lines at the Saturday rate on a weekday, or the day's own rate. A worker who may sleep in a window that is not a
   sleepover is priced hourly and flagged. Community and group blocks have no sleepover item: the night is an unpriced Review line, never another family.
5. **Crossing policy** (provider setting): **A** prices each part at its own item; **B** prices a one-worker support at the higher of its parts,
   claimed on one service date (the day it starts, so a later price import cannot change it), never across a sleepover, not when the headcount changes or
   a part has no item.
6. **Price:** the maximum for (item, zone, service date) x workers / participants present, floored to the cent; total = unit price x elapsed hours, floored.
7. **Companions:** provider travel time (capped 30 minutes a leg in MM1-3, 60 in MM4-5, none in MM6-7; on the support item), provider travel kilometres
   (the non-labour item of the support's registration group), activity-based transport (kilometres by vehicle, tolls and parking at cost, shared),
   centre capital cost (per participant per hour, not divided), STA accommodation nights (01_250, and 01_251 when a worker must stay).
8. **Lines:** `PlannedLine` with item, unit, quantity, unit price, total, service date, local times, band, budget category, flags and a trace.

A weekday community or group support in the Weekday Night band (00:00 to 06:00) has no item in any catalogue: it is an unpriced line with the Review
flag and the reason `NoItem`.

## Output

- **Flags:** `Review` (a person must decide: an unruled holiday, a band with no item, a sleepover that does not qualify, a catalogue gap),
  `HolidayExposure` (priced at a public holiday item), `Provisional` (a 2025-26 travel rate or cap, or a reading NDIA has not confirmed).
- **Trace:** rule ids, a sentence of why, the catalogue version and the start of the row that priced it (the price basis date), the maximum before the
  group arithmetic, workers and participants, the crossing policy, the holiday, and the numbers of the open questions it depends on.
- **Issues** (typed, deduplicated with a count and the first date), **notices** (the registration groups are unconfirmed), **holiday occurrences**
  (what the holiday adds over an ordinary day: Monday 5 October 2026 in NSW is 653.84 against 294.32), **skipped occurrences**, **totals** by budget
  category (PACE) and by block, and the **owner questions** (NDIS-CODES 11.3) the quote depends on: 1 (groups unconfirmed), 5 (group divisor on a
  sleepover, worker accommodation, a headcount change, shared travel), 6 (travel caps and rates), 8 (part-day holidays).
- A weekly figure is a quote over one week; there is no separate weekly mode.
- `PlanCancellation.MaximumClaim` is the short-notice ceiling a line implies (up to 100% inside 7 days, none for a program of support).

## Provider settings and the override table

`PlanPricingSettings` (one row per tenant; no row means the defaults): registration groups held (all six, `registrationGroupsConfirmed` false until set),
crossing policy A, provider travel claimed at 0.99 and 2.76 a kilometre marked provisional (2025-26 values), group outings under RG 0136, STA planned
with the hourly items plus accommodation (the legacy per-day items are refused: they end on 30 June 2027), approvers Admin and Coordinator (stored for
phase D). A family whose registration group is off is refused with `RegistrationGroupNotHeld`.

`PublicHolidayOverride` (global): date, state or national, name, part-day start and end, source. The migration seeds the gaps NDIS-CODES 5.3 found
against the Nager.Date feed: Boxing Day 26 December 2026 (ACT, NSW, NT, QLD, VIC, WA; SA's Proclamation Day), Anzac Day 25 April 2027 (NSW, WA, and the
ACT's extra day), and the part-day rows (NT and SA 19:00, QLD 18:00, to midnight, on Christmas Eve and New Year's Eve). Not seeded: the Tasmanian
area-limited days (the table has no area). After the seed the table is the owner's to maintain; there is no screen or route for it yet (SQL, or a
migration), and a whole-day holiday can also be added with `POST api/v1/public-holidays`.

One migration, `AddPlanPricingSettingsAndHolidayOverrides`: two `CreateTable`s, their indexes and the seed rows. It touches nothing that exists.

## Internal endpoint

`POST api/v1/plan-pricing/quote` (SuperAdmin, Admin, Coordinator; **internal**, phase C's builder is the only caller): body `blocks`, `periodFrom`,
`periodTo`, `includeLines`. The server reads the caller's tenant's settings, the catalogue rows that touch the period and the holidays; the client sends
no price and no policy. At most 200 blocks and 800 days. `GET` and `PUT api/v1/plan-pricing/settings` (PUT: Admin and SuperAdmin; only the fields sent
change; sending the registration groups confirms them).

## Known limits

- Provider travel caps and per-kilometre rates are 2025-26 values (flagged). The group divisor on a sleepover, worker accommodation, a changing headcount
  and shared travel are applied as the research reads them and flagged. Part-day holidays are the holiday rate only inside their hours (flagged).
- The named dates (26 December, 25 April) are not coded as rules: the calendar is data. A year the feed gets wrong needs override rows.
- Regional holidays (Tasmania) are not modelled. Legacy per-day STA items, quotable items, GST, self-managed prices and plan budgets are out of scope.
- The block has one headcount timeline and one worker count; two workers who do not stay for the whole block are not modelled.
