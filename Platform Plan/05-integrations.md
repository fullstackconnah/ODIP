# 05 · Integrations

Order of build: **Brevity → Xero → PRODA export → Employment Hero → Splose → SharePoint/M365 → Linxio → Budgetly.** All via the outbox/connector pattern (`02-architecture.md` §7) with per-system id mapping tables and a sync-status dashboard.

## 1. Brevity (first)

**Goal:** ODIP masters participants, services and delivered hours; Brevity receives what it needs to run NDIS claiming correctly.

- **Verify first (Phase 0):** what API access Brevity offers on Oassist's plan. The 2026-08 review of all internal Brevity documentation — including meeting notes with Brevity's own rep — found **no mention of an API**; only the built-in Brevity→Xero contact/invoice sync, the NDIS claim-file export, and manual Service Schedule exports. Design the connector **file/export-first**, upgrade to API if Brevity confirms one. This also reframes Brevity's long-term role: if ODIP masters rostering and can generate compliant claim files itself (it must anyway for the PRODA interim), Brevity's remaining unique value is mainly the staff mobile app and claim submission convenience — revisit the keep/feed decision after Phase 4 with real usage data.
- Sync scope (target): participants + plans + contacts → Brevity clients; service agreements/schedules → Brevity services; ODIP delivered shifts/trip support hours → Brevity for claim generation; claim outcomes back to ODIP revenue dashboard.
- Interim reality: until Brevity is "set up correctly", ODIP's own claim batches (PRODA CSV) and Xero invoices carry the load — the Brevity connector must be able to start with participant/contact sync only and grow.
- Decide a **cutover line** per function (e.g. claiming moves to Brevity on date X; ODIP stops generating PRODA files) to avoid double-claiming. One system claims at a time.

## 2. Xero

- Official API, OAuth2. Contacts (participants' payers, plan managers, B2B orgs) mapped to ODIP entities; invoices raised from ODIP invoice records with line-level detail; payment status webhooks/polling back into ODIP.
- Branding themes/templates per revenue type (trips deposits vs training B2B).
- Accounting mapping table: ODIP stream/support item → Xero account code + tracking category (stream-level P&L in Xero for the accountant, detail stays in ODIP).

## 3. PRODA / NDIA bulk payment requests (interim claiming)

- No API — generate the **bulk payment request CSV** in the NDIA-specified format from ODIP claim batches for agency-managed funding; record submission + remittance results against claim lines (TripCore's TripClaimStatus/ClaimLineItemStatus model already anticipates this).
- Keep the format spec versioned; NDIA changes it occasionally. Sunset this connector once Brevity claiming is live.

## 4. Employment Hero

- Push approved timesheets (from ODIP rosters/actuals) via Employment Hero API; staff records mapped by EH id. Award interpretation/payroll stays entirely in EH.
- **Verify (Phase 0):** which EH product tier/API (Employment Hero HR vs Payroll, API scopes) Oassist has, and whether timesheet import is API or CSV on that tier.

## 5. Splose (nursing + PBS, evolving)

- Splose has a public API. Near-term: one-way sync of participants ODIP→Splose (no re-keying) + pull appointments/completed sessions Splose→ODIP so nursing/PBS revenue and utilisation appear in ODIP; billing for these streams runs from ODIP (or stays in Splose short-term — **decide during Phase 0**, one system must own each stream's billing).
- Long-term consolidation decision deferred (`07-open-questions.md`).

## 6. SharePoint / Microsoft 365

- Graph API. Two roles: (a) archival/export — signed agreements and generated PDFs mirrored to SharePoint records library to respect existing records-management practice; (b) read-side — Practice Manual/policy links surfaced contextually inside ODIP screens.
- ODIP's own object storage remains the operational document home; SharePoint is the corporate records mirror. (Confirm with the business owner — could be reversed if SharePoint must stay primary.)

## 7. Linxio (fleet GPS)

- Pull vehicle positions/trip logs for vehicles on active trips: live "where is the bus" view for coordinators, and odometer/usage data against VehicleAssignments. Low priority, high delight.

## 8. Budgetly (expense cards)

- Import expense transactions (API/export) tagged to trips/participants → trip P&L actuals and money-handling reconciliation (links to pick-up form personal money records where relevant).

## 9. "Tour-booking system" (decommission)

- Resolved: it is **BOOKING FORM.xlsx** on SharePoint (one sheet per FY), not software. Migration is a scripted workbook import (trips, bookings, client rows, finance columns) plus preservation of the trip-code conventions; then the workbook is frozen read-only. Companion spreadsheets to absorb at the same time are listed in `09-process-findings.md` §7.

## Cross-cutting rules

- Every connector: idempotent upserts, retry with backoff, dead-letter queue surfaced on the admin dashboard, per-record sync status visible from the entity screen ("this participant last synced to Brevity at…").
- Credentials per connector stored encrypted, tenant-scoped, rotatable.
- Any system that also holds participant data needs a Confidentiality & Data Handling Agreement record (CDA-* fields exist in the dictionary — eat your own dog food: track these vendor agreements in ODIP's registers).
