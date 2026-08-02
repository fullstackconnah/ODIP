# 08 · TripCore Fork Plan

**Decision (2026-08-02, supersedes "fresh build" in earlier drafts):** ODIP is built by **forking TripCore** and evolving/overhauling it, not by starting a new codebase. TripCore's architecture is sound and much of its trip domain survives; the fork saves months of foundation work. This doc maps what is kept, what is overhauled, and what is net-new.

## 1. Fork mechanics

- Fork `fullstackconnah/TripCore` → new repo (e.g. `odip`). Rename solution/namespaces `TripCore.*` → `Odip.*` in one mechanical commit before any functional change.
- Keep the deployment shape (Docker Compose: Postgres 16 + API + frontend + nginx) and CI images; new environments and credentials — do not share the TripCore database or Firebase project.
- Adopt module boundaries inside the existing clean-architecture projects: `Odip.Domain/<Module>/...` folders with no cross-module entity references (interfaces/domain events only), so future extraction stays possible.
- Continue the `docs/superpowers/{plans,specs}` design-doc discipline — it is the project's institutional memory.

## 2. Keep as-is (proven, minimal touch)

| Asset | Notes |
|---|---|
| Clean architecture solution layout | Domain/Application/Infrastructure/Api |
| Multi-tenancy (`Tenant`, `ITenantEntity`, global query filters, SuperAdmin) | Oassist = tenant 1; white-label door stays open |
| Audit trail (`AuditLog`, AuditAction) | Extend to read-access logging for clinical/RP data later |
| Firebase auth + role claims | Roles list grows (Nurse/Clinical, Finance) |
| Component library, DataTable, dropdown, typed API layer (frontend) | Direct reuse across all new modules |
| Public holidays sync | Feeds both claiming day-types and rostering |
| Trips domain: TripTemplate/TripInstance/TripDay/ScheduledActivity, AccommodationProperty/Reservation, Vehicle/VehicleAssignment, ParticipantBooking, TripDocument | Core survives; extended per §3 |
| Enums (TripStatus, BookingStatus, ClaimDayType, GSTCode P1/P2/P5, SleepoverType, IncidentType, QscReportingStatus…) | Already match NDIS reality closely |

## 3. Overhaul (exists, but must change substantially)

1. **Participant → master record.** Today a trips-oriented profile. Becomes the full Data Dictionary record: spine columns for critical/queryable fields + field-registry (JSONB) for form-driven domains, alerts, versioned risk assessments (mirroring the General Participant Risk Assessment workbook: unmanaged/managed levels, triggers, prevention, linked plans, review dates), goals, consents. Contacts model already fits (ContactType covers plan manager/support coordinator/guardian).
2. **BookingTask → workflow/task engine.** TaskType enum is trip-specific. Generalise to task templates instantiated against any entity (trip, participant, incident, agreement, staff): the Pre-Trip "Checklist of Checklists" (19 items), trip-folder preparation, post-trip filing/scanning/archive steps, onboarding gates, and the **deadline engine** (see 09 §6) all become template-driven tasks with owners, due dates and escalation.
3. **TripClaim/ClaimLineItem → general billing engine.** Decouple claim generation from trips: `BillableEvent` produced by any stream (trip funding plans, completed shifts, STA nights, training enrolments), routed to Claim (PRODA CSV per the official 16-column bulk spec — RegistrationNumber…ABNofSupportProvider, date format YYYY-MM-DD, Hours HHH:MM, Quantity XOR Hours) or Invoice (Xero API). Add **service-booking balance tracking** (the #1 documented rejection cause is claiming above remaining booking balance) and duplicate-claim detection. Keep the existing status models — they already anticipate remittance reconciliation.
4. **SupportCatalogueItem → versioned RateCard.** Add validity periods, price limits by day type, annual PAPL import (replaces the manual Xero Products & Services maintenance with its 50-char truncations), and the trip **pricing configurator**: formalise the hand-rolled quote-code grammar (region × days × ratio × night-type, e.g. VIC51SN / INT61AN) as structured pricing rules that generate quotes.
5. **Staff/StaffAvailability → rostering module.** Add recurring shifts (community access), the staff↔client **compatibility matrix** (Rosters.xlsx "CP clients – staff" tab becomes data), compliance gates (WSC expiry, competency vs participant needs), open-shift offering, timesheet derivation → Employment Hero. Trip staffing and ordinary shifts become one dataset — this kills the Excel/Brevity dual-rostering and the Mon/Fri manual cross-check.
6. **ServiceAgreement — new entity replacing "Xero quote as SA".** Today the SA *is* a Xero quote printed with a branding theme then hand-edited in Adobe (signature image, NDIS#, dates). ODIP generates the SA document from the master record + funding plan, tracks lifecycle (draft → sent → signed-returned [hard gate before service start] → varied → ended, with 14-day withdrawal and 1-month termination notice tracking), and preserves the reference grammar as a generated code, not a hand-typed convention.
7. **IncidentReport → full compliance workflow.** Add the documented state machine (identify → record → manager review → verify reportable → 24hr immediate form / 5-day form / 60-day final report → investigate → resolve → review → close), Notifier/Approver maker-checker roles, countdown timers from key-personnel-awareness, incidents register view, and **RPUsageEvent** records feeding monthly/NIL/fortnightly Commission reporting and Vic RIDS (APO authorisation, practice linked to outlet + BSP).
8. **Trip identifiers & archive conventions.** Preserve `YYMMDD + trip code + days` (e.g. 241021WWR5) as the human trip key and the document-archive naming; it is embedded in years of SharePoint history.

## 4. Net-new modules (greenfield inside the fork)

- **Agreements & Funding** (funding sources, plan budgets, utilisation, funding plans per trip booking) — see 03 §1.
- **Forms engine** (field registry → templates → pre-filled instances → PDF) seeded from the Master Data Dictionary; replaces the print/scan round-trip progressively.
- **Service delivery notes** (mobile, offline-tolerant) for shifts/trips; evidence backing billable events.
- **Compliance suite** beyond incidents: complaints register (open/closed, SLA config, annual info re-issue tracking), policy/register review scheduler (replaces the Due Date and SCHEDULE spreadsheets with their corrupt dates), delegations, risk-assessed roles + WSC expiry alerts.
- **Training module**, **Clinical thin-slice**, **Revenue dashboard** — per 04.
- **Integration hub** (outbox + connectors) — per 05, revised: Brevity connector is file/export-based until an API is confirmed (none is evidenced in any internal doc, including the Brevity meeting notes).

## 5. Suggested overhaul sequence inside the fork

1. Rename + module re-foldering + new environments (mechanical).
2. Participant master record + field registry + Data Dictionary import (unblocks everything).
3. Task engine generalisation (unblocks trip checklists, onboarding, deadlines).
4. RateCard + pricing configurator + quote/SA generation (kills the most error-prone manual work).
5. Billing engine generalisation + PRODA CSV writer + booking-balance tracking.
6. Rostering + timesheets.
7. Compliance state machines.
(Full sequencing with integrations remains in 06 — this list is the dependency order for refactors specifically.)

## 6. Fork risks

- **Prototype shortcuts hardening into production.** Audit TripCore for trip-era assumptions (entity nullability, tenant seeding, test coverage) before building on top; add tests around anything being overhauled first.
- **Schema migrations from prototype data.** If TripCore holds real data, write migrations rather than resetting; if not, collapse to a clean initial migration at fork time.
- **Scope gravity in the overhaul list** — each §3 item should land as its own design doc in `docs/superpowers/` before code, matching existing practice.
