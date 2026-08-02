# 01 · Income Streams

Every stream below maps onto the same core spine: **Participant → Service Agreement → Funding Source(s) → Scheduled Service → Delivery Evidence → Billable Event → Invoice or Claim → Revenue.** The differences per stream are in the scheduling shape, the evidence captured, and the billing routing.

Funding routing rule used throughout (by plan management type on the funding source):

- **Agency (NDIA) managed** → NDIS claim (via Brevity once ready; PRODA bulk payment request until then)
- **Plan managed** → Xero invoice to the plan manager
- **Self managed** → Xero invoice to the participant/nominee
- **Private / self-funded** → Xero invoice to the payer
- **B2B** → Xero invoice to the organisation (quote → PO → invoice)

> ⚠ NDIS pricing detail (current support item numbers, price limits, claiming rules for provider travel, activity-based transport, STA inclusions, short-notice cancellations) must be maintained against the current **NDIS Pricing Arrangements and Price Limits**, which changes at least annually (1 July). ODIP needs a versioned rate card, not hard-coded prices. Specific item numbers below are indicative and must be confirmed against the current PAPL and Oassist's registration groups.

---

## 1. Holidays — scheduled group trips

**Operation:** Recurring/seasonal catalogue of group trips (e.g. Tasmania, Queenscliff, Otways). Trip template → trip instance → open for bookings → traveller manifest → itinerary/activities → staffing (ratios incl. overnight type) → vehicles/accommodation → pick-up logistics (money, meds, items) → delivery → post-trip reconciliation and billing.

**Funding composition per traveller (the hard part):** one trip booking can blend:

1. **Self-funded component** — the "holiday" itself (accommodation share, activities, flights/fares, meals). NDIS does not fund the holiday; invoiced directly (deposit + balance schedule).
2. **NDIS support component** — support worker hours during the trip (day support at applicable ratio, plus Active Night / Passive Night / Sleepover), claimed against Core funding at the participant's ratio & day type (weekday/Saturday/Sunday/public holiday).
3. **Travel & transport component** — provider travel and/or activity-based transport where claimable under current rules; otherwise folded into self-funded price.
4. **STA component** — where the participant has STA funding and the trip qualifies, some/all of the stay may be claimed as STA per-night packages instead of separate support hours. STA vs hourly-support is a per-traveller decision that changes the entire billing shape.

**ODIP must:** model a per-booking **funding plan** (list of funding lines, each with source, item, quantity basis, route); generate quotes showing the family the self-funded vs NDIS split; enforce that support-hour claims reconcile against actual rostered/delivered staff hours and ratios; handle deposits, instalments, refunds/cancellation policy; produce trip claims (TripCore's TripClaim/ClaimLineItem model is the right seed) and Xero invoices from the same underlying lines.

**Evidence:** traveller profile (from master record — no re-entry), risk assessment, consents, pick-up form (money/meds/items with signatures), contingency plan, activity instructions, shift notes/progress notes during trip, incident reports.

## 2. Holidays — one-off individual/group trips

Same machinery as stream 1, but initiated from an enquiry/quote rather than a catalogue template. Requires a **quote builder**: pick participant(s), dates, destination, ratio, transport, accommodation → produces costed funding plan → on acceptance becomes a trip instance. Templates from past one-offs should be savable as reusable trip templates.

## 3. Community access (Core — social & community participation)

**Operation:** Ongoing scheduled supports under a service agreement with a schedule of supports (hours/week at given ratios/times). Recurring roster → shifts → shift notes → claims.

**ODIP must:** hold the service agreement + schedule of supports (rate, frequency, location — already fields in the data dictionary, AGR-*); generate recurring shifts; capture shift notes and goal-linked progress notes (mobile, offline-tolerant); track agreement utilisation vs plan budget; feed claims to Brevity / generate PRODA lines; alert on plan end dates, agreement expiry, utilisation over/under-spend.

## 4. Capacity building supports

Same operational shape as community access but claimed against Capacity Building categories, typically goal-driven with reportable outcomes. **ODIP must** link every delivered session to participant goals (GOAL-* fields) and support progress reporting for plan reviews.

## 5. In-home nursing (NDIS-funded only)

**Operation:** Nurse visits in the home; clinical documentation; care plans; HIDPA-related supports. Currently scheduled/documented in **Splose** — this stream is new and evolving; keep options open.

**ODIP must (near-term):** master the client, agreement, funding and billing; sync appointments/clients with Splose (or import its exports) so revenue and utilisation appear in ODIP dashboards. **Long-term option:** a clinical module in ODIP (visit scheduling, clinical notes with appropriate access controls, care plan versioning) if consolidating away from Splose ever makes sense. Decision deferred — see `07-open-questions.md`.

**Note:** clinical records need stricter access control (nurse/clinical role) and potentially different retention rules than general support records.

## 6. Training — nurse-delivered & condition-specific

**Payers: all four** — other organisations (B2B), participant NDIS funding, families privately, and internal staff (cost centre, not revenue).

**Operation:** Course catalogue (e.g. complex care/HIDPA competencies, condition-specific modules) → scheduled sessions (trainer = nurse, venue/online) → enrolments → attendance → assessment/competency outcome → certificate with expiry.

**ODIP must:** model courses, sessions, enrolments with a **payer type per enrolment** (this is the key design point — one session can mix a B2B cohort, an NDIS-funded participant carer, and internal staff); route billing per payer (quote/invoice B2B via Xero; claim NDIS where a valid line item applies; invoice families); issue certificates; and — for internal staff — write completions straight into the **staff training matrix** so compliance and revenue share one training record.

## 7. Positive Behaviour Support

**Operation:** PBS practitioner caseload; assessments; BSP authoring and review cycles; report-writing time; stakeholder training; restrictive practice involvement. Currently touched by Splose; also new/evolving.

**ODIP must:** track BSP documents and review dates against participants (COG-* fields already cover BSP provided, RIDS logged, RP registered); bill practitioner time (typically Capacity Building — Improved Relationships) including non-face-to-face report writing where claimable; link directly to the restrictive practices register and incident reporting (behaviour incidents feed BSP reviews).

## 8. Short Term Accommodation / respite (standalone)

**Operation:** Respite stays sold separately from holidays — e.g. weekend respite. Per-night STA claiming (package rates inclusive of supports), house/venue capacity, staffing rosters incl. sleepover/active night.

**ODIP must:** treat STA stays as a light-weight sibling of trips: a stay with dates, location, staffing, per-night claim lines. Same funding-plan engine; different template.

## 9. SIL — Supported Independent Living (planned)

Not yet operating. **Design placeholder only:** houses/vacancies, rosters of care (24/7 patterns), per-participant SIL funding apportionment across housemates, intensive rostering. The rostering module (ODIP-mastered) and funding-plan engine must not preclude SIL shapes: multi-participant shifts, continuous coverage, ratio changes across a day. Do not build the module until the stream is real; do keep the data model compatible.

## 10. White-label / consulting (exploring)

Selling document/process packs and consulting implementation services to other providers. **ODIP implications:** (a) a light CRM pipeline for leads/engagements + B2B invoicing via Xero; (b) the forms/templates engine should export clean, brandable document packs (the same engine that renders Oassist's own forms); (c) multi-tenancy stays in the architecture so a future "run your business on our platform" offer remains possible without a rebuild. No dedicated module in early phases.

---

## Revenue management across all streams

A single **Revenue dashboard** must answer, per stream and in total: pipeline (quoted/booked not yet delivered), delivered-not-yet-billed, billed-not-yet-paid (split claims vs invoices), paid, and utilisation against participant agreements. This is only possible because every stream flows through the same BillableEvent → Invoice/Claim spine. Xero payment status and claim remittance outcomes sync back to close the loop.
