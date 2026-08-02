# 02 · Architecture

## 1. Shape: modular monolith, fresh build

A single deployable backend with strictly separated internal modules. At 50–150 participants / 25–75 staff / 10–30 trips a year, microservices would add operational cost with no benefit. Module boundaries are enforced in code (separate projects/namespaces, no cross-module entity references — communicate via interfaces/domain events) so a module could be extracted later if white-label SaaS ever demands it.

## 2. Stack (carried from TripCore, upgraded where sensible)

| Layer | Choice | Rationale |
|---|---|---|
| Backend | **.NET (current LTS), clean architecture** (Domain / Application / Infrastructure / Api) | Proven in TripCore; John maintains it; strong typing suits a compliance-heavy domain |
| Database | **PostgreSQL 16+** | Proven in TripCore; row-level tenant filtering; JSONB for form-instance payloads |
| Frontend | **React + TypeScript + Vite + Tailwind + TanStack Query**, react-hook-form + zod | Direct reuse of TripCore component library, DataTable, dropdown, strongly-typed API layer work |
| Auth | **Firebase Auth** (as migrated in TripCore) with server-side role/tenant claims | Already proven; swappable later if needed |
| API style | REST + OpenAPI-generated typed client | Continues TripCore's strongly-typed frontend API layer |
| Documents/files | S3-compatible or Azure Blob storage, **Australian region**, server-side encryption; DB stores metadata only | Participant docs, signatures, certificates, generated PDFs |
| PDF generation | Server-side (QuestPDF or similar) for forms, trip packs, invoices, certificates | @react-pdf/renderer exists in TripCore but server-side rendering centralises templates for the document-pack/white-label story |
| Background jobs | Hangfire (or .NET hosted services + queue table) | Integration syncs, claim generation, expiry alert scans, report schedules |
| Deploy | Docker Compose on an AU-region VPS/cloud VM initially (mirrors TripCore); path to managed containers later | Matches existing ops skills; cheap; upgradeable |
| Observability | Structured logging (Serilog) + error tracking (e.g. Sentry) + uptime checks | A single-maintainer platform needs loud failures |

## 3. Module map

```
┌─────────────────────────────────────────────────────────────┐
│ ODIP                                                        │
│                                                             │
│  Core                                                       │
│  ├─ Identity & Access (users, roles, tenancy)               │
│  ├─ Participants (master record ← Data Dictionary)          │
│  ├─ Staff & HR-lite (people, credentials, training matrix)  │
│  ├─ Reference Data (picklists, rate cards, support catalog) │
│  ├─ Documents & Forms Engine (templates → instances → PDF)  │
│  └─ Audit & Alerts                                          │
│                                                             │
│  Operations                                                 │
│  ├─ Agreements & Funding (service agreements, funding plans)│
│  ├─ Scheduling & Rostering (shifts, availability, trips'    │
│  │   staffing; pushes to Brevity + Employment Hero)         │
│  ├─ Trips & STA (templates, instances, bookings, itinerary, │
│  │   vehicles, accommodation, pick-up, contingency)         │
│  ├─ Service Delivery (shift/progress notes, goal tracking)  │
│  ├─ Clinical (nursing/PBS — thin at first, Splose-synced)   │
│  └─ Training (courses, sessions, enrolments, certificates)  │
│                                                             │
│  Money                                                      │
│  ├─ Billing Engine (billable events → invoices/claims)      │
│  └─ Revenue Reporting                                       │
│                                                             │
│  Compliance                                                 │
│  ├─ Incidents & Reportables                                 │
│  ├─ Complaints & Feedback                                   │
│  ├─ Restrictive Practices Register                          │
│  └─ Registers & Audit Evidence                              │
│                                                             │
│  Integration Hub (outbox → connectors: Brevity, Xero,       │
│   Employment Hero, PRODA export, Splose, Linxio, Budgetly,  │
│   SharePoint/Graph)                                         │
└─────────────────────────────────────────────────────────────┘
```

## 4. Multi-tenancy

Keep TripCore's model: `Tenant` + `ITenantEntity` + global query filters + `SuperAdmin` bypass. Oassist is tenant #1. This costs little now and preserves the white-label option. All storage paths, document containers and integration credentials are tenant-scoped.

## 5. Security & compliance posture

- **RBAC roles** (from TripCore, extended): SuperAdmin, Admin, Coordinator, SupportWorker, **Nurse/Clinical**, **Finance**, ReadOnly. Field-level sensitivity tiers: clinical notes and restrictive-practice data visible only to clinical/authorised roles; credentials vaulted (the Portal Logins register from the data dictionary must become vault references, never plaintext — as its own legend already demands).
- **Audit trail** on all entities (TripCore pattern), plus read-access logging for clinical records.
- **Australian data residency** for DB, files, backups. Firebase Auth stores identifiers only.
- **Backups:** nightly encrypted DB + document store backups, tested restores, 7-year retention alignment for participant records (confirm exact retention against policies in Phase 0).
- **Consent-aware documents:** photo/video consent, alcohol consent etc. (CNST-*) are structured data that gate downstream behaviour (e.g. trip photo galleries).
- **Offline-tolerant mobile web** for field staff (shift notes on trips with poor coverage): local draft persistence and sync-on-reconnect for the notes/forms surfaces at minimum.

## 6. The Forms Engine (the data dictionary made executable)

The Master Data Dictionary's core insight — fields defined once, forms as *views* over fields — becomes an engine:

1. **Field registry:** every field from the dictionary (ID, domain, type, picklist, sensitivity tier) seeded as data.
2. **Form templates:** ordered compositions of field references + static text + signature blocks (the Form-to-Field Map sheet is the seed data).
3. **Form instances:** issued against a participant/staff/trip; values read from and write back to the master record — a Traveller Profile is pre-filled from the participant record, and edits update the master record (with review/approve where appropriate).
4. **Rendered outputs:** print/PDF versions matching current documents; staff induction summaries; trip packs.

This engine is what makes "bring all our spreadsheets and Word forms into one platform" real, and it is also the exportable asset behind white-label document packs.

## 7. Integration hub pattern

All outbound sync goes through a transactional **outbox**: domain events (ParticipantUpdated, ShiftCompleted, InvoiceCreated…) written in the same transaction as the change, then connectors consume and push with retry, per-connector mapping tables (ODIP id ↔ external id), dead-letter visibility, and a sync-status dashboard. Inbound (Xero payment status, claim remittances) via webhooks where available, else scheduled pulls. Never let an integration failure block an operational workflow — queue and alert instead.
