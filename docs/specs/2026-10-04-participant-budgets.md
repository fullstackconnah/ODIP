# Participant budgets, phase 1: the budget record

**Status:** implemented on `feat/budget-record` (phase 1 of 3). **Date:** 2026-10-04.
**Not in this phase:** every figure that is worked out (Available, Used, Booked ahead, Forecast), the four statuses and the three alerts, claim figures, the dashboard tile and the Budgets list, the plan builder's budget bar, every check at the moment of action (roster findings, the hard limit, the Admin override, the emergency path) and the rejected-claim code. Phase 1 stores what the plan says and asks for it at activation. Nothing reads a number back yet, and the Funding tab says so.

## Why

The owner's goal (2026-10-03): capture each participant's funding limit at profile setup, keep the service agreement inside it, track the budget against every claim through the funding period, and warn when it is approaching, when the forecast to the end of the funding period goes over (ad-hoc shifts included) and when it is over. Warnings by default; hard limits can be switched on in Settings.

What that rests on (the NDIS research):

- A provider cannot see a participant's budget in the NDIA portal. The figures come from the plan the participant shares, or from their plan manager, so ODIP records them by hand and says where they came from.
- Funding is released in periods, usually 3-monthly on plans made since May 2025. Unspent money rolls forward inside the plan and is lost at reassessment.
- Core categories 01 to 04 form one flexible pool (Oassist bills 01 and 04). Each capacity-building or capital support is its own stated pool.
- The NDIA refuses payment past a plan, pool or period cap (codes V17, V18, V27, V28), and may pay past one to prevent an imminent risk to safety.

The older design, [service agreements and budgets](2026-09-08-service-agreements-and-budgets-design.md), was approved and never built. This work keeps its "computed, never stored" drawdown and drops its stale parts.

## The three phases

| Phase | What it delivers | State |
|---|---|---|
| 1. Budget record | the plan, pool and period data and its API; the Funding tab and its editor; the intake and profile step; the "Funding recorded" readiness item; the Settings tab (stored, not yet enforced) | this document |
| 2. Ledger and visibility | the server-side budget service; the Funding tab's figures; the claim figures; the three alerts; the dashboard tile and the Budgets list; the plan builder's budget bar on the new model; the rejected-claim code | next |
| 3. Moments and hard limits | the roster findings; the hard-limit mode, the Admin override and the emergency path with its review task; the pattern-generate and trip-booking warnings | after phase 2 |

Each phase is its own PR with review and gates. Phase 1 ran alongside plan builder phase D, which adds its own migration.

## Owner decisions (2026-10-03)

1. **The limit: both, and ours is enforced.** Record the plan's budget per NDIS category. When the participant also uses other providers, record the part set aside for the organisation as well. Warnings and limits use the set-aside when there is one and the plan amount otherwise.
2. **Hard limits (switched on in Settings) block ad-hoc shifts that overrun, and an Admin can override** with a written reason that goes in the audit log. Agreements over the limit and claims beyond the funds only warn. Recording a support that was actually delivered is never blocked.
3. **Emergencies: a safety reason, and an Admin reviews.** With hard limits on, any Coordinator can add an overrunning ad-hoc shift by choosing "Emergency or safety" and describing it. It saves at once and is flagged for review. This path cannot be switched off.
4. **Capture is a readiness check.** Intake asks for the plan budget, and "Funding recorded" joins the activation checklist for NDIS-funded participants. Warn mode lists it; Enforce mode makes activation wait.
5. **In-app only.** No budget emails.

Decisions 2 and 3 are phase 3. Phase 1 stores the mode and the percentage so the choice is waiting for them.

## The record (backend)

Four new tables in one additive migration, `AddParticipantBudgetRecord`. All are `ITenantEntity` with the tenant query filter, and all are in `AuditedEntities`, so every change has an audit row (`CreatedAt` and `UpdatedAt` are left out of the diffs).

- `FundingPlans`: the participant, `PlanStart`, `PlanEnd`, an optional `ReassessmentDate`, an optional `PeriodLengthMonths` (1, 3, 6 or 12; none means the plan has no funding periods), where the figures came from (`Evidence`: a copy of the plan, the plan manager, the participant, the support coordinator, another source), when and by whom they were confirmed (free text), notes, and a `Revision` that rises on every save.
- `FundingPools`: one Core (flexible) pool (categories 01 to 04, so no category of its own) or one stated support (any other support category), with who manages the money (agency, plan or self managed), a name and notes.
- `FundingPeriods`: a pool's dates and money for one funding period: the plan amount, and the organisation's set-aside when there is one. Money is `decimal(18,2)`; the client works in whole cents.
- `BudgetSettings`: one row per organisation, holding the budget mode and the "approaching" percentage, with constant defaults (Warn, 80) so a missing row means the defaults.

Money never travels on the participant DTO, and every endpoint that carries money is closed to SupportWorker and ReadOnly (the category list holds none, so any signed-in role can read it).

### Rules

`FundingPlanValidator` is pure and reports every problem at once, each in plain words, so the editor and the server say the same thing.

- **The plan:** both dates, the end not before the start, at most 800 days. A period length of 1, 3, 6 or 12 months, or none. A source chosen. Confirmed-by up to 200 characters and notes up to 2,000.
- **Pools:** at least one and at most 40. Each is Core (flexible) or a stated support, with a manager chosen. A plan holds each category once for each way of managing it. Stated pools can be any support category except 01 to 04 (Core) and 18 (Recurring Transport, paid to the participant and never claimed by providers); `GET funding/pace-categories` serves the list of 21 and flags those two.
- **Periods:** at least one and at most 60 per pool. With no period length a pool has one period, the whole plan. Otherwise the periods run from the plan's first day to its last with no gap and no overlap, each starting the day after the one before ends, none longer than 12 months. The server checks that the periods fit the plan; it does not insist on the editor's way of cutting them.
- **Money:** zero or more, at most $99,999,999.99, in dollars and cents. A set-aside is never more than the plan amount, and is given for every period of a pool or for none.
- **Overlap:** one participant's plans never overlap.
- **A crafted body:** a null where a pool or a period should be, a period starting in the last year the calendar holds, and a null character in the notes, "confirmed by" or a pool's name or notes are each refused in plain words (a 400), never with an exception.

### Two people saving

- **Revision.** A change is sent with the revision it was made from. If someone has saved since, the answer is 409 with `code: "funding-revision-conflict"` and `data.currentRevision`, and nothing is saved. The editor keeps what the person typed and offers "Load the latest".
- **Overlap.** The check runs in a transaction holding `FOR NO KEY UPDATE` on the participant's row (`FundingPlanLock`, the same pattern as `ShiftRowLock`), so two creates for overlapping plans queue and the second sees the first. The unique index on (tenant, participant, plan start) is the backstop, and a unique violation (23505) is mapped to the same overlap 409 (`code: "funding-plan-overlap"`, naming the other plan); a 23505 with no overlapping plan to name, or any other database error, is thrown, never taken for an overlap. A delete and "use this plan's dates" take the same lock (after checking the participant is in the tenant) and read under it, so neither races a replace in flight.
- A save merges pools and periods by their natural keys (category and manager; period start) instead of replacing them, so rows keep their ids and the audit log shows what changed.

### Routes

| Route | Roles | What it does |
|---|---|---|
| `GET api/v1/participants/{id}/funding/plans` | SuperAdmin, Admin, Coordinator | the plans, newest first, with the plan dates the profile itself holds |
| `POST …/funding/plans` | same | records a plan (201) |
| `PUT …/funding/plans/{planId}` | same | replaces a plan; carries `revision` |
| `DELETE …/funding/plans/{planId}` | SuperAdmin, Admin | deletes a plan with its pools and periods; no screen offers it yet |
| `POST …/funding/plans/{planId}/apply-dates-to-profile` | SuperAdmin, Admin, Coordinator | copies the plan's dates onto the participant's own NDIS plan dates |
| `GET …/funding/billing-sources-hint` | same | the active NDIS funding sources on the Billing page that have a budget, as a starting point for a pool. The Billing page is not changed. |
| `GET api/v1/funding/pace-categories` | every signed-in role | the 21 support categories (no money in it) |
| `GET api/v1/funding/settings` | SuperAdmin, Admin, Coordinator | the mode and percentage, or the defaults |
| `PUT api/v1/funding/settings` | SuperAdmin, Admin | changes only the fields sent; one audit row per change |

Writes use the "api" rate limit. A plan body is capped at 256 KiB and a settings body at 4 KiB. A SuperAdmin with no organisation chosen is refused with a sentence that says so. Dates travel as `DateOnly`, and `CreatedAt` and `UpdatedAt` as UTC instants.

## "Funding recorded" in readiness

An NDIS-funded participant has funding recorded when a plan's end is on or after today in the provider's time zone. Participants funded some other way are not asked.

It is deliberately an activation-only item. `ParticipantReadiness.IssuesAsync` is the operational list that feeds the roster, the pickers and the register, and a missing budget must not take anyone off those. So:

- `ActivationIssuesAsync` is that list plus "Funding not recorded". It supplies the notes that come back, in Warn mode, when someone activates a participant from the status control, and the onboarding checklist (`ParticipantOnboardingDto.FundingRecorded`, null when the participant is not NDIS-funded; the worklist counts six steps instead of five, and the checklist page shows a "Funding recorded" gate before Schedule review, with "Open Funding tab" for the roles that may open it). The checklist's reason says which it is: "Funding is not recorded: add the plan budget on the participant's Funding tab." when there is no plan, or "The plan budget has ended: record the new plan on the participant's Funding tab." when the plans there are have all ended (the Funding tab shows that plan as Ended). Once the agreement evidence is done, the worklist's next action and the page's recommended action name "Record plan budget", and that card ends "If the plan has not been shared yet, this can wait.", since Warn mode blocks nothing. Warn mode never blocks.
- `ActivationBlockAsync` and `MayActivateAsync` decide an activation in Enforce mode. From the status control and from completing the profile, the missing agreement evidence is refused first and then the missing budget, each with its own sentence; the full participant update just leaves the participant inactive. They take a `TimeProvider`, so tests fix the clock.
- The participant detail and list DTOs keep the operational issues only.

Today the agreement-evidence gate is closed for everyone (the provisional agreement template has no approved source), so an Enforce-mode tenant is refused on the evidence reason before the budget one is reached. The funding rule is tested through `ParticipantReadiness.Decide` and will begin to show once that gate can open.

## The screens

- **Participant hub, Funding tab** (`?tab=funding`, Admin, SuperAdmin and Coordinator): "No budget recorded" with where the figures come from and "Record plan budget"; or the current plan as facts (dates, funding periods, reassessment, source, figures confirmed, notes) and its pools, each a card that opens out to its own periods directly beneath it (one table of pools put every opened pool's periods below all of them, a screen away on a phone); "Edit" and "Record a new plan"; upcoming and past plans collapsed, read-only and titled by their dates; and one muted line, "Spending and forecasts will appear here in a later release." When the profile's own plan dates differ from the current plan's, a callout asks "Use this plan's dates on the profile?" with its button under the question, and never changes the profile unasked; once applied, and the profile shows the plan's dates, the tab says the dates now match and focus returns to Edit; that line goes when the plan's dates change again (the callout is back) or the plan is saved from the editor, so it never contradicts the callout, and it takes no room of its own while it has nothing to say. When the plan the tab leads with has ended, a callout says "This plan ended on 30 Jun 2026. Record the new plan when the participant shares it." with the one "Record a new plan" under it. A dash in a set-aside column means none is recorded, and a line says so.
- **The editor** (one slide-over, used by the tab, Intake and the Profile wizard): plan fields (a first plan opens on the plan dates the profile already holds); Core (flexible) and stated pools; periods proposed from the dates and the length, each running from the day after the one before for the length in calendar months, the last ending on the plan's last day (so it can be short), with the amount split by days (the remainder cents go on the last period) and every period still editable. Boundaries are counted from the plan's first day and a month end is clamped, so a plan starting on 31 January has a first period ending on 27 February and a third starting on 31 March, with no day lost along the way. A plan over 800 days proposes nothing and the table says why (a year typed digit by digit passes through years like 0002). A line above the periods says they were worked out from the plan dates and that any amount can be changed to match the plan's release schedule, and that amounts were edited once one was. A plain-words message says when edited periods stop adding up to the typed amount, because the save sends periods only; "Start from Billing funding sources" is offered when the hint has rows. The set-aside box and the periods agree like this: typing a set-aside spreads it over the periods in proportion to their plan amounts (shares worked out from the box keep following it as it is typed), clearing the box clears it from every period, and set-asides the person typed into a period, or that a saved plan holds, are never overwritten by the box: it leaves them, says "The set-asides add up to ..., not the ... you typed. The periods are what is saved.", and "Split again from the plan amount" applies the box (the plan amount's box behaves the same way). A set-aside typed while an amount in the periods was blank is on no period, and the editor says so ("The set-aside is not on any period yet. Split again from the plan amount to apply it.") and refuses the save until it is applied or cleared, so a typed set-aside is never silently left unsaved. A refused save is scrolled into view and takes focus; a failed check focuses the first field that has a message; adding a pool focuses its amount and removing one keeps focus in the form. Save and Cancel stay at the right whatever the footer says (the failed-check sentence has a row of its own and takes none while it is empty). A pool's messages show for the pools that were there when a save was tried, for one the person then starts on, and for all of them on the next save, so a pool added after a failed check does not open with an error under its focused field. What is scrolled to stops 0.75rem under the panel's header rule, and "Load the latest" sends focus to the first field. A pool's plan amount and set-aside sit in two columns from the small breakpoint, the set-aside labelled "Set-aside (optional)" with a hint that says it is for your organisation.
- **Intake and Profile wizard:** a "Plan budget" card on the NDIS funding step, only for NDIS funding. On a brand-new intake it says "Save as draft first, then record the plan budget on the participant's Funding tab." until the participant exists, and "Plan not shared yet" (which reads "Cancel" once something is typed) is the explicit skip. A plan that has ended is shown as Ended, and the card offers "Record a new plan" after it instead of Edit, so the old plan's history is kept. It saves through the funding routes, never through the patch groups, and draws its editor outside the wizard's form so Enter in one of its fields cannot submit the wizard.
- **Settings, Budgets** (Admin and SuperAdmin): "Warn only" or "Hard limit for one-off shifts", and "Warn when used reaches" from 50% to 95% in steps of 5 (default 80%). One line at the top, under the defaults callout when there is one, says "Budget checks arrive in a later release. Both choices on this page are saved for them." The Warn sentence says what a forecast is (what is used so far plus shifts already booked). Only a value the person changed is sent, and a pick made against a value that has since moved is dropped.
- **Settings tab strip:** `Tabs` has an `overflow="scroll"` option, so Settings' ten tabs stay on one row that scrolls sideways at every width, with the active tab (including one named by `?tab=`) scrolled into view.

## Trying it offline

`mock-api/funding.js` keeps plans in memory, so a save shows on the next read. Demo participants: `p-0002` has a 3-monthly plan (Core (flexible) and a stated Improved Daily Living Skills pool), a past 6-monthly plan, and profile dates that differ from the plan; `p-0004` has a plan with no funding periods; every other participant has none. `p-0104` (Daniel Osei) is a draft who has done every onboarding step but the plan budget, so `/onboarding/p-0104` shows the recommended "Record plan budget" card. Open `/participants/p-0002?tab=funding`, `/settings?tab=budgets` and `/onboarding/p-0103` (a sixth gate, "Funding recorded", needing attention). Routes and roles are listed in `odip-prototype/odip/local-test/endpoints.md`.

## Tests

- **Backend:** the validator, the service and controller, the roles, the SQL the queries translate to (checked against an Npgsql-configured context with no connection), and the readiness rules in both modes with the roster DTOs unchanged. The unique-index backstop is run by a test that stands in for the index (a `SaveChangesInterceptor` that fails the save the way PostgreSQL does), because InMemory enforces no index and the Postgres races are settled by the lock first. Nine Postgres tests (`FundingPostgresTests`, `SkippableFact`) skip locally and run in CI: rows made on the migration before this one survive it and the defaults hold, the unique indexes hold, the `decimal(18,2)` round trip, the cascade from plan to pools to periods (and the restrict that stops a participant with a plan being deleted), the service end to end on Npgsql, and the races: two creates for overlapping plans leave one, two creates for the same start day leave one and neither is a 500, two replaces made from the same revision apply one and refuse the other as stale, and a create, a replace, apply-dates and a delete each WAIT while another connection holds the participant's row (held before the writer starts, so a writer that forgot the lock goes straight through and fails).
- **Frontend:** the period proposal and the cents arithmetic, the editor's pure state and its screen (the sum message, the 409 flow, the Billing hint, the server's 400 reasons), the Funding tab's states, the card, the Settings tab, the hooks' exact request bodies and invalidation, and the permission.

## What phase 2 builds on

The budget service reads these four tables. A period belongs to a claim by its service date. "Available" is the set-aside (or the plan amount when none is recorded) plus the organisation's unspent amount rolled forward from earlier periods of the same plan, labelled "not confirmed". Used, Booked ahead and Forecast are computed per tenant, never stored. The muted line on the Funding tab becomes the figures, and the settings row supplies the mode and the percentage.

## Open for the owner (none blocks phase 1)

- Enforce mode refuses every activation today on the missing agreement evidence, so the budget rule shows only after that gate can open. Is that the order wanted?
- Should a plan be deletable from the screen? The route exists for Admin and SuperAdmin and is audited, but nothing offers it yet.
- The editor counts periods from the plan's first day and clamps month ends (a 31 January start: a first period ending 27 February). Is that how the NDIA releases funding for a plan that starts on the 29th, 30th or 31st? The server only requires the periods to run on without a gap.
- From phase 2 and 3: whether the shift claim engine should move to phase B pricing, whether short-notice cancellations should bill and record a notice date, the 90-day claim limit from December 2026 as a "claim clock" warning, and a participant-facing budget statement.
