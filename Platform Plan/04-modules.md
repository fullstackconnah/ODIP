# 04 · Module Specifications

Concise functional specs. Each module lists: purpose, key screens/workflows, and its billing/compliance hooks. Validate all workflows against Z:\Policies and Processes + Practice Manual during Phase 0.

## M1 · Participants (master record)

- 360° participant view: header with photo, alerts banner, NDIS/plan status, key contacts; tabbed dictionary domains.
- Intake workflow: enquiry → prospective → active (with checklist: agreements signed, rights/privacy/advocacy info provided (CUL-* booleans), risk assessment done).
- Versioned risk assessments, goals with review triggers, consent management.
- Every other module deep-links here; participant search is the app's spine.
- **Hooks:** plan end-date alerts; missing-document alerts; induction summary generation for staff.

## M2 · Staff & compliance matrix

- Staff profile, credentials with expiries (worker screening, police check, first aid, HIDPA competencies, AHPRA), training records.
- Compliance matrix screen: staff × required credentials by role, RAG status, expiry horizon (generalises TripCore's qualification-expiry dashboard).
- **Hooks:** rostering blocks/warns on assigning non-compliant staff (e.g. no worker screening, missing competency for a participant's needs — e.g. PEG, epilepsy).

## M3 · Agreements & funding

- Service agreement builder from templates (BSP Service Agreement fields AGR-* as seed), schedule of supports lines, e-signature capture, versioning on plan changes.
- Funding sources per participant with budgets; utilisation tracking (scheduled vs delivered vs billed vs budget).
- **Hooks:** agreement expiry & utilisation alerts; billing engine refuses billable events without a valid funding route (with override + reason).

## M4 · Scheduling & rostering (ODIP-mastered)

- Recurring shift patterns per agreement; roster board (week view by staff / by participant); conflict, availability, compliance and ratio checks; open-shift offering.
- Trip staffing: assign staff to trip days with day/ratio/night-type; the trip roster and the general roster are one dataset (no double-booking between a trip and a community shift).
- Timesheets: derived from completed shifts, approval workflow → Employment Hero; delivered hours → billing engine.
- Mobile view for staff: my shifts, shift detail (participant summary + alerts + activity instructions), clock/complete, notes.

## M5 · Trips & STA

- All of TripCore's proven scope (templates, instances, bookings, itinerary builder, accommodation, vehicles, booking tasks, documents, claims) rebuilt on the new spine, plus:
- **Quote builder** for one-off trips (funding plan → PDF quote → acceptance → instance).
- **Holiday activity instructions** library: per-activity instruction sheets (requirements, accessibility, timing, cost, provider contacts) attached to itinerary items and included in trip packs & staff briefings.
- Pick-up/drop-off workflow with medication transfer and money/item inventories, dual signatures (PU-*).
- Contingency planning per trip (CONT-* scenarios) and traveller-specific contingencies.
- Trip P&L: planned vs actual costs (Budgetly expense import) vs revenue (claims + invoices).
- STA stays as lightweight trip-siblings with per-night claiming.

## M6 · Service delivery & notes

- Shift notes / progress notes (templates per stream), goal-linked entries, incident quick-capture from a note.
- Offline-tolerant mobile entry; photo attachments (consent-gated).
- Coordinator review queues; note completeness chasing.
- **Hooks:** notes are the delivery evidence that lets a shift generate billable events.

## M7 · Clinical (thin at first)

- Nursing: visit schedule (Splose-synced), care plan register, clinical alerts to the participant header. PBS: BSP register with review dates, RP links, practitioner time capture for billing.
- Full clinical documentation stays in Splose until a deliberate later decision.
- **Hooks:** clinical role access control; HIDPA training-required flags (MED-*) drive M2 competency requirements.

## M8 · Training

- Course catalogue, session scheduling, mixed-payer enrolments, attendance, competency outcomes, certificates (numbered, expiring, PDF).
- B2B pipeline-lite: organisation accounts, quotes, session bookings.
- **Hooks:** internal completions → M2 matrix; enrolment payer type → billing route; certificate expiry → re-enrolment prospecting (a small revenue loop).

## M9 · Compliance suite

- **Incidents:** capture (staff mobile), triage, severity, NDIS-reportable determination with 24h/5-day countdown timers, investigation, actions/CAPA, trends dashboard.
- **Complaints & feedback:** register with workflow, outcomes, links to improvements; feedback form intake.
- **Restrictive practices:** register of authorisations, usage reports fed from incidents, monthly reporting export, BSP linkage.
- **Audit evidence:** registers + document index designed around NDIS Practice Standards audit needs (map precisely once Z:\ docs reviewed).

## M10 · Billing engine & revenue

- Generation runs: period-end (or trip-end) creation of billable events from delivered episodes; validation against agreements/rate card; exception queue.
- Claim batches: → Brevity (primary path once ready) or PRODA bulk payment request CSV (interim); remittance reconciliation.
- Invoices: → Xero (plan managers, self/private, B2B) with payment status sync-back.
- Revenue dashboard per stream: quoted → booked → delivered → billed → paid; agreement utilisation; trip P&L; aging.

## M11 · Documents & forms engine

- As specced in `02-architecture.md` §6: field registry, form templates (the 11 mapped forms as seed), instances pre-filled from master data, PDF rendering, signature capture, document library with types/expiry (TripCore DocumentType seed).
- Export path for white-label document packs (unbranded templates).

## M12 · Dashboards & alerts

- Role home screens: Admin (exceptions, expiries, revenue), Coordinator (rosters, notes review, tasks), Field (my shifts/trips), Nurse (visits, clinical alerts), Owner (revenue/compliance overview).
- Central alert framework: plan expiries, credential expiries, agreement utilisation, unbilled delivery, overdue incidents/complaints, integration failures — each with owner and snooze/ack.
