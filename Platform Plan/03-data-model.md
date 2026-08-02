# 03 · Data Model

The model = **Master Data Dictionary** (participant record, ~280 fields, 25 domains) ∪ **TripCore entities** (trip operations + claims) ∪ **new spine entities** (agreements, funding, billing, rostering, training, compliance). Below are the load-bearing entities; field-level detail for the participant record defers to the dictionary itself.

## 1. Core spine (new — this is the heart of ODIP)

```
Participant ──< ServiceAgreement ──< ScheduleOfSupportsLine
     │                │
     │                └──< FundingSource (NDIS plan bucket | private | B2B org)
     │                        · planManagementType (Agency/PlanManaged/SelfManaged/Private/B2B)
     │                        · budget, start/end, plan number, payer contact
     │
     ├──< ServiceEpisode (a delivered unit: shift, trip-day support, nursing visit,
     │        training enrolment session, PBS session, STA night)
     │        · evidence links (notes, forms, signatures)
     │
     └──< BillableEvent  (generated from ServiceEpisodes + trip funding plans)
              · supportItemCode (versioned RateCard lookup)
              · qty basis (hours | nights | each | km), dayType, ratio share
              · route: CLAIM (Brevity/PRODA) | INVOICE (Xero) — resolved from FundingSource
              ├──> ClaimLine → Claim (batch) → remittance status
              └──> InvoiceLine → Invoice → Xero id → payment status
```

**RateCard / SupportCatalogueItem** (extends TripCore's SupportCatalogue): support item code, description, registration group, unit, price limits by day type & geography, GST code, **validity period** — imported per NDIS Pricing Arrangements release; historical versions retained so past claims re-validate.

**FundingPlan (trips/STA):** per-booking set of planned funding lines (self-funded / support hours / transport / STA nights) that quotes are issued from and BillableEvents reconcile against.

## 2. Participant master record

As per dictionary domains: Identity, Contact, NOK & decision makers, NDIS/plan/funding, cards, physical, cultural/rights, health & medical, mobility & personal care, cognitive & behavioural, communication, routine, meals, community/domestic ADL, goals, consents, risk. Implementation notes:

- Stable spine columns for queryable/critical fields (names, DOB, NDIS number, plan dates, alerts); **form-driven fields stored via the field registry** (EAV/JSONB) so the dictionary can evolve without migrations. Anything used in claiming, rostering rules, or alerts must be spine, not EAV.
- **Alerts** (client-specific alerts & information — explicitly requested): typed alert records (medical, behavioural, dietary, logistics) with severity, surfaced on every screen header for that participant and in trip manifests / induction summaries.
- **Risk assessments**: versioned instances (RISK-*) with domain scores, ratings, control strategies (action/status/due/responsible), review cycle.
- **Goals**: goal records with review status/trigger/date (GOAL-*), linked from progress notes and capacity-building sessions.
- Contacts normalised (TripCore `Contact`/`ParticipantContact` with ContactType covers NOK/guardian/plan manager/support coordinator — the dictionary's NOK-* and NDIS-* contact fields map onto it).

## 3. Trips & STA (from TripCore, extended)

Keep: TripTemplate/EventTemplate, TripInstance, TripDay, ScheduledActivity, ParticipantBooking, AccommodationProperty/Reservation, Vehicle/VehicleAssignment, BookingTask (task types incl. GenerateNdisClaims), TripDocument, TripClaim/ClaimLineItem, PublicHoliday sync.

Extend: **FundingPlan per booking** (§1); **holiday activity instructions** (per-activity instruction packs for trip planning — requested feature); pick-up & medication transfer records (PU-* fields: money/items inventory, Webster/PRN transfer, dual signatures); contingency plans (CONT-*); luggage/insurance fields (TRV-*); **STAStay** as a sibling of TripInstance for standalone respite.

## 4. Staff, HR-lite & rostering (new; TripCore has the seed)

- **StaffMember** (extends TripCore Staff): role, employment type, Employment Hero id, Brevity id.
- **Credential**: worker screening, police check, first aid, driver licence, HIDPA/complex-care competencies, nursing registration (AHPRA) — with expiry, evidence document, and alert thresholds (TripCore's qualification-expiry dashboard generalises to this).
- **TrainingRecord**: links to Training module completions (internal enrolments write here).
- **Availability** (TripCore StaffAvailability) + **Shift**: recurring shift patterns for community access/nursing; trip staffing assignments; sleepover/active-night types; **Roster** = published set of shifts for a period. Timesheet derivation: actual vs rostered, approval, then push to Employment Hero; delivered hours also drive claim generation.

## 5. Training module

Course → CourseSession (trainer, venue, capacity) → Enrolment (attendee = external person | participant | staff member; **payerType** = B2B | NDIS | Private | Internal; per-enrolment price/funding source) → AttendanceRecord → CompetencyOutcome → Certificate (number, issue/expiry, PDF). B2B side: Organisation, Quote, PO reference.

## 6. Compliance

- **Incident** (TripCore's is strong: types incl. RestrictivePracticeUse/Abuse/MissingPerson, severity, QscReportingStatus): extend with 24h/5-day reportable deadline tracking, investigation actions, CAPA links, connection to participant + shift/trip context.
- **Complaint**: source, subject, severity, workflow states, outcome, continuous-improvement action links.
- **RestrictivePracticeRecord**: RP type (dictionary picklist), authorisation status/dates, BSP link, usage reports (from incidents), monthly reporting export.
- **RegisterEvidence**: generic register rows (audits, maintenance, insurance) — populated as policies from Z:\ are reviewed.

## 7. Reference data

Picklists sheet → seeded controlled vocabularies (assistance levels I/S/A/F, risk ratings, plan management types, ratios, shift periods, severity scales, RP types, diversity identifiers, etc.), all tenant-scoped with system defaults.

## 8. Migration seeds

1. Master Data Dictionary → field registry + picklists + form templates (scripted import of the workbook).
2. TripCore production data (if any live usage) → trips module.
3. Current spreadsheets inventory (**Phase 0 task — list still needed**) → participant spine + registers.
4. Tour-booking system export → historical trips/bookings.
5. Brevity/Xero contact reconciliation → external id mapping tables.
