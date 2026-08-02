# ODIP — Oassist Data Interface Platform

## Platform Plan · Overview

**Version:** 0.1 (planning draft) · **Date:** 2026-08-02 · **Author:** Prepared with John (contractor/developer) for Oassist (WOW TOURS Pty Ltd t/as Oassist, NDIS registered provider)

---

## 1. Vision

ODIP is the single source of truth for Oassist's operations. Every client, staff member, trip, shift, form, agreement, and dollar of revenue is mastered in one place, and ODIP pushes that data outward to the satellite systems that remain in use (Brevity, Xero, Employment Hero, etc.). Data is entered **once**, validated against controlled vocabularies, and reused everywhere.

The business is a shifting one: new income streams appear (SIL is planned, white-labeling is being explored, nursing/PBS via Splose is being fleshed out). The platform must therefore treat **income streams as configuration, not code** wherever possible — a common core of participants, agreements, funding, scheduling, and billing, with stream-specific modules layered on top.

## 2. What exists today

| Asset | Status |
|---|---|
| **ODIP Master Data Dictionary.xlsx** | ~280 fields across 25 domains, mapped to 11 paper/docx forms, with controlled picklists. This is the seed of the participant data model. |
| **TripCore prototype** (github.com/fullstackconnah/TripCore) | Working .NET + React + PostgreSQL app: multi-tenancy, trip lifecycle, participant bookings, itineraries, accommodation, vehicles, staff availability/assignment, NDIS trip claims (line items, day types, GST codes), incidents with QSC reporting status, tasks dashboard, audit log, support catalogue, Firebase auth, Docker deploy. |
| **Satellite systems** | Xero (accounting — and today also the de-facto quote/SA system via branding themes), Brevity (NDIS care mgmt — claiming not yet correctly set up; no API evidenced), M365/SharePoint (documents), "tour-booking system" = **BOOKING FORM.xlsx** (replaced by ODIP), Splose (nursing + PBS clinical), Employment Hero (HR/payroll), PRODA (NDIA portal), Linxio (fleet GPS), Budgetly (expense cards). |
| **Process documentation** | Z:\Policies and Processes, Z:\Practice Manual — **reviewed 2026-08-02** (63 documents). Findings, extracted workflow rules, and the migration inventory are in `09-process-findings.md`. |

## 3. Decisions already made

1. **Custom web application** — not low-code, not Power Platform.
2. **Fork TripCore and evolve it** (decision revised 2026-08-02; supersedes the earlier "fresh build" answer) — the TripCore codebase is forked as ODIP's foundation and overhauled where the wider scope demands it. See `08-tripcore-fork-plan.md` for the keep / overhaul / add breakdown.
3. **ODIP is master; Brevity stays and is fed by ODIP** — Brevity handles NDIS claiming once set up correctly. Until then, ODIP generates PRODA bulk payment requests and Xero invoices directly. **Brevity sync is the first integration.**
4. **ODIP replaces the tour-booking system** entirely.
5. **ODIP masters rostering** — shifts and trip staffing built in ODIP, pushed to Brevity (claiming) and Employment Hero (payroll).
6. **Compliance lives in ODIP**: incident management + NDIS reportables, complaints/feedback register, restrictive practices register, staff compliance & training matrix, client-specific alerts, holiday activity instructions for trip planning.
7. Users: office/admin, field support workers (mobile), nurses/clinical. No participant/family portal in scope initially (keep the door open).
8. Scale target: 50–150 participants, 25–75 staff, 10–30 trips/year — a modular monolith comfortably serves this; no microservices.
9. White-labeling = document/process packs + consulting for now. Not SaaS-for-other-providers yet, but multi-tenancy is retained from day one so that option is never closed off.

## 4. Guiding principles

- **Single entry, many uses.** A field defined in the Master Data Dictionary is stored once and rendered into every form, document, induction summary and export that needs it.
- **Funding-aware everywhere.** Every billable event knows its funding source (NDIS bucket + plan management type, private, B2B) from the moment it is scheduled, so billing is a by-product of operations, not a separate chore.
- **Push, don't re-key.** Satellite systems receive data via integrations (API where available, structured export where not). Staff never type the same client into two systems.
- **Auditable by default.** Every create/update/delete is logged (who, when, what changed) — this is both an NDIS Practice Standards expectation and the foundation of trust in a single source of truth.
- **Configuration over code for streams.** New income streams should mostly mean: new service catalogue entries, new agreement templates, new form templates, new rate cards — not new modules.
- **Australian data residency** for all participant data (NDIS/privacy expectations).

## 5. Document map

| Doc | Contents |
|---|---|
| `01-income-streams.md` | Every income stream: how it operates, how it is funded/billed, what ODIP must do for it |
| `02-architecture.md` | Tech stack, module layout, tenancy, security, hosting |
| `03-data-model.md` | Core domain model, extending the Master Data Dictionary + TripCore entities |
| `04-modules.md` | Functional spec per module |
| `05-integrations.md` | Per-system integration approach and sequencing |
| `06-roadmap.md` | Phased delivery plan |
| `07-open-questions.md` | Unresolved items requiring answers before/while building |
| `08-tripcore-fork-plan.md` | Fork strategy: what TripCore code is kept, overhauled, or added |
| `09-process-findings.md` | What the Practice Manual / Policies review revealed; rules the platform must encode |
| `10-productisation.md` | Path from internal platform to multi-provider SaaS (phased wedge, dogfood gate, hardening workstreams) |
