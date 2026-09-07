# ODIP — Stakeholder Panel Recommendations (2026-09-06)

Companion to `2026-09-06-odip-ux-audit-and-feature-suggestions.md`. Eight stakeholder personas — office/trip coordinator, field support worker, finance & claims officer, provider owner/operations manager, clinical/behaviour support practitioner, NDIS Quality and Safeguards Commission auditor, participant/family member, and system administrator — each independently role-played a full read of the ODIP codebase and raised findings from their own vantage point: **61 raw findings**. Two were dropped as restating the audit's F-2 and F-4 findings (their marginal evidence was folded into those findings' scope instead), leaving **39 merged**. Every surviving finding was then independently re-verified against the current code; one was killed outright as already built — **S-17**, a consolidated trip-pack/family-itinerary PDF, turned out to already exist (`ItineraryTab.tsx`'s "Export Trip Package" already generates the itinerary + roster + participant-notes bundle it proposed) — leaving **38 ranked recommendations**. Verification also found 3 more items already partly built and narrowed their proposals in place before ranking (flagged **Already partly built** in Part 4).

**Scoring rubric.** Each item gets four 0–5 scores — compliance/safety exposure, revenue impact, frequency × users affected, and effort (inverted, so 5 = cheapest) — summed to a 0–20 total. Ties are broken toward compliance/safety, and an item can rank above its raw total when it gates other work, or below it when it is convenience-only (each case is called out in its rationale). Dependencies between items — and onto the audit's own F-numbered features — are respected in the suggested-stage sequencing in Part 5.

---

## 0. Completion status of the audit roadmap (as at 2026-09-06, PR #105 merged)

| ID | Item | Status | Note |
|---|---|---|---|
| C-1 | QSC 24-hour breach banner unreadable and unannounced | done |  |
| C-2 | Focus indicators fail non-text contrast at ~72 call sites | done |  |
| C-3 | role="button" on <tr> and <th> destroys table semantics | done |  |
| C-4 | Token system not enforced — three dialects, 247 hardcoded hex, one undefined token | partial | Only the narrow --color-surface bug is fixed. Dialect consolidation, the ESLint hex ban, and the StatusBadge color collision from the same finding remain open. |
| C-5 | No feedback system: saves are silent, failures are silent | open |  |
| C-6 | A 401 destroys unsaved work by bypassing the unsaved-changes guard | open |  |
| I-1 | Tables scroll horizontally on mobile instead of using the existing card CSS | done |  |
| I-2 | Two icon systems (lucide + Material Symbols) render side by side | open |  |
| I-3 | Incident review step doesn't show who/what the incident is about | done |  |
| I-4 | No skip link, no labelled landmarks, no per-route document title | done |  |
| I-5 | Icon-only destructive actions labelled only by title, mismatched glyph, sub-3:1 hover colors | open |  |
| I-6 | Critical clinical alerts hidden behind a native tooltip | open |  |
| I-7 | Mobile sidebar is a modal without modal behaviour | open |  |
| I-8 | No accelerators (shortcuts, bulk actions, column chooser, saved views, export, debounce) | open |  |
| I-9 | Every page title (h1) looks different | open |  |
| I-10 | StatusBadge fails open into 'pending' amber for unmapped status strings | open |  |
| I-11 | Modal backdrop click discards forms; footer scrolls away | open |  |
| I-12 | WizardStepRail hardcodes 'Intake wizard steps' aria-label in every wizard | open |  |
| I-13 | Two dead controls in the app shell (search input, notification bell) | open |  |
| P-1 | Sub-4.5:1 secondary text (AppLayout sidebar label + search placeholder) | open |  |
| P-2 | Sort affordance invisible (DataTable unsorted chevron opacity-30) | open |  |
| P-3 | Form control borders below 3:1 contrast | open |  |
| P-4 | --color-warning used as text/meaning color instead of on-warning-container | open |  |
| P-5 | EmptyState icon opacity-20 too faint | open |  |
| P-6 | Row select labels announce GUIDs | open |  |
| P-7 | Two competing empty-state systems (EmptyState vs DataTable emptyMessage) | open |  |
| P-8 | TabNav has no tab semantics | open |  |
| P-9 | Inconsistent loading: spinners vs skeletons | open |  |
| P-10 | Default Vite favicon / Odip vs ODIP spelling | open |  |
| P-11 | Portal week toolbar overflows on a phone | open |  |
| F-3-oneline | Stage 0 one-line fix: WorkerScreeningExpiryDate in HasExpiredQualifications | done |  |
| F-1 | Complaints & feedback register | open |  |
| F-2 | Two-deadline reportable-incident clock | open |  |
| F-3-full | Worker screening & risk-assessed-role register (full feature, beyond the one-line fix) | partial | Only the Stage-0 one-line fix landed; the register entity, suspension/bar status, risk-assessed-role record, and point-in-time reconstruction are all still open. |
| F-4 | Evidence & document store | open |  |
| F-5 | Price-limit validation + effective-dated catalogue | open |  |
| F-6 | July-2026 claim-suffix migration | open |  |
| F-7 | Shift → billable event pipeline | open |  |
| F-8 | Shift verification: clock in/out, actual vs rostered | open |  |
| F-9 | Offline-first portal capture | open |  |
| F-10 | Participant goals & outcome reporting | open |  |
| F-11 | Plan budget burn-down & plan-expiry alerts | partial | Plan-expiry alerting exists; the budget burn-down projection and the two spend-related alert types are still open. |
| F-12 | Claim rejection reconciliation | open |  |
| F-13 | Coordinator work surface: saved views, bulk actions, columns, command palette | partial | Selection/bulk-action plumbing has started on claim-batch and trip-detail sub-tabs, but the coordinator's main list pages (Participants/Trips/Staff/Tasks), the shared TableToolbar, CSV export, and the command palette are all still open; the dead header search is unchanged. |

**Counts.** Part A findings (30): **6 done**, **1 partial**, **23 open**. Features (13, counting F-3 once as partial): **0 done**, **3 partial**, **10 open**. Stage 0 (8 items): **8/8 shipped** — every one of the audit's immediate-fix list landed, including the narrow `--color-surface` slice of C-4 (the broader dialect-consolidation and ESLint-ban remedy in C-4 remains open).

---

## 1. The panel

- **Office / Trip Coordinator — desk-based staff running day-to-day trip logistics, participant bookings, staff/vehicle scheduling, and claims admin (PRODUCT.md's stated primary design target).** *(7 raw findings contributed)* — The coordinator's day opens on DashboardPage.tsx — a global bento of upcoming trips, outstanding/overdue tasks, qualification issues and critical participant alerts (frontend/src/pages/DashboardPage.tsx:56-372) — then moves into TripDetailPage's tabs (OverviewTab, BookingsTab, StaffTab, VehiclesTab, AccommodationTab, TasksTab) to add participants to a trip, assign staff and vehicles, and chase paperwork. Adding a participant to a trip via BookingsTab creates a ParticipantBooking and auto-spawns one InsuranceConfirmation task (backend/Odip.Api/Controllers/BookingsAccommodationController.cs:101-145); everything else on the trip — risk review, medication check, family contact, pre-departure prep — is typed in by hand through TaskCreatePage or the trip's TasksTab (frontend/src/pages/trip-detail/TasksTab.tsx:4, backend/Odip.Api/Controllers/TasksDashboardController.cs:32-45). Booking status (Enquiry/Held/Confirmed/Waitlist/Cancelled) is a free-choice dropdown the coordinator sets by eye (frontend/src/pages/trip-detail/BookingsTab.tsx:427-457) rather than anything the system enforces against the trip's MaxParticipants or RequiredWheelchairCapacity (backend/Odip.Domain/Entities/TripInstance.cs:29, backend/Odip.Api/Controllers/TripsController.cs:189). Before a trip goes InProgress a "pre-departure gate" checks for at least one confirmed staff assignment and one confirmed booking (backend/Odip.Api/Controllers/TripsController.cs:244-261) — capacity and wheelchair-seat math is not part of that gate. Intake of a new participant runs through IntakeWizardPage with no check against people already in the system (frontend/src/pages/intake/IntakeWizardPage.tsx; backend/Odip.Api/Controllers/ParticipantsController.cs:229-320), and family-submitted profile edits land on CaregiverSubmissionReviewPage as one all-or-nothing accept/reject (frontend/src/pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx:19-38).

- **Field Support Worker (mobile, on-shift, often one-handed / gloved / poor connectivity)** *(8 raw findings contributed)* — A support worker logs in and lands on the coordinator-oriented "Management Dashboard" (frontend/src/pages/DashboardPage.tsx:56-135, mounted at '/' in App.tsx:92) before navigating themselves to /portal (frontend/src/pages/portal/PortalShiftsPage.tsx) to see their rostered week. Tapping into a shift (PortalShiftDetailPage.tsx) shows the participant's support/mobility/equipment flags, routines due in that window, active risk entries, and active medications — all read-only, pulled from purpose-built portal DTOs (backend/Odip.Application/DTOs/PortalDTOs.cs) so nothing sensitive outside the shift leaks through. They can add or edit a shift note (ShiftNotesSection.tsx, backed by PortalController.cs:169-273), which is server-scanned for risk keywords and can one-tap hand off into a pre-filled incident report (lib/incidentPrefill.ts) if flagged. If a coordinator or another worker names them as a medication or incident witness, a badge in the header (usePendingWitnessRequests, portal.ts:60-66) leads to /portal/witness-approvals where they approve or decline (PortalWitnessApprovalsPage.tsx). To actually give a dose, though, they leave the portal entirely for the general /medications page's Administration tab (MarTab.tsx), which is a desktop-style date-nav + full-participant-dropdown table with no memory of which shift or participant they came from.

- **Finance & Claims Officer** *(8 raw findings contributed)* — Today this person lives in two parallel worlds that both call themselves "claims." For trip-based holiday supports they open a trip's Claims tab (`frontend/src/pages/trip-detail/ClaimsTab.tsx`), generate a `TripClaim` from `ClaimGenerationService` (backend/Odip.Infrastructure/Services/ClaimGenerationService.cs), adjust `ClaimLineItem` hours/rates/status on `ClaimDetailPage.tsx`, and download either a BPR CSV (agency-managed) via `BprCsvService.cs` or a PDF tax invoice (plan/self/private-managed) via `InvoiceService.cs`. For everything else (shifts, STA, community access) they work in `BillingPage.tsx` — managing `FundingSource` and `ServiceBooking` records, reviewing Draft `BillableEvent`s, and building a `ClaimBatch` on `ClaimBatchBuilderPage.tsx`, which runs `BillingValidator` (booking-balance, duplicate-reference, claim-window checks) before letting them download the PRODA bulk CSV from `ClaimBatchDetailPage.tsx`. Neither system talks to the other, neither shows what actually happened after the file left ODIP (no submission timestamp is ever set, no remittance is imported), and most of what they touch — funding sources, service bookings, billable events, claim batches, claim line items — leaves no audit trail at all, despite every dollar being exactly the thing they're accountable for.

- **Provider owner / operations manager (Oassist principal) — owns P&L, staff/vehicle utilisation, compliance exposure, participant pipeline, and multi-site delegation. Not the day-to-day desk coordinator ODIP is primarily designed for (PRODUCT.md line 11).** *(7 raw findings contributed)* — I open ODIP hoping for a "how's the business doing" screen and get DashboardPage.tsx — a coordinator's operational board: upcoming trips, outstanding/overdue tasks, qualification issues, critical participant alerts (frontend/src/pages/DashboardPage.tsx:56-372), backed by DashboardSummaryDto (backend/Odip.Application/DTOs/DTOs.cs:1682, populated by DashboardController.GetSummary in backend/Odip.Api/Controllers/TasksDashboardController.cs:363-436) — which is entirely counts (trips, tasks, incidents, qual issues), with zero dollar figures. To see money I go to BillingPage.tsx, which is three CRUD tabs (funding sources, service bookings, billable events) with per-row currency columns but no rollup; a claim batch or claim shows its own total (ClaimBatchDetailPage.tsx:139, ClaimDetailPage.tsx:136) but nothing sums across batches or over a period. I check VehiclesPage.tsx for fleet health and get a static "Total Fleet Capacity" seat count (lines 234-249) — no per-vehicle utilisation. I check StaffPage.tsx for who's overworked or under-rostered and find only a qualifications/compliance table (driver/first-aid/meds/worker-screening flags), no hours or cost. If I run more than one site, TenantsController.cs (SuperAdmin-only, line 15) lets me list tenants with just a user count (line 26-32) — no per-tenant performance snapshot — so comparing sites means impersonating into each one via view-as.

- **Clinical / Behaviour Support Practitioner** *(8 raw findings contributed)* — I spend my day moving between the participant record's clinical sections — Health Conditions, ADL Assessments, Behaviour & Communication, Medications, Restrictive Practices — and the register-style tabs coordinators also touch (MedicationsPage's MAR/Register/Report tabs, RestrictivePracticesTab, RiskEntriesSection). I set up medication regimes with PRN limits and witness requirements (ParticipantMedication.cs), review the restrictive-practices register per participant (RestrictivePracticesTab.tsx / RestrictivePracticesController.cs), read the computed participant alerts (ParticipantAlertsService.cs) for overdue RP reviews and witness gaps, and record or review BehaviourOfConcern/RestrictivePracticeUse incidents (IncidentReport.cs). I never touch the field-worker portal directly, but everything I decide — routines, restrictive-practice authorisations, allergy management, PRN protocols — has to actually reach the worker standing in front of the participant, and right now a lot of it visibly doesn't. I do not manage an actual Behaviour Support Plan document anywhere in the system — "BspInPlace"/"bspPlanProvided" are checkboxes, not a plan I can author, date, or review — and when the NDIS Commission's monthly restrictive-practice reporting is due, I have no export and would compile it by hand from the register and incident list.

- **NDIS Quality and Safeguards Commission auditor / internal compliance officer** *(7 raw findings contributed)* — I spend my day pulling evidence, not entering it: I check the Incidents list (frontend/src/pages/IncidentsPage.tsx) for anything overdue against the 24-hour QSC clock, I open individual participants to check their Restrictive Practices tab and Consents section for authorisation currency, and once a month I try to assemble the RP usage report and the reportable-incident log the Commission actually wants — a cross-participant, cross-incident, exportable view. When something looks wrong (a lapsed RP authorisation, a corrected incident record, a consent that flipped from granted to declined), I go looking for who changed what and when, via AuditController (backend/Odip.Api/Controllers/AuditController.cs) — but only for the entity types someone remembered to register in AuditedEntities.Types. I do not build anything; I read, cross-reference, and get squeezed by whatever the read paths don't expose.

- **Participant, family member, or nominee/guardian (e.g. a parent of an NDIS participant who goes on Oassist trips)** *(7 raw findings contributed)* — This persona has no ODIP account and never logs in — PRODUCT.md states "No participant/family-facing portal is in scope," and Odip.Domain/Enums/Enums.cs's UserRole enum (Admin/Coordinator/SupportWorker/ReadOnly/SuperAdmin) confirms there is no Participant/Family role at all. Their sole touchpoint with the system is a magic-link "caregiver profile" wizard (frontend/src/pages/caregiver/CaregiverWizardPage.tsx) that a coordinator issues per-participant from ParticipantDetailPage.tsx's CaregiverLinkControl — a no-auth, token-only public route (backend/Odip.Api/Controllers/CaregiverController.cs) that lets them review and edit a subtracted projection of the participant's profile (identifiers, cultural background, medical, mobility, behaviour, daily living, and consent decisions) and submit it for staff review/accept via CaregiverSubmissionsController.cs. Everything else — trip itineraries, what happened on a trip, incidents, plan funding, and any way to raise a concern — happens entirely outside the system, over the phone or in person, because staff-side modules (Incidents, NDIS funding, complaints) have no participant-facing surface and nothing writes back to this family member. Their entire experience of ODIP is: fill in a form once every so often, hit submit, and hope someone tells them what happened to it.

- **System Administrator / IT & Security (platform operator, SuperAdmin)** *(9 raw findings contributed)* — I'm the person who provisions a new Oassist tenant end-to-end via `TenantsController.CreateWithSetup` (backend/Odip.Api/Controllers/TenantsController.cs:59-146) — tenant, provider bank/ABN settings, and one initial Firebase-backed user in a single call. Day to day I work `AdminUsersController` (backend/Odip.Api/Controllers/AdminUsersController.cs) to create/edit/deactivate users across tenants, keeping Firebase Auth and the ODIP `Users` table in lockstep. When something looks wrong on a participant, trip, or shift, I open its `AuditHistoryTab` (frontend/src/components/AuditHistoryTab.tsx) to see field-level history — but only if I already know the exact entity and its GUID, because `AuditController.GetAuditHistory` (backend/Odip.Api/Controllers/AuditController.cs:35-100) has no cross-entity search. I flip into a tenant via the `X-View-As-Tenant`/`X-View-As-User` headers (`CurrentTenant.cs`) when a coordinator needs help, and I watch the login-rate-limiter and CSP config in `Program.cs` because I'm the one who gets paged if either one misfires in production. I don't currently have a way to see whether last night's holiday sync or a PRODA/Firebase call actually failed, or to prove the last time the Postgres volume was backed up.

---

## 2. What the panel converged on

- Evidence, not just data: the registers exist but cannot prove who did what when — audit coverage, screening verification, consent reconciliation and impersonation trails are all capture-without-provenance gaps.
- Point-of-care blindness: the field worker's shift screen omits the highest-consequence participant data (anaphylaxis, active restrictive practices, behaviour plans) and makes attestation one tap too easy.
- Two money pipelines, no single ledger: TripClaim and BillableEvent are both live and disconnected, so booking-balance validation, non-agency invoicing, claim status and any revenue view are all built on sand until S-18 is decided.
- Per-participant data with no tenant-wide rollup: restrictive practices, compliance alerts, audit history and QSC-overdue incidents each need the same 'show me everything across the tenant, exportable' surface.
- Operational resilience was never on the roadmap: no backups, no per-account lockout, no integration health — the season is the audit evidence, and it lives on one volume.
- Most wins are wiring gaps, not new systems: ownerId filters, BillingRouter, EffectiveFrom/To, the alerts aggregate and ConfirmDialog all exist and are simply not connected.

---

## 3. Ranked recommendations

| # | ID | Recommendation | Stakeholders | Size | Priority | Score (total; c/r/f/e) | Stage | Extends |
|---|---|---|---|---|---|---|---|---|
| 1 | S-1 | Extend audit-log coverage to financial, restrictive-practice/consent and tenant-configuration entities | Finance, QSC Auditor, SysAdmin | S | P0 | 15 (5/2/3/5) | Stage 1 | — |
| 2 | S-2 | Automated, off-host backups of the production database and documents volume | SysAdmin, Owner | M | P0 | 13 (5/4/1/3) | Stage 1 | — |
| 3 | S-3 | Tenant-wide restrictive-practices register page with NDIS Commission usage-report export | QSC Auditor, Clinical | M | P0 | 12 (5/1/3/3) | Stage 1 | — |
| 4 | S-4 | Surface allergy/anaphylaxis, active restrictive practices and behaviour & communication data on the portal shift screen | Field Support Worker, Clinical | M | P0 | 12 (4/0/5/3) | Stage 1 | — |
| 5 | S-5 | Witness approvals: confirm before medication Approve and show the full incident report before attestation | Field Support Worker, Clinical, QSC Auditor | S | P0 | 12 (4/0/4/4) | Stage 1 | — |
| 6 | S-6 | Apply F-5's date-effective catalogue lookup to ClaimGenerationService as well as BillingValidator | Finance | S | P1 | 12 (2/4/2/4) | Stage 2 | F-5 |
| 7 | S-7 | Family-notification deadline on incidents, parallel to the QSC clock | Family, Coordinator, QSC Auditor | S | P0 | 11 (4/0/3/4) | Stage 1 | F-2 |
| 8 | S-8 | Duplicate-participant detection on intake and manual create | Coordinator, Finance | S | P1 | 11 (2/3/2/4) | Stage 2 | — |
| 9 | S-9 | Claim status truthfulness: 'mark batch submitted' endpoint and PartiallyPaid auto-promotion | Finance | S | P1 | 11 (1/3/3/4) | Stage 2 | F-12 |
| 10 | S-10 | Worker-screening verification metadata (VerifiedAt / VerifiedBy / clearance document) | QSC Auditor, Coordinator | S | P0 | 10 (4/0/2/4) | Stage 1 | F-3 |
| 11 | S-11 | Least-privilege RBAC: split bank details from coordinator-readable settings now; add Finance, Clinical and Owner roles | SysAdmin, Owner, Finance, Clinical | L | P1 | 10 (4/1/3/2) | Stage 1 | — |
| 12 | S-12 | Tenant-wide compliance worklist, with restrictive-practice review-overdue escalated and aggregated | QSC Auditor, Clinical, Coordinator | S | P1 | 10 (3/0/3/4) | Stage 1 | — |
| 13 | S-13 | Give plan-/self-managed, private and B2B billable events an invoice route, and keep them out of the PRODA batch builder | Finance | L | P1 | 10 (1/5/3/1) | Stage 2 | — |
| 14 | S-14 | Enforce trip headcount and wheelchair-seat capacity | Coordinator | M | P1 | 10 (2/2/3/3) | Stage 3 | — |
| 15 | S-15 | Record a medication dose directly from the portal shift screen | Field Support Worker | M | P1 | 10 (2/0/5/3) | Stage 3 | — |
| 16 | S-16 | Portal navigation: role-branch the home route to /portal and link the shift screen to the full participant record | Field Support Worker | S | P1 | 10 (0/0/5/5) | Stage 3 | — |
| 17 | S-17 | F-9 scope: retrofit offline queueing onto the already-shipped shift-note and witness approve/decline writes first | Field Support Worker | S | P1 | 10 (2/1/4/3) | Stage 3 | F-9 |
| 18 | S-18 | Decide and unify the two disconnected claim pipelines so one ledger holds claimed amounts | Finance, Owner | L | P1 | 9 (2/4/3/0) | Stage 2 | F-11 |
| 19 | S-19 | Consent record integrity: reconcile medication-level consent with the ParticipantConsent register, and reconfirm consent changes made via the caregiver link | Clinical, Family, QSC Auditor | M | P1 | 9 (4/0/2/3) | Stage 3 | — |
| 20 | S-20 | Roster check for participant-specific health-condition training requirements | Clinical, Coordinator | M | P1 | 9 (3/0/3/3) | Stage 3 | — |
| 21 | S-21 | Cross-entity audit log search page, with ChangedById exposed alongside ChangedByName | SysAdmin, QSC Auditor | M | P1 | 9 (3/1/2/3) | Stage 3 | — |
| 22 | S-22 | Trip task-checklist templates instantiated on trip create | Coordinator | M | P2 | 9 (1/1/4/3) | Stage 4 | — |
| 23 | S-23 | 'Assigned to me' task filter and dashboard scoping on the existing ownerId API | Coordinator | S | P2 | 9 (0/0/4/5) | Stage 4 | F-13 |
| 24 | S-24 | Behaviour Support Plan register replacing checkbox-only BSP tracking | Clinical, QSC Auditor | M | P1 | 8 (4/0/2/2) | Stage 3 | — |
| 25 | S-25 | Audit trail for SuperAdmin view-as impersonation sessions | SysAdmin, Owner | M | P1 | 8 (4/0/1/3) | Stage 3 | — |
| 26 | S-26 | Per-account login lockout alongside the IP-based limiter | SysAdmin | S | P1 | 8 (3/0/1/4) | Stage 1 | — |
| 27 | S-27 | Public self-service complaint/feedback intake feeding F-1's register | Family | M | P1 | 8 (3/0/2/3) | Stage 3 | F-1 |
| 28 | S-28 | Behaviour-of-concern evidence: structured ABC incident fields and a PRN/behaviour trend view | Clinical | M | P2 | 8 (3/0/2/3) | Stage 4 | — |
| 29 | S-29 | Outbound notification channel (email/SMS/web push) for workers and families | Field Support Worker, Family | L | P2 | 8 (2/1/4/1) | Stage 4 | — |
| 30 | S-30 | Booking cancellation cleanup: auto-cancel linked tasks, prompt waitlist promotion, release capacity | Coordinator | M | P2 | 8 (0/2/3/3) | Stage 3 | — |
| 31 | S-31 | Caregiver submission workflow: per-field accept, regenerate-link guard, and distinct revoked/accepted end states | Coordinator, Family | M | P2 | 7 (2/0/2/3) | Stage 3 | — |
| 32 | S-32 | Business performance dashboard: revenue pipeline by stream, outstanding-claims aging, and per-tenant comparison | Owner, Finance | M | P2 | 7 (0/3/2/2) | Stage 4 | — |
| 33 | S-33 | Staff and vehicle utilisation reporting | Owner, Coordinator | M | P2 | 6 (0/2/2/2) | Stage 4 | F-8 |
| 34 | S-34 | Participant pipeline and churn-risk report | Owner | M | P2 | 6 (0/3/1/2) | Stage 4 | F-11 |
| 35 | S-35 | Nominee-facing read-only plan funding summary | Family | M | P2 | 6 (1/1/2/2) | Later | F-11 |
| 36 | S-36 | Integration / background-job health panel | SysAdmin | M | P2 | 6 (1/1/1/3) | Stage 4 | — |
| 37 | S-37 | Tenant offboarding: cascade user deactivation and a pre-deactivation data export | SysAdmin, Owner | M | P2 | 5 (2/0/0/3) | Later | — |
| 38 | S-38 | Trip/shift cost capture and planned-vs-actual margin | Owner | L | P2 | 4 (0/3/1/0) | Later | — |

---

## 4. Detail

### S-1 — Extend audit-log coverage to financial, restrictive-practice/consent and tenant-configuration entities

**Stakeholders:** Finance, QSC Auditor, SysAdmin · **Size:** S · **Priority:** P0 · **Stage:** Stage 1 · **Depends on:** — · **Extends:** — · **Sources:** FIN-1, QSC-1, SEC-3

**Problem.** PRODUCT.md claims audit logging on every entity, but AuditInterceptor only writes rows for types in AuditedEntities.Types (backend/Odip.Infrastructure/Audit/AuditedEntities.cs:8-55, gate at AuditInterceptor.cs:68). Absent: TripClaim, ClaimLineItem, FundingSource, ServiceBooking, ServiceBookingLine, BillableEvent, ClaimBatch (so ClaimsController.UpdateLineItem :147-192, DeleteClaim :194-221, BillingController.UpdateFundingSource :88-103 and draft-event edits :288-322 are silent); RestrictivePractice and ParticipantConsent (the two registers a Commission audit scrutinises hardest, also missing from AuditController's allowedTypes map at AuditController.cs:43-55 so history could not be retrieved even if captured); and Tenant + ProviderSettings (bank BSB/AccountNumber/ABN writable via ProviderSettingsController.cs:47-52, tenant activation via TenantsController.cs:150-165, no history).

**Proposal.** Add all of the above types to AuditedEntities.Types and add RestrictivePractice/ParticipantConsent (and the billing types) to AuditController's allowedTypes so AuditHistoryTab can show them. Mask BSB/AccountNumber old/new values in the Changes JSON (last 4 digits) rather than excluding them. Verify GetEntityId handles child rows (ClaimLineItem, ServiceBookingLine) the way StaffAssignment already does. No new plumbing; audit starts from the change forward.

**Evidence.** backend/Odip.Infrastructure/Audit/AuditedEntities.cs:8-55; backend/Odip.Infrastructure/Audit/AuditInterceptor.cs:68; backend/Odip.Api/Controllers/AuditController.cs:43-55; backend/Odip.Api/Controllers/ClaimsController.cs:147-221; backend/Odip.Api/Controllers/BillingController.cs:88-103,288-322; backend/Odip.Api/Controllers/ProviderSettingsController.cs:47-52; backend/Odip.Api/Controllers/TenantsController.cs:150-165

**Why here.** Highest-exposure gap at the lowest cost: PRODUCT.md promises audit on every entity, yet the RP/consent registers and all money mutations are silent today, and it is a set-membership change.

---

### S-2 — Automated, off-host backups of the production database and documents volume

**Stakeholders:** SysAdmin, Owner · **Size:** M · **Priority:** P0 · **Stage:** Stage 1 · **Depends on:** — · **Extends:** — · **Sources:** SEC-6

**Problem.** deploy/compose.yaml defines a single Postgres 16 container on named volume pgdata and an api container writing uploads to volume documents (deploy/compose.yaml:1-16,37-38,63-65). Nothing in the compose file, .github/ workflows or elsewhere runs pg_dump, snapshots volumes or ships copies off the single homelab host — disk failure or a bad `docker volume rm` loses all participant/NDIS/financial data.

**Proposal.** A scheduled backup job (sidecar container or homelab cron per CLAUDE.md conventions) running nightly pg_dump plus a documents-volume copy to an off-host target, with a documented restore procedure and periodic restore test.

**Evidence.** deploy/compose.yaml:1-16,37-38,63-65; .github/ (no backup references)

**Why here.** A single homelab volume with no off-host copy is an existential loss of all NDIS, clinical and claim records; nothing else on this list matters if the data is gone.

---

### S-3 — Tenant-wide restrictive-practices register page with NDIS Commission usage-report export

**Stakeholders:** QSC Auditor, Clinical · **Size:** M · **Priority:** P0 · **Stage:** Stage 1 · **Depends on:** S-1 · **Extends:** — · **Sources:** QSC-1, CLIN-4

**Problem.** RestrictivePracticesController only exposes GET under /participants/{id}/restrictive-practices plus CRUD (backend/Odip.Api/Controllers/RestrictivePracticesController.cs:36-52, whole file 1-319 has no report/export action); no /restrictive-practices route exists in frontend/src/App.tsx:120-138 and RestrictivePracticesTab.tsx is per-participant only. Registered providers must report RP usage to the Commission monthly and Platform Plan/04-modules.md M9 lists 'monthly reporting export' in scope, yet the report is currently hand-compiled from per-participant tabs and the incident list.

**Proposal.** Add a tenant-wide GET /api/v1/restrictive-practices (filters: type, reviewOverdue, authorisedBy, date range) and a GET /api/v1/restrictive-practices/report that joins RestrictivePractice with linked IncidentReport rows (RestrictivePracticeId / UnapprovedRestrictivePracticeDetails, IncidentReport.cs:46-75) into the Commission's usage-report shape, exported via the existing ClosedXML pipeline. Add a /restrictive-practices register page mirroring /incidents with CSV/Excel export.

**Evidence.** backend/Odip.Api/Controllers/RestrictivePracticesController.cs:36-52; frontend/src/App.tsx:120-138; frontend/src/pages/participant-detail/RestrictivePracticesTab.tsx; backend/Odip.Domain/Entities/IncidentReport.cs:46-75; Platform Plan/04-modules.md (M9)

**Why here.** Monthly Commission RP usage reporting is a hard registered-provider obligation already scoped in M9, and is currently hand-compiled from per-participant tabs.

---

### S-4 — Surface allergy/anaphylaxis, active restrictive practices and behaviour & communication data on the portal shift screen

**Stakeholders:** Field Support Worker, Clinical · **Size:** M · **Priority:** P0 · **Stage:** Stage 1 · **Depends on:** — · **Extends:** — · **Sources:** CLIN-1, FSW-4, CLIN-2

**Problem.** PortalParticipantSummaryDto (backend/Odip.Application/DTOs/PortalDTOs.cs:54-74) and PortalController.ToParticipantSummaryDto (:424-429) omit Participant.AllergiesDetail/IsAnaphylaxisRisk/AllergyManagementNotes (Participant.cs:311-318) entirely, and reduce restrictive practices to a bool HasRestrictivePracticeFlag (PortalDTOs.cs:59) rendered as a bare chip (PortalShiftDetailPage.tsx:108-110). GetShiftDetail (PortalController.cs:143-149) fetches routines, risk entries and medications but not the RestrictivePractice rows (type, description, conditions, review date) or the structured Behaviour & Communication fields (communicationAids, expressiveSkills, receptiveSkills, bocChartProvided per ParticipantBehaviourCommunicationSection.tsx). The RP GET endpoint has no role restriction beyond authentication (RestrictivePracticesController.cs:36 vs role-gated mutations at :55/121/200/243), so the data is already meant to be worker-readable — it just is not surfaced at the point of care.

**Proposal.** Extend PortalShiftDetailDto/PortalParticipantSummaryDto with the three allergy fields, the participant's active RestrictivePracticeDto list, and the Behaviour & Communication fields; render an always-visible allergy/anaphylaxis banner (prominence matching MissedMedicationGuidance.tsx) and a restrictive-practices section alongside routines/risk entries on PortalShiftDetailPage.

**Evidence.** backend/Odip.Domain/Entities/Participant.cs:311-318; backend/Odip.Application/DTOs/PortalDTOs.cs:54-74; backend/Odip.Api/Controllers/PortalController.cs:143-149,424-429; frontend/src/pages/portal/PortalShiftDetailPage.tsx:108-110; backend/Odip.Api/Controllers/RestrictivePracticesController.cs:24-36,55,121,200,243; frontend/src/pages/participant-detail/ParticipantBehaviourCommunicationSection.tsx

**Why here.** Anaphylaxis risk and active restrictive-practice conditions are the highest-consequence data in the system and are invisible on every shift screen every worker opens.

---

### S-5 — Witness approvals: confirm before medication Approve and show the full incident report before attestation

**Stakeholders:** Field Support Worker, Clinical, QSC Auditor · **Size:** S · **Priority:** P0 · **Stage:** Stage 1 · **Depends on:** — · **Extends:** — · **Sources:** FSW-1, FSW-7

**Problem.** On PortalWitnessApprovalsPage the medication-branch Approve fires approve.mutateAsync immediately with no dialog (frontend/src/pages/portal/PortalWitnessApprovalsPage.tsx:53-60) while Decline always opens ConfirmDialog (:67-69) and the incident branch does confirm (:78-80) — a one-tap, gloved mis-tap is a false legal attestation of witnessing a high-risk/psychotropic dose. Incident witness rows render only title/type/participant/severity/reporter/datetime (:168-181) because PortalWitnessRequestDto carries no description/narrative (backend/Odip.Application/DTOs/PortalDTOs.cs:132-153), so a worker attests to (or adds a statement against) an account they cannot read.

**Proposal.** Route medication Approve through the same ConfirmDialog showing medication/strength/dose/participant. Add a read-only 'View full report' expand on incident witness rows (extend PortalWitnessRequestDto with the narrative, scoped like the rest of the portal).

**Evidence.** frontend/src/pages/portal/PortalWitnessApprovalsPage.tsx:53-80,168-181; backend/Odip.Application/DTOs/PortalDTOs.cs:132-153

**Why here.** A one-tap medication witness approval is a false legal attestation waiting to happen, and the fix reuses the ConfirmDialog already wired for Decline.

---

### S-6 — Apply F-5's date-effective catalogue lookup to ClaimGenerationService as well as BillingValidator

**Stakeholders:** Finance · **Size:** S · **Priority:** P1 · **Stage:** Stage 2 · **Depends on:** F-5 · **Extends:** F-5 · **Sources:** FIN-7

**Problem.** F-5 scopes price-limit/effective-date rules to BillingValidator. ClaimGenerationService.CalculateClaimInternalAsync loads items with `ActivityGroupId == x && IsActive` (backend/Odip.Infrastructure/Services/ClaimGenerationService.cs:186-188) and prices via GetPriceForState (:390-403) with no EffectiveFrom/EffectiveTo or service-date reference, so a trip claim generated after an annual catalogue re-import for an earlier trip silently uses today's price.

**Proposal.** When F-5 lands, key GetPriceForState/CalculateClaimInternalAsync off the trip/day-group service date within the catalogue's effective window; call this out in F-5's implementation scope.

**Evidence.** backend/Odip.Infrastructure/Services/ClaimGenerationService.cs:186-188,390-403

**Why here.** Without it F-5 fixes only half the pricing surface and every trip claim after a catalogue re-import silently uses the wrong price; must be inside F-5's scope, not after it.

---

### S-7 — Family-notification deadline on incidents, parallel to the QSC clock

**Stakeholders:** Family, Coordinator, QSC Auditor · **Size:** S · **Priority:** P0 · **Stage:** Stage 1 · **Depends on:** F-2 · **Extends:** F-2 · **Sources:** FAM-1

**Problem.** IncidentReport.FamilyNotified/FamilyNotifiedAt (backend/Odip.Domain/Entities/IncidentReport.cs:135-139) are a direct pass-through from the update DTO (IncidentsController.cs:476-477) with no SLA, no due-by, and no visibility in the coordinator's incident queue. F-2 adds the 24h/5-business-day Commission clocks but does not model the family-notification obligation at all.

**Proposal.** Extend F-2's clock model with a FamilyNotificationDueAt computed from the same AwareAt field, surfaced in the incident list/detail beside the QSC chips, with FamilyNotifiedAt stamped automatically when S-29's outbound send succeeds (manual tick remains as fallback but is audit-marked as manual).

**Evidence.** backend/Odip.Domain/Entities/IncidentReport.cs:135-139; backend/Odip.Api/Controllers/IncidentsController.cs:476-477; backend/Odip.Infrastructure/Services/CaregiverFieldPolicy.cs (incidents never exposed to caregivers)

**Why here.** The family-notification obligation is the same clock model F-2 is building, so adding a due-by field then is near-free and not doing it leaves an unverifiable manual tick.

---

### S-8 — Duplicate-participant detection on intake and manual create

**Stakeholders:** Coordinator, Finance · **Size:** S · **Priority:** P1 · **Stage:** Stage 2 · **Depends on:** — · **Extends:** — · **Sources:** COORD-2

**Problem.** NdisNumber has a non-unique index (backend/Odip.Infrastructure/Data/OdipDbContext.cs:154, no .IsUnique()); ParticipantsController.Create (:229-320) validates fields but never looks up an existing participant by NDIS number or name+DOB; IntakeWizardPage starts blank with no search step. Participant.IsRepeatClient exists precisely because people return, so re-intake or double-processed referrals fork history (bookings, incidents, medications, funding balances) across two IDs with no merge tool.

**Proposal.** Add a name+DOB / NDIS-number lookup as IntakeWizardPage's first step and a live match warning on the manual create form linking to the existing record; add a case-insensitive unique constraint on non-null NdisNumber returning 409 with the existing participant id/name. Merge tool is a later follow-on.

**Evidence.** backend/Odip.Infrastructure/Data/OdipDbContext.cs:154; backend/Odip.Api/Controllers/ParticipantsController.cs:229-320; frontend/src/pages/intake/IntakeWizardPage.tsx

**Why here.** Forked participant records split funding balances and clinical history with no merge tool; a lookup step plus a unique index is cheap prevention before the season fills the table.

---

### S-9 — Claim status truthfulness: 'mark batch submitted' endpoint and PartiallyPaid auto-promotion

**Stakeholders:** Finance · **Size:** S · **Priority:** P1 · **Stage:** Stage 2 · **Depends on:** S-1 · **Extends:** F-12 · **Sources:** FIN-2, FIN-5

**Problem.** ClaimBatch.SubmittedAt (backend/Odip.Domain/Billing/BillingEntities.cs:160) is assigned nowhere; BillingController has create (:390-444) and download (:447-467) but no submit action and api/hooks/billing.ts has no useSubmitClaimBatch, so ClaimBatchDetailPage's 'Submitted to NDIA / Draft — not yet submitted' badge (:87,104-110,141) is permanently wrong. Separately, ClaimsController.UpdateLineItem (:182-188) promotes TripClaim only to all-Paid or all-Rejected; the comment says PartiallyPaid auto-promotion is 'omitted intentionally', so mixed claims sit at a stale status. F-12's reconciliation assumes 'submitted vs paid vs rejected' already exists.

**Proposal.** Add POST /api/v1/billing/claim-batches/{id}/submit setting SubmittedAt (audited via S-1) with a canWrite-gated 'Mark as submitted' button. Add the PartiallyPaid branch (mix of Paid/Rejected, none Pending) and a distinct 'needs attention' badge on ClaimDetailPage and the claims list.

**Evidence.** backend/Odip.Domain/Billing/BillingEntities.cs:160; backend/Odip.Api/Controllers/BillingController.cs:390-467; frontend/src/api/hooks/billing.ts; frontend/src/pages/ClaimBatchDetailPage.tsx:87,104-110,141; backend/Odip.Api/Controllers/ClaimsController.cs:182-188

**Why here.** A permanently-wrong 'not yet submitted' badge and stale PartiallyPaid claims hide money in flight, and F-12 assumes these states already exist.

---

### S-10 — Worker-screening verification metadata (VerifiedAt / VerifiedBy / clearance document)

**Stakeholders:** QSC Auditor, Coordinator · **Size:** S · **Priority:** P0 · **Stage:** Stage 1 · **Depends on:** F-3 · **Extends:** F-3 · **Sources:** QSC-5

**Problem.** User.cs holds only WorkerScreeningNumber and WorkerScreeningExpiryDate (backend/Odip.Domain/Entities/User.cs:37-38); QualificationsPage reasons only about expiry (frontend/src/pages/QualificationsPage.tsx:33-41). F-3's WorkerScreeningRecord shape adds status and evidence but not who verified the number against the NDIS Worker Screening Database or when — a typed number and a verified one are indistinguishable.

**Proposal.** Add VerifiedAt/VerifiedByUserId to F-3's WorkerScreeningRecord (plus EvidenceDocumentId once F-4 exists), display verification state on QualificationsPage, and let RosterConflictService eventually warn on unverified-but-present records.

**Evidence.** backend/Odip.Domain/Entities/User.cs:37-38; frontend/src/pages/QualificationsPage.tsx:33-41; Platform Plan/04-modules.md (M2)

**Why here.** Two columns on F-3's record turn a typed screening number into an auditable verified one; ships as part of F-3, not after it.

---

### S-11 — Least-privilege RBAC: split bank details from coordinator-readable settings now; add Finance, Clinical and Owner roles

**Stakeholders:** SysAdmin, Owner, Finance, Clinical · **Size:** L · **Priority:** P1 · **Stage:** Stage 1 · **Depends on:** — · **Extends:** — · **Sources:** SEC-4, SEC-5, OWNER-6

**Problem.** GET /api/v1/provider-settings is authorised for SuperAdmin,Admin,Coordinator (backend/Odip.Api/Controllers/ProviderSettingsController.cs:12) and returns BankAccountName/BSB/AccountNumber unconditionally (:25-33) to the most numerous persona. UserRole is only Admin/Coordinator/SupportWorker/ReadOnly/SuperAdmin (Enums.cs:244-251; permissions.ts:1; UsersTab.tsx:21-35) though PRODUCT.md:14-18 names Finance and Nurse/Clinical as real roles, so finance/clinical staff must be over-provisioned as Admin/Coordinator. TenantsController.cs:15 and AdminUsersController.cs:16 gate whole controllers on SuperAdmin, bundling read-only cross-tenant oversight with the view-as impersonation grant.

**Proposal.** (1) Immediately: gate bank fields behind an Admin/SuperAdmin-only endpoint or field-level omission (DTO/controller change only). (2) Add Finance, Clinical (or ClinicalReadOnly) and Owner/BusinessAdmin to UserRole; narrow [Authorize] on BillingController/ClaimsController (Finance), future clinical endpoints (Clinical), and split TenantsController/AdminUsersController GETs (Owner, no view-as) from writes (SuperAdmin).

**Evidence.** backend/Odip.Api/Controllers/ProviderSettingsController.cs:12,19-34; backend/Odip.Domain/Enums/Enums.cs:244-251; frontend/src/lib/permissions.ts:1; frontend/src/pages/settings/UsersTab.tsx:21-35; backend/Odip.Api/Controllers/TenantsController.cs:15; backend/Odip.Api/Controllers/AdminUsersController.cs:16; PRODUCT.md:14-18

**Why here.** Part (1) — stop returning BSB/account number to every Coordinator — is a DTO change that belongs in Stage 1; the new Finance/Clinical/Owner roles are the L half and can follow in Stage 3.

---

### S-12 — Tenant-wide compliance worklist, with restrictive-practice review-overdue escalated and aggregated

**Stakeholders:** QSC Auditor, Clinical, Coordinator · **Size:** S · **Priority:** P1 · **Stage:** Stage 1 · **Depends on:** — · **Extends:** — · **Sources:** QSC-6, QSC-3

**Problem.** ParticipantAlertsService computes five alert types per participant, including RP-review-overdue at Warning severity only (backend/Odip.Infrastructure/Services/ParticipantAlertsService.cs:16-34,108-119), and IncidentsController.GetOverdueQsc (:623-658) is a separate unrelated endpoint. Nothing unions 'every participant with an open compliance issue of any kind' into one worklist, and an RP past its review date — arguably no longer validly authorised — is never surfaced as a tenant-wide count the way the incidents page's overdue-QSC banner is (frontend/src/pages/IncidentsPage.tsx:139-154).

**Proposal.** Narrow scope to two changes, since the aggregation/dashboard-card mechanism already exists: (1) In ParticipantAlertsService, escalate rule 1 (restrictive-practice-review-overdue) from unconditional Warning to Critical once rp.ReviewDate is more than 30 days past today (mirror the existing plan-expiring-soon vs plan-expired Warning/Critical split already used for rule 4). (2) Fold IncidentsController.GetOverdueQsc results into the same aggregate response (or a thin wrapper endpoint) so DashboardPage's existing "Critical Participant Alerts" card and count naturally include QSC-overdue incidents alongside participant alerts, instead of showing them as two separate, un-unioned tiles. No new page, route, or aggregation service is needed — extend the existing service/endpoint/card only.

**Evidence.** backend/Odip.Infrastructure/Services/ParticipantAlertsService.cs:16-34,68,108-119; backend/Odip.Api/Controllers/IncidentsController.cs:623-658; frontend/src/pages/IncidentsPage.tsx:139-154; frontend/src/App.tsx (no compliance route)

**Why here.** Narrowed to a severity-escalation rule and folding QSC-overdue into the existing aggregate card, it is a small change that makes an expired RP authorisation impossible to miss.

**Already partly built.** Tenant-wide aggregation already exists: ParticipantAlertsController.GetAggregate (backend/Odip.Api/Controllers/ParticipantAlertsController.cs:39, route api/v1/participants/alerts) calls ParticipantAlertsService.GetAlertsAsync(null, activeOnly:true) which unions all 5 alert rules per participant (backend/Odip.Infrastructure/Services/ParticipantAlertsService.cs:73-119, including RP-review-overdue at ~108-113). The frontend already consumes this: DashboardPage.tsx:61 calls useParticipantAlertsAggregate, and lines 108-114/177-206 build a "Critical Participant Alerts" dashboard card filtered to severity==='Critical', styled with the same destructive-color banner pattern as the other overdue tiles (QSC Overdue small-stat at DashboardPage.tsx:122, sourced from IncidentsController.GetOverdueQsc :623-658 via d.qscOverdueCount). So a tenant-wide compliance card driven by the alerts aggregate is already live, not merely proposed.

What is genuinely NOT built: (1) RP-review-overdue is hardcoded to AlertSeverity.Warning with no grace-period escalation to Critical (ParticipantAlertsService.cs doc comment lines 16-18 and the Add() call for rule 1 pass AlertSeverity.Warning unconditionally) — an RP review overdue by 30+ days never surfaces in the dashboard's Critical card/count. (2) QSC-overdue incidents (IncidentsController.GetOverdueQsc :623-658) are a completely separate data source, never unioned with ParticipantAlertsService output — Dashboard shows them as two independent tiles rather than one merged, ranked compliance worklist. (3) No dedicated compliance worklist page exists — only the participants table (per-row alerts) and the incidents page banner (IncidentsPage.tsx:139-154).

---

### S-13 — Give plan-/self-managed, private and B2B billable events an invoice route, and keep them out of the PRODA batch builder

**Stakeholders:** Finance · **Size:** L · **Priority:** P1 · **Stage:** Stage 2 · **Depends on:** S-18 · **Extends:** — · **Sources:** FIN-3, FIN-6

**Problem.** BillingRouter.Route() maps non-agency FundingRouteTypes to XeroInvoiceTo* routes (backend/Odip.Domain/Billing/Services/BillingRouter.cs) but has zero production callers (only BillingPrototypeTests.cs and Odip.ProtoTests/Program.cs). CreateClaimBatch rejects non-agency events with a 400 count and no row identification (BillingController.cs:401-405); InvoiceService reads only TripClaim/ClaimLineItem (InvoiceService.cs:27-53), never BillableEvent. So a Validated non-agency BillableEvent has nowhere to go — silent revenue leakage for four of five route types. Meanwhile ClaimBatchBuilderPage (frontend/src/pages/ClaimBatchBuilderPage.tsx:87-110) never filters or badges by routeType, so the officer selects ineligible rows and only learns at create time.

**Proposal.** (a) Quick UI fix: exclude non-agency events from the builder's candidate list or badge each row with route type and disable selection with an inline reason. (b) Wire BillingRouter into a real path: extend InvoiceService (or a BillableEventInvoiceService) to take Validated non-agency events grouped by payer and render the existing PDF invoice, transitioning them to Invoiced — or explicitly scope the Xero integration as its own workstream. Add a NoRouteAvailable finding in BillingValidator so stuck events are visible on BillingPage.

**Evidence.** backend/Odip.Domain/Billing/Services/BillingRouter.cs; backend/Odip.Api/Controllers/BillingController.cs:401-405; backend/Odip.Infrastructure/Services/InvoiceService.cs:27-53; frontend/src/pages/ClaimBatchBuilderPage.tsx:87-110

**Why here.** Four of five funding route types have no path to money; ship the builder badge/filter (a) immediately in Stage 2 and decide invoice-vs-Xero for (b) alongside S-18.

---

### S-14 — Enforce trip headcount and wheelchair-seat capacity

**Stakeholders:** Coordinator · **Size:** M · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** — · **Extends:** — · **Sources:** COORD-1

**Problem.** TripInstance.MaxParticipants (backend/Odip.Domain/Entities/TripInstance.cs:29) and RequiredWheelchairCapacity are captured (TripsController.cs:127,189) and shown as a raw count on the dashboard (DashboardPage.tsx:270) but never compared. BookingsAccommodationController.Create (:101-160) accepts any BookingStatus including Confirmed with no headcount check; BookingsTab renders status as a free dropdown (BookingsTab.tsx:427-457). Vehicle.WheelchairPositions exists (Vehicle.cs:18) and RosterConflictService checks staff manual-handling against a wheelchair participant (RosterConflictService.cs:206-211) but never sums wheelchair-required bookings against assigned vehicles' seats. The pre-departure gate (TripsController.cs:244-261) checks neither.

**Proposal.** Soft-block (409 warning with override, matching F-5's price-limit pattern) when confirming a booking would exceed MaxParticipants. Add a WHEELCHAIR_CAPACITY_EXCEEDED finding (RosterConflictService or a small TripCapacityService) summing confirmed WheelchairRequired bookings per trip day against Vehicle.WheelchairPositions of that day's confirmed VehicleAssignments, shown in ExceptionsDrawer. Add both checks as warnings to the pre-departure gate. S-30 must release freed capacity on cancellation.

**Evidence.** backend/Odip.Domain/Entities/TripInstance.cs:29; backend/Odip.Api/Controllers/TripsController.cs:127,189,244-261; backend/Odip.Api/Controllers/BookingsAccommodationController.cs:101-160; frontend/src/pages/trip-detail/BookingsTab.tsx:427-457; backend/Odip.Domain/Entities/Vehicle.cs:18; backend/Odip.Domain/Rostering/Services/RosterConflictService.cs:206-218

**Why here.** Captured-but-never-compared headcount and wheelchair capacity is a safety and refund risk on every trip; a soft-block plus a roster finding fits the existing conflict-service pattern.

---

### S-15 — Record a medication dose directly from the portal shift screen

**Stakeholders:** Field Support Worker · **Size:** M · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** — · **Extends:** — · **Sources:** FSW-2

**Problem.** PortalShiftDetailPage lists active medications read-only (frontend/src/pages/portal/PortalShiftDetailPage.tsx:226-251); the only place to record an administration is /medications → MarTab, a coordinator-style date-nav table whose participantId state initialises to '' and whose picker is the full org list (MarTab.tsx:58-90), with no query-param/router-state entry point. SupportWorker already has canRecordAdministrations (frontend/src/lib/permissions.ts:103). Every dose means navigating away and re-finding the participant from a global list under time pressure.

**Proposal.** Add a 'Record dose' action per medication row on PortalShiftDetailPage that deep-links to the MAR pre-scoped (e.g. /medications?participantId=X&date=Y with MarTab reading initial state from the query), or a portal-native record-administration screen reusing RecordAdministrationModal's logic scoped to the current shift.

**Evidence.** frontend/src/pages/portal/PortalShiftDetailPage.tsx:226-251; frontend/src/pages/medications/MarTab.tsx:58-90; frontend/src/lib/permissions.ts:103

**Why here.** Every dose currently means leaving the shift and re-finding the participant in a global picker; a query-param deep link into MarTab fixes most of it cheaply and belongs with the Stage 3 portal work.

---

### S-16 — Portal navigation: role-branch the home route to /portal and link the shift screen to the full participant record

**Stakeholders:** Field Support Worker · **Size:** S · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** — · **Extends:** — · **Sources:** FSW-3, FSW-5

**Problem.** '/' always renders the coordinator Management Dashboard (frontend/src/App.tsx:92; DashboardPage.tsx:56-135 has no role checks) so a SupportWorker pays for dashboard aggregates they cannot act on (canViewAlerts false, permissions.ts:195) before finding /portal in the sidebar; Platform Plan/04-modules.md:82 specifies a distinct 'Field (my shifts/trips)' home. Separately, the participant name on PortalShiftDetailPage is plain text (:95), not a link, so reaching guardian/emergency contacts or plan documents in an escalation means leaving the shift and searching Participants from scratch, even though 'participants' is in SUPPORT_WORKER_PAGES (permissions.ts:27).

**Proposal.** Redirect isSupportWorker from '/' to /portal (in the route or PrivateRoute). Make the participant header on PortalShiftDetailPage a Link to /participants/:id, defaulting that view to an emergency-contacts-first tab for this role.

**Evidence.** frontend/src/App.tsx:92; frontend/src/pages/DashboardPage.tsx:56-135; frontend/src/lib/permissions.ts:27,195; frontend/src/pages/portal/PortalShiftDetailPage.tsx:95; Platform Plan/04-modules.md:82; backend/Odip.Application/DTOs/PortalDTOs.cs:50-53

**Why here.** Trivial role-branch redirect and a Link; pure convenience so it sits below the compliance items despite an equal total, but ship it whenever a portal branch is open.

---

### S-17 — F-9 scope: retrofit offline queueing onto the already-shipped shift-note and witness approve/decline writes first

**Stakeholders:** Field Support Worker · **Size:** S · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** F-9 · **Extends:** F-9 · **Sources:** FSW-6

**Problem.** F-9 names the shift-note and RecordAdministrationModal writes but not witness approve/decline. Today all three are plain apiPost/apiPut (frontend/src/api/hooks/portal.ts:32-55) with no retry/queue; ShiftNotesSection's catch block sets a generic error string (frontend/src/pages/portal/components/ShiftNotesSection.tsx:105-116). No vite-plugin-pwa/workbox/serviceWorker reference exists in vite.config.ts, index.html or package.json.

**Proposal.** When F-9 is built, explicitly include witness approve/decline in the outbox scope alongside shift notes and administrations, and treat these existing flows as the first retrofit targets (TanStack persister + mutation queue with a visible 'pending sync' state) rather than greenfield.

**Evidence.** frontend/src/api/hooks/portal.ts:32-55; frontend/src/pages/portal/components/ShiftNotesSection.tsx:105-116; frontend/vite.config.ts, index.html, package.json (no PWA/service-worker references)

**Why here.** Scope correction to F-9: witness approve/decline use the same unguarded apiPostRaw as shift notes and must be in the outbox from day one.

---

### S-18 — Decide and unify the two disconnected claim pipelines so one ledger holds claimed amounts

**Stakeholders:** Finance, Owner · **Size:** L · **Priority:** P1 · **Stage:** Stage 2 · **Depends on:** — · **Extends:** F-11 · **Sources:** FIN-4

**Problem.** Legacy TripClaim/ClaimLineItem (ClaimGenerationService.cs:148-336, /claims/:id) and the newer FundingSource/ServiceBooking/BillableEvent/ClaimBatch engine (BillingController.cs, /billing/*) are both routed and live (frontend/src/App.tsx:126-129). ClaimGenerationService never reads or writes FundingSource/ServiceBooking/ServiceBookingLine, so trip-billed spend is invisible to BillingValidator.ValidateBookingBalance (BillingValidator.cs:107-149) — the check built to prevent the #1 PRODA rejection cause (BillingEntities.cs:74-77) — and to F-11's burn-down and F-7's pipeline, which both assume a single claimed-amount truth.

**Proposal.** Product decision first: retire TripClaim in favour of routing trip claims through BillableEvent/ServiceBooking (consistent with F-7), or have GenerateDraftClaimAsync write ServiceBookingLine.ClaimedAmount so both pipelines share one ledger. Flag to the owners of F-7 and F-11 before either ships.

**Evidence.** backend/Odip.Infrastructure/Services/ClaimGenerationService.cs:148-336; backend/Odip.Domain/Billing/Services/BillingValidator.cs:107-149; backend/Odip.Domain/Billing/BillingEntities.cs:74-77; frontend/src/App.tsx:126-129

**Why here.** Ranked above its total because it is a gating decision: F-7, F-11 and BillingValidator's booking-balance check all assume one claimed-amount ledger that does not exist while TripClaim and BillableEvent both live.

---

### S-19 — Consent record integrity: reconcile medication-level consent with the ParticipantConsent register, and reconfirm consent changes made via the caregiver link

**Stakeholders:** Clinical, Family, QSC Auditor · **Size:** M · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** — · **Extends:** — · **Sources:** CLIN-8, FAM-4

**Problem.** ParticipantMedication.ConsentObtained/ConsentGivenBy/ConsentDate (ParticipantMedication.cs:91-93) and ParticipantConsent's ConsentType.OtcMedication row (ParticipantConsent.cs; Enums.cs:635) represent the same consent with no link; MedicationsController's ConsentMissing flag (:664) reads only the medication-level field, so a contradiction goes unnoticed. Separately, photo/medical-treatment consent decisions arrive through the no-auth, forwardable caregiver token (CaregiverController.cs:17-24) as a typed name and date only (CulturalDepthConsentsStep.tsx:95,98; ParticipantConsent.cs:49-51 docstring: signature capture deferred).

**Proposal.** Derive or cross-display the ParticipantConsent.OtcMedication answer beside the medication consent fields with a hard mismatch warning. In the caregiver flow, call out consent-row changes explicitly in the accept/reject diff (stated name/relationship) and add a distinct reconfirmation step (e.g. re-typing the participant's full name); e-signature capture (F-4-adjacent) is a later follow-on.

**Evidence.** backend/Odip.Domain/Entities/ParticipantMedication.cs:91-93; backend/Odip.Domain/Entities/ParticipantConsent.cs:49-51; backend/Odip.Domain/Enums/Enums.cs:635; backend/Odip.Api/Controllers/MedicationsController.cs:664; frontend/src/pages/profile/steps/CulturalDepthConsentsStep.tsx:95,98; backend/Odip.Api/Controllers/CaregiverController.cs:17-24

**Why here.** Two consent records for the same decision with no cross-check, and consent changes arriving over a forwardable token, are exactly what a Commission auditor pulls on first.

---

### S-20 — Roster check for participant-specific health-condition training requirements

**Stakeholders:** Clinical, Coordinator · **Size:** M · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** — · **Extends:** — · **Sources:** CLIN-5

**Problem.** ParticipantHealthCondition.TrainingRequired (backend/Odip.Domain/Entities/ParticipantHealthCondition.cs:71-72) is read only by its own CRUD controller. RosterConflictService.CheckCompetencyMissing (RosterConflictService.cs:186-218) compares only IsOvernightEligible/IsManualHandlingCompetent/IsFirstAidQualified against generic participant flags; there is no staff-side per-condition competency and no rule. Platform Plan/04-modules.md M2 names 'missing competency for a participant's needs — e.g. PEG, epilepsy' as a required hook.

**Proposal.** Add a StaffConditionCompetency join (User + HealthConditionType, with expiry) and a CheckConditionCompetencyMissing rule firing Warning (Blocking for high-risk conditions such as Epilepsy/Dysphagia) when the shift's participant has TrainingRequired=true and the assigned staff has no matching competency.

**Evidence.** backend/Odip.Domain/Rostering/Services/RosterConflictService.cs:186-218; backend/Odip.Domain/Entities/ParticipantHealthCondition.cs:71-72; Platform Plan/04-modules.md (M2)

**Why here.** M2 already names PEG/epilepsy competency as a required roster hook; TrainingRequired is captured and never checked, so an untrained worker can be rostered without warning.

---

### S-21 — Cross-entity audit log search page, with ChangedById exposed alongside ChangedByName

**Stakeholders:** SysAdmin, QSC Auditor · **Size:** M · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** S-1 · **Extends:** — · **Sources:** SEC-2, QSC-7

**Problem.** AuditController exposes only GET /api/v1/audit/{entityType}/{entityId} (backend/Odip.Api/Controllers/AuditController.cs:35-100) and the sole consumer is AuditHistoryTab inside detail pages (frontend/src/components/AuditHistoryTab.tsx; frontend/src/api/hooks/audit.ts:26-37) — an investigator must already know the entity type and GUID. There is no 'everything User X changed this week' or 'every Deleted action this month' query. Additionally, AuditLog already stores ChangedById (backend/Odip.Domain/Entities/AuditLog.cs:12) but the controller projects only ChangedByName (AuditController.cs:78,88), so a renamed/merged staff account (see StaffUserUnification migration) cannot be resolved back to a current user from the API response.

**Proposal.** Add a paginated GET /api/v1/audit with filters (entityType, changedById, action, date range) and include ChangedById in both the per-entity and list projections. Add a standalone Audit Log page under Settings (Admin/SuperAdmin) with those filters and CSV export. Reuses the existing AuditLog table and allowlist — query/UI gap only.

**Evidence.** backend/Odip.Api/Controllers/AuditController.cs:35-100 (esp. :43-55, :78, :88); backend/Odip.Domain/Entities/AuditLog.cs:12-13; frontend/src/api/hooks/audit.ts:26-37; frontend/src/components/AuditHistoryTab.tsx

**Why here.** An audit log you can only read per-GUID cannot answer an investigator's actual questions; query and page only, after S-1 makes the table worth searching.

---

### S-22 — Trip task-checklist templates instantiated on trip create

**Stakeholders:** Coordinator · **Size:** M · **Priority:** P2 · **Stage:** Stage 4 · **Depends on:** — · **Extends:** — · **Sources:** COORD-4

**Problem.** TaskType names ten recurring trip-prep categories (backend/Odip.Domain/Enums/Enums.cs:197-212) but only two are ever auto-created: InsuranceConfirmation per booking (BookingsAccommodationController.cs:120-136) and GenerateNdisClaims on Completed (TripsController.cs:263-288). Risk review, medication check, family contact, pre-departure and post-trip tasks are re-typed by hand per trip via TaskCreatePage/TasksTab (TasksTab.tsx:4).

**Proposal.** A tenant-scoped TripTaskTemplate (optionally keyed by EventTemplateId) of ordered {TaskType, Title, DaysBeforeStartDate, DefaultPriority} rows, instantiated as BookingTasks on TripsController.Create or via an 'Apply checklist' button, with DueDate from StartDate. Seed one default template covering the ten TaskTypes; a template editor (SupportCatalogueItem settings-page pattern) is a follow-on.

**Evidence.** backend/Odip.Domain/Enums/Enums.cs:197-212; backend/Odip.Api/Controllers/BookingsAccommodationController.cs:120-136; backend/Odip.Api/Controllers/TripsController.cs:263-288; frontend/src/pages/trip-detail/TasksTab.tsx:4

**Why here.** Retyping the same prep checklist per trip is real coordinator toil but purely convenience; a seeded default template is a good Stage 4 leverage item.

---

### S-23 — 'Assigned to me' task filter and dashboard scoping on the existing ownerId API

**Stakeholders:** Coordinator · **Size:** S · **Priority:** P2 · **Stage:** Stage 4 · **Depends on:** — · **Extends:** F-13 · **Sources:** COORD-7

**Problem.** TasksController.GetAll already accepts ownerId and dueThisWeek (backend/Odip.Api/Controllers/TasksDashboardController.cs:32-45) but neither DashboardPage nor TasksPage passes the current user's id; the dashboard's Overdue Tasks panel (frontend/src/pages/DashboardPage.tsx:285-327) shows the whole tenant's tasks. F-13's work-surface list does not include this personalisation.

**Proposal.** Add a default 'Assigned to me' toggle (ownerId=currentUserId) to TasksPage's filter bar, and either scope the dashboard Overdue Tasks panel to the signed-in user with a 'view all' escape or add a 'My tasks due today' tile beside Outstanding Tasks (DashboardPage.tsx:151-155).

**Evidence.** backend/Odip.Api/Controllers/TasksDashboardController.cs:32-45; frontend/src/pages/DashboardPage.tsx:151-155,285-327; frontend/src/pages/TasksPage.tsx

**Why here.** The ownerId filter already exists server-side, so this is a one-toggle personalisation that slots into F-13's first increment.

---

### S-24 — Behaviour Support Plan register replacing checkbox-only BSP tracking

**Stakeholders:** Clinical, QSC Auditor · **Size:** M · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** S-3 · **Extends:** — · **Sources:** CLIN-3

**Problem.** No BehaviourSupportPlan entity exists under backend/Odip.Domain/Entities. BspInPlace is a chemical-restraint-only bool on ParticipantMedication (ParticipantMedication.cs:61); bspPlanProvided/bocChartProvided/ridsLogged are tri-state toggles with no linked record (ParticipantBehaviourCommunicationSection.tsx:38,48); the five RestrictivePracticeType categories (Enums.cs:647-654) have no BSP linkage except chemical restraint. The practitioner tracks real plans outside ODIP.

**Proposal.** Narrow S-24 to only the genuinely missing piece: add a BehaviourSupportPlan entity (ParticipantId FK, Status enum e.g. Draft/Active/Expired/Superseded, EffectiveDate, ReviewDate, ProactiveStrategies text, ReactiveStrategies text, AuthoredBy, optional document link via F-4) and a nullable BehaviourSupportPlanId FK on RestrictivePractice (mirroring the existing RelatedMedicationId pattern) so any restrictive practice, not just chemical restraint, can cite the plan that authorises it. Replace the three unlinked tri-state toggles (bspPlanProvided, bocChartProvided, ridsLogged) in ParticipantBehaviourCommunicationSection.tsx with a derived/linked view once a BehaviourSupportPlan record exists for the participant. Do NOT propose a new "BSP tab" or new review-date alerting — RestrictivePracticesTab.tsx and the restrictive-practice-review-overdue alert in ParticipantAlertsService.cs already deliver the register UI and overdue-review alerting the original proposal called for; extend those existing surfaces (e.g. show linked BSP status/reviewDate inside RestrictivePracticesTab, add a parallel "bsp-review-overdue" alert type) rather than building parallel ones.

**Evidence.** backend/Odip.Domain/Entities/ParticipantMedication.cs:61; frontend/src/pages/participant-detail/ParticipantBehaviourCommunicationSection.tsx:38,48; backend/Odip.Domain/Enums/Enums.cs:647-654; backend/Odip.Domain/Entities (no BehaviourSupportPlan)

**Why here.** Narrowed to one entity plus an FK on RestrictivePractice, it lets any restrictive practice cite the plan authorising it, which the RP register (S-3) cannot evidence today.

**Already partly built.** The persona's premise is stale/overstated. A RestrictivePractice register entity already exists (backend/Odip.Domain/Entities/RestrictivePractice.cs:20-47) with ParticipantId FK, Type (all 5 RestrictivePracticeType values, not just chemical restraint), Description, AuthorisedBy, AuthorisationDate, ReviewDate, IsActive, and an optional RelatedMedicationId link for chemical restraint specifically. This is CRUD-backed by backend/Odip.Api/Controllers/RestrictivePracticesController.cs and DTOs in backend/Odip.Application/DTOs/RestrictivePracticeDTOs.cs, and surfaced on the participant detail page as a full tab: frontend/src/pages/participant-detail/RestrictivePracticesTab.tsx (single-entry and bulk-create UI, DataTable list, review-overdue badge via isReviewOverdue at line 74), wired via frontend/src/api/hooks/restrictive-practices.ts and frontend/src/api/types/restrictive-practices.ts.

Review-date alerting the proposal asks for also already exists: backend/Odip.Infrastructure/Services/ParticipantAlertsService.cs:17-18 documents a "restrictive-practice-review-overdue" (Warning) alert, and lines 109-117 implement it as a query over RestrictivePractices where IsActive && ReviewDate < today, for every RestrictivePracticeType (not chemical-restraint-only) — covered by backend/Odip.Tests/Alerts/ParticipantAlertsServiceTests.cs.

So the persona's claim "the five RestrictivePracticeType categories have no BSP linkage except chemical restraint" is incorrect for authorisation/review tracking — RestrictivePractice.AuthorisedBy/AuthorisationDate/ReviewDate already apply uniformly to all 5 types, and RelatedMedicationId is the only type-specific field (chemical restraint only, as documented in the class's own XML comment lines 35-39).

What genuinely is still missing: there is no dedicated BehaviourSupportPlan entity distinct from RestrictivePractice — no plan status (draft/active/expired), no effective/review-date pair separate from a specific restrictive-practice authorisation, no proactive/reactive strategy content fields, and no document-link field (grep for "BehaviourSupportPlan" across backend/Odip.Domain and backend/Odip.Infrastructure/Migrations returns zero entity/migration hits — only frontend labels and unrelated matches). ParticipantBehaviourCommunicationSection.tsx:38,48 still holds bspPlanProvided/bocChartProvided/ridsLogged as free-standing tri-state toggles (YES_NO_UNANSWERED) with no FK to any plan record, confirmed at frontend/src/pages/participant-detail/ParticipantBehaviourCommunicationSection.tsx lines 38, 48, 61, 79, 125-131, 158-160.

---

### S-25 — Audit trail for SuperAdmin view-as impersonation sessions

**Stakeholders:** SysAdmin, Owner · **Size:** M · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** S-21 · **Extends:** — · **Sources:** SEC-1

**Problem.** CurrentTenant builds the X-View-As-Tenant/X-View-As-User override purely from request headers in memory with no logging or DB write (backend/Odip.Infrastructure/Services/CurrentTenant.cs:12-63). Mutations made while impersonating get an AuditLog row attributed to the SuperAdmin's real JWT identity (AuditInterceptor.cs:44-56) with no marker that it happened via view-as; read access while impersonating leaves no trace at all. Nobody can answer 'who looked at or changed tenant X's data via impersonation, and when'.

**Proposal.** Write a ViewAsSessionLog row (SuperAdminId, target TenantId, optional ViewAsUserId, timestamp, request path) whenever CurrentTenant resolves a non-null view-as header, and stamp an ImpersonatedBy/ViaViewAs field on AuditLog rows created while an override is active (sourced from CurrentTenant, not only the JWT). Surface both in the audit search page from S-21.

**Evidence.** backend/Odip.Infrastructure/Services/CurrentTenant.cs:12-63; backend/Odip.Infrastructure/Audit/AuditInterceptor.cs:44-56

**Why here.** Untraceable impersonation is a privacy-law problem, but it touches one actor and needs S-21's page to be visible, so it follows the audit search work.

---

### S-26 — Per-account login lockout alongside the IP-based limiter

**Stakeholders:** SysAdmin · **Size:** S · **Priority:** P1 · **Stage:** Stage 1 · **Depends on:** — · **Extends:** — · **Sources:** SEC-8

**Problem.** AuthController's brute-force key is IP/TraceIdentifier only (backend/Odip.Api/Controllers/AuthController.cs:56-75,328-329), deliberately to spare shared office IPs; Program.cs:238-256 notes the 'login' policy is flood control, not brute-force defence. Rotating-IP credential stuffing against one Admin/SuperAdmin account is therefore unlimited and unalerted.

**Proposal.** Add a secondary per-account (resolved email) failure counter with a conservative threshold and lockout window plus an operator-alertable log line, additive to the IP-based control.

**Evidence.** backend/Odip.Api/Controllers/AuthController.cs:56-75,328-329; backend/Odip.Api/Program.cs:238-256

**Why here.** Rotating-IP stuffing against one Admin account is currently unlimited; a second counter keyed on email is small and additive to the existing tracker.

---

### S-27 — Public self-service complaint/feedback intake feeding F-1's register

**Stakeholders:** Family · **Size:** M · **Priority:** P1 · **Stage:** Stage 3 · **Depends on:** F-1 · **Extends:** F-1 · **Sources:** FAM-5

**Problem.** F-1's register scopes ReceivedVia to phone/in-person/email/anonymous — staff-keyed only. The caregiver wizard's steps are entirely profile sections (CaregiverWizardPage.tsx:93-101) and a repo-wide grep for 'complaint' finds no backend files, so a family member has no in-product way to raise a concern.

**Proposal.** Once F-1's Complaint entity exists, add an always-live public intake route (not single-use, not participant-token-bound) creating a Complaint with a Family/self-reported source, reusing CaregiverController's no-auth, rate-limited, generic-404 pattern.

**Evidence.** frontend/src/pages/caregiver/CaregiverWizardPage.tsx:93-101; docs/specs/2026-09-06-odip-ux-audit-and-feature-suggestions.md (F-1 ReceivedVia); backend (no 'complaint' matches)

**Why here.** The Commission expects an accessible complaints channel for participants and families; it cannot exist until F-1's entity does, so it trails Stage 1.

---

### S-28 — Behaviour-of-concern evidence: structured ABC incident fields and a PRN/behaviour trend view

**Stakeholders:** Clinical · **Size:** M · **Priority:** P2 · **Stage:** Stage 4 · **Depends on:** S-24 · **Extends:** — · **Sources:** CLIN-7, CLIN-6

**Problem.** IncidentReport uses the same Description/ImmediateActionsTaken/WitnessNames fields for every IncidentType (IncidentReport.cs:90-96) including BehaviourOfConcern (Enums.cs:253-266) — no antecedent, topography, duration, intensity or consequence fields, unlike the dedicated IncidentInjury collection (:111) and RestrictivePractice fields (:46-60). PrnReason/PrnOutcome/PrnOutcomeAt exist per dose (MedicationAdministration.cs:84-86) but ReportTab.tsx is a flat row list with no aggregation, so BSP/PRN effectiveness and restrictive-practice-reduction evidence is reconstructed by hand.

**Proposal.** (1) BehaviourOfConcern-conditional fields (Antecedent, BehaviourDescription, Duration, IntensityRating, ConsequenceOrResponse) in the incident create/edit flow, on IncidentReport or an IncidentBehaviourDetail child. (2) A participant-scoped trend chart (PRN doses per week by indication joined to BehaviourOfConcern incidents by date) on participant detail or as a MedicationsPage tab.

**Evidence.** backend/Odip.Domain/Entities/IncidentReport.cs:46-60,90-96,111; backend/Odip.Domain/Enums/Enums.cs:253-266; backend/Odip.Domain/Entities/MedicationAdministration.cs:84-86; frontend/src/pages/medications/ReportTab.tsx

**Why here.** Structured ABC data and PRN trends are the evidence base for RP reduction, valuable once the BSP register (S-24) gives them something to attach to.

---

### S-29 — Outbound notification channel (email/SMS/web push) for workers and families

**Stakeholders:** Field Support Worker, Family · **Size:** L · **Priority:** P2 · **Stage:** Stage 4 · **Depends on:** — · **Extends:** — · **Sources:** FSW-8, FAM-1

**Problem.** There is no notification-sending mechanism anywhere in the backend — a grep for IEmailService/SendEmail/SmsService/INotificationService returns zero files — and no push/service-worker/Notification API usage under frontend/src. Workers learn of new witness requests only via a 60s in-app poll while the portal is open (frontend/src/api/hooks/portal.ts:60-66); families are never contacted by the system about anything, so IncidentReport.FamilyNotified is an unverifiable manual tick (S-7).

**Proposal.** Build a minimal notification service (email/SMS to a ParticipantContactRole; web push or a polling service worker for staff) gated behind the CSP constraints in Program.cs, starting with two consumers: new witness requests / next-shift changes for workers, and incident family-notification for the participant's primary contact (which auto-stamps FamilyNotifiedAt).

**Evidence.** frontend/src/api/hooks/portal.ts:60-66; backend (no IEmailService/SmsService/INotificationService found); backend/Odip.Domain/Entities/IncidentReport.cs:135-139; backend/Odip.Api/Controllers/IncidentsController.cs:476-477

**Why here.** A real notification channel is L-sized new infrastructure with CSP implications; worth it, but the 60s poll and manual family tick are tolerable until the Stage 4 leverage work.

---

### S-30 — Booking cancellation cleanup: auto-cancel linked tasks, prompt waitlist promotion, release capacity

**Stakeholders:** Coordinator · **Size:** M · **Priority:** P2 · **Stage:** Stage 3 · **Depends on:** S-14 · **Extends:** — · **Sources:** COORD-3

**Problem.** Moving a ParticipantBooking to Cancelled/NoLongerAttending triggers only RecalculateStaffRequired (backend/Odip.Api/Controllers/BookingsAccommodationController.cs:77-97). Its BookingTasks (auto InsuranceConfirmation plus manual ones linked via ParticipantBookingId, BookingTask.cs:13-14) stay open with no flag or filter; no Waitlist handling exists outside display code; freed accommodation/vehicle capacity is not signalled. The only cancel-on-delete pattern (TasksDashboardController.cs:122-129) is not reused.

**Proposal.** On the transition in BookingsAccommodationController.Update/Patch (:178-253): soft-cancel that booking's open BookingTasks; if the trip has Waitlist bookings, show a 'spot opened — N on waitlist' prompt on BookingsTab; feed the vacated headcount/wheelchair seat back into S-14's capacity check.

**Evidence.** backend/Odip.Api/Controllers/BookingsAccommodationController.cs:77-97,178-253; backend/Odip.Domain/Entities/BookingTask.cs:13-32; backend/Odip.Api/Controllers/TasksDashboardController.cs:122-129

**Why here.** Orphaned tasks and unfilled waitlist spots are operational leakage rather than risk, and the capacity release half only means something once S-14 enforces capacity.

---

### S-31 — Caregiver submission workflow: per-field accept, regenerate-link guard, and distinct revoked/accepted end states

**Stakeholders:** Coordinator, Family · **Size:** M · **Priority:** P2 · **Stage:** Stage 3 · **Depends on:** — · **Extends:** — · **Sources:** COORD-6, FAM-2, FAM-3

**Problem.** Review is all-or-nothing: CaregiverSubmissionReviewPage offers only Accept-all or Reject-all (frontend/src/pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx:19-38) though computeCaregiverDiff (frontend/src/lib/caregiverDiff.ts) already produces per-field rows. CreateLink unconditionally revokes every Draft-or-Submitted submission (backend/Odip.Api/Controllers/CaregiverSubmissionsController.cs:64-68) and the 'Regenerate caregiver link' control has no confirm (ParticipantDetailPage.tsx:310-336), silently destroying in-progress or awaiting-review work. ResolveLiveAsync matches only Draft/Submitted (CaregiverController.cs:44-52, 404 at :74), so both a revoked link and an accepted submission show the same generic InvalidLinkPage (CaregiverWizardPage.tsx:156,232-252) — acceptance gives the family silence.

**Proposal.** Narrow (1) to: add per-row checkboxes to the existing DiffRow list in CaregiverSubmissionReviewPage.tsx (data already computed via computeCaregiverDiff — no diff-layer work needed), thread a selected-field-id set through useAcceptCaregiverSubmission into a new/extended accept request, and have CaregiverSubmissionsController.cs Accept (or a new endpoint) filter the deserialized PatchParticipantDto to only the selected fields before calling ParticipantPatchApplier.ApplyAsync, then mark the submission with a "partially applied" indicator (e.g. a note or status flag) rather than plain Accepted. Parts (2) and (3) of the original proposal stand unchanged — no existing code addresses either.

**Evidence.** frontend/src/pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx:10-38; frontend/src/lib/caregiverDiff.ts; backend/Odip.Api/Controllers/CaregiverSubmissionsController.cs:64-68; frontend/src/pages/ParticipantDetailPage.tsx:310-336; backend/Odip.Api/Controllers/CaregiverController.cs:44-74; frontend/src/pages/caregiver/CaregiverWizardPage.tsx:156,232-252

**Why here.** The regenerate-link confirm and distinct accepted/revoked states are cheap and stop silent loss of family-submitted work; per-field accept is the M-sized part and can trail.

**Already partly built.** Verified all three sub-claims against code:
(1) Per-field accept: FALSE gap confirmed but partially — CaregiverSubmissionReviewPage.tsx:31-35,82-88 already renders per-field DiffRow data from computeCaregiverDiff, but accept is still all-or-nothing: the Accept button (lines 60-62, 95-107) calls useAcceptCaregiverSubmission with no per-row selection, and backend Accept (CaregiverSubmissionsController.cs:149-170) applies the whole payload via ParticipantPatchApplier with no field subset param. No partial-accept UI or API exists anywhere (checked CaregiverSubmissionsController.cs in full, no per-field endpoint).
(2) Regenerate-link guard: gap confirmed — CreateLink (CaregiverSubmissionsController.cs:59-86) unconditionally revokes all Draft/Submitted rows (lines 64-68) with no check for whether a Submitted (awaiting-review) submission exists. Frontend regenerate button (ParticipantDetailPage.tsx:310-326) has a raw onClick with no ConfirmDialog — notably this is inconsistent with the same file's Accept/Reject flows in CaregiverSubmissionReviewPage.tsx, which DO use ConfirmDialog (lines 95-107) and a required note (109-137), so the missing confirm on regenerate is a real, isolated gap, not an oversight already fixed elsewhere.
(3) Distinct revoked/accepted end states: gap confirmed — ResolveLiveAsync (CaregiverController.cs:44-68) matches only Draft/Submitted and returns null otherwise, causing Get (line 74) to 404 for Revoked, Accepted, and Expired alike; grepped frontend caregiver pages for "Accepted|Revoked" with zero matches, confirming CaregiverWizardPage has no distinct terminal-state UI.
So parts 2 and 3 of the proposal are fully valid as-is (nothing already built). Part 1 is partially built: the diff/data layer already exists (computeCaregiverDiff, DiffRow grouping/rendering) — only the selection UI and the accept-subset plumbing (checkbox state, mutation payload restriction, partial-apply backend logic) are missing.

---

### S-32 — Business performance dashboard: revenue pipeline by stream, outstanding-claims aging, and per-tenant comparison

**Stakeholders:** Owner, Finance · **Size:** M · **Priority:** P2 · **Stage:** Stage 4 · **Depends on:** S-18, S-13 · **Extends:** — · **Sources:** OWNER-1, FIN-8, OWNER-5

**Problem.** DashboardSummaryDto has zero currency fields (backend/Odip.Application/DTOs/DTOs.cs:1682; GetSummary at TasksDashboardController.cs:363-436 has no $ aggregation); BillingPage is three CRUD tabs with no rollup (frontend/src/pages/BillingPage.tsx:73-107); totals exist only per record (ClaimBatchDetailPage.tsx:139, ClaimDetailPage.tsx:136). 04-modules.md:73 specs a 'revenue dashboard per stream … aging' and PRODUCT.md:17 lists revenue oversight as an Admin duty — no aging/revenue view exists in code. TripClaim.SubmittedDate and ClaimLineItem.Status/PaidAmount already support a basic aging view. For multi-site owners, TenantsController.GetAll returns only Name/EmailDomain/IsActive/CreatedAt/user-count (TenantsController.cs:14-33), forcing view-as impersonation to compare sites.

**Proposal.** A Revenue page/tab backed by an aggregation endpoint grouping BillableEvent by IncomeStream and Status over a period (delivered-not-billed, billed-not-paid, paid) plus an outstanding-claims list bucketed 0-30/31-60/61-90/90+ days by payer type (start with TripClaims; extend to BillableEvent once S-13 gives non-agency events a paid lifecycle). MTD/QTD tiles on DashboardPage gated by a permissions check. Extend /admin/tenants (or a sibling summary) with per-tenant active participants, upcoming trips, open incidents and MTD revenue as a comparison table.

**Evidence.** backend/Odip.Application/DTOs/DTOs.cs:1682; backend/Odip.Api/Controllers/TasksDashboardController.cs:363-436; frontend/src/pages/BillingPage.tsx:73-107; frontend/src/pages/ClaimBatchDetailPage.tsx:139; frontend/src/pages/ClaimDetailPage.tsx:136; Platform Plan/04-modules.md:73; PRODUCT.md:17,44; backend/Odip.Api/Controllers/TenantsController.cs:14-33

**Why here.** Revenue-by-stream and aging are only trustworthy after S-18 gives one ledger and S-13 gives non-agency events a paid lifecycle; owner-facing leverage for Stage 4.

---

### S-33 — Staff and vehicle utilisation reporting

**Stakeholders:** Owner, Coordinator · **Size:** M · **Priority:** P2 · **Stage:** Stage 4 · **Depends on:** F-8 · **Extends:** F-8 · **Sources:** OWNER-3, OWNER-4

**Problem.** StaffPage's only columns are qualification flags (frontend/src/pages/StaffPage.tsx:43-82) — no rostered/worked hours, overtime or under-rostering view; Shift has only planned StartTime/EndTime/DurationHours (RosteringEntities.cs:45-95) until F-8 adds actuals. VehiclesPage shows only aggregate 'Total Fleet Capacity'/'Wheelchair Positions'/'Accessible Vehicles' tiles (VehiclesPage.tsx:234-249) though VehicleAssignments are already queryable per vehicle (TasksDashboardController.cs:401-403) — idle vs over-booked vehicles cannot be identified.

**Proposal.** A Staff Utilisation report (rostered vs post-F-8 actual hours per staff per week/pay period, bar/heatmap, CSV) and a per-vehicle 'trip-days booked this quarter / days in fleet' column or sparkline on VehiclesPage with a utilisation-by-vehicle chart from VehicleAssignment.

**Evidence.** frontend/src/pages/StaffPage.tsx:43-82; backend/Odip.Domain/Rostering/RosteringEntities.cs:45-95; frontend/src/pages/VehiclesPage.tsx:234-249; backend/Odip.Api/Controllers/TasksDashboardController.cs:401-403

**Why here.** Utilisation needs actual hours from F-8 to mean anything for staff; the vehicle half could ship earlier but neither protects money or compliance directly.

---

### S-34 — Participant pipeline and churn-risk report

**Stakeholders:** Owner · **Size:** M · **Priority:** P2 · **Stage:** Stage 4 · **Depends on:** F-11 · **Extends:** F-11 · **Sources:** OWNER-7

**Problem.** Platform Plan/04-modules.md:8 describes an enquiry → prospective → active funnel but Participant has only IsActive/IsDraft; Enums.cs has no ParticipantStatus/IntakeStage (BookingStatus.Enquiry at :97-106 is per-booking). No view shows conversion volume or active participants whose plan is ending with no forward booking; BillingPage.tsx:115 filters only on isDraft.

**Proposal.** Same proposal, with one factual correction: join the 'lapsing soon' list against Participant.PlanEndDate directly (not FundingSource.PlanEndDate, which doesn't exist) and the existing plan-expiring-soon alert logic in ParticipantAlertsService.cs as a starting point, extended with a query for participants with no Booking whose date falls after PlanEndDate. The draft/active-counts-over-time part is entirely new — no historical snapshot data exists, so this would need either a new time-series snapshot job or a re-scoping to 'current counts only' if historical trending isn't wanted.

**Evidence.** Platform Plan/04-modules.md:8; backend/Odip.Domain/Enums/Enums.cs:97-106; frontend/src/pages/BillingPage.tsx:115

**Why here.** The 'plan ending with no forward booking' list is a useful churn signal on top of F-11's alerts, but the historical funnel needs a snapshot job that does not exist.

---

### S-35 — Nominee-facing read-only plan funding summary

**Stakeholders:** Family · **Size:** M · **Priority:** P2 · **Stage:** Later · **Depends on:** F-11 · **Extends:** F-11 · **Sources:** FAM-6

**Problem.** ParticipantContactRole models PlanNominee (NomineeScope, AppointmentDate) as distinct from Guardian, yet all plan/funding fields are in CaregiverFieldPolicy's InternalFields (backend/Odip.Infrastructure/Services/CaregiverFieldPolicy.cs) and ParticipantNdisFundingSection.tsx has no remaining/balance computation. The person legally responsible for the plan learns funding is low only when a service is refused.

**Proposal.** After F-11, expose a narrow summary (percent remaining, days to plan end — no line items) via a nominee-specific link separate from the edit-oriented caregiver token, so CaregiverFieldPolicy's boundary is not reopened.

**Evidence.** backend/Odip.Domain/Entities/ParticipantContactRole.cs; backend/Odip.Infrastructure/Services/CaregiverFieldPolicy.cs; frontend/src/pages/participant-detail/ParticipantNdisFundingSection.tsx

**Why here.** A nominee-facing balance requires F-11's burn-down and a second external token mechanism; good idea, beyond the current horizon.

---

### S-36 — Integration / background-job health panel

**Stakeholders:** SysAdmin · **Size:** M · **Priority:** P2 · **Stage:** Stage 4 · **Depends on:** — · **Extends:** — · **Sources:** SEC-7

**Problem.** HolidaySyncBackgroundService reports failures only via ILogger (backend/Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs:62-75) with no persisted run history or admin-facing status. PRODUCT.md:24 names eight satellite systems and Platform Plan/04-modules.md:83 specs central 'integration failures' alerting with owner/snooze/ack — none exists even for the one integration wired today.

**Proposal.** Persist the last N sync results (outcome, counts, errors) from IPublicHolidaySyncService and add a Settings 'Integrations' panel showing last-run status per integration, as the template PRODA/Firebase health checks plug into later.

**Evidence.** backend/Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs:55-76; PRODUCT.md:24; Platform Plan/04-modules.md:83

**Why here.** One integration exists today and a failed holiday sync is low-consequence; build the panel when PRODA/Firebase health checks give it more than one row.

---

### S-37 — Tenant offboarding: cascade user deactivation and a pre-deactivation data export

**Stakeholders:** SysAdmin, Owner · **Size:** M · **Priority:** P2 · **Stage:** Later · **Depends on:** — · **Extends:** — · **Sources:** SEC-9

**Problem.** TenantsController.Update only flips Tenant.IsActive (backend/Odip.Api/Controllers/TenantsController.cs:150-165), leaving every User row IsActive=true and Firebase accounts enabled; login is blocked at tenant lookup (AuthController.cs:140-141) so re-activation silently re-enables all users with no review. No export of a tenant's participants/trips/claims/documents exists. PRODUCT.md:46 names onboarding a real second tenant as the next strategic step.

**Proposal.** A 'deactivate tenant' action that also deactivates that tenant's Users (syncing Disabled=true via IFirebaseUserService) and a JSON/CSV export bundle of the tenant's core tables runnable before deactivation.

**Evidence.** backend/Odip.Api/Controllers/TenantsController.cs:23-165; backend/Odip.Api/Controllers/AuthController.cs:140-141; PRODUCT.md:46

**Why here.** Cascade deactivation and export matter only once a second tenant is live and later leaves; PRODUCT.md puts second-tenant onboarding as the next step, so this is Later.

---

### S-38 — Trip/shift cost capture and planned-vs-actual margin

**Stakeholders:** Owner · **Size:** L · **Priority:** P2 · **Stage:** Later · **Depends on:** F-8, F-7 · **Extends:** — · **Sources:** OWNER-2

**Problem.** Revenue is modelled (BillableEvent) but no cost side exists: StaffAssignment has no rate (backend/Odip.Domain/Entities/StaffAssignment.cs:8-28), Shift has DurationHours but no cost (RosteringEntities.cs:45-95), VehicleListDto has no cost field (VehiclesPage.tsx). Platform Plan/04-modules.md:39 (M5) specifies 'Trip P&L: planned vs actual costs … vs revenue' and it was never built, so margin per trip type/destination is invisible even in principle.

**Proposal.** Add PayRate (or rate-by-role) on User/Staff and cost-per-day/per-km on Vehicle; compute per-trip cost from StaffAssignment.AssignmentStart/End × rate plus vehicle and AccommodationReservation costs; show planned-vs-actual cost against BillableEvent revenue on TripDetailPage.

**Evidence.** backend/Odip.Domain/Entities/StaffAssignment.cs:8-28; backend/Odip.Domain/Rostering/RosteringEntities.cs:45-95; frontend/src/pages/VehiclesPage.tsx; Platform Plan/04-modules.md:39

**Why here.** Trip P&L needs a whole cost model (pay rates, vehicle costs, accommodation) plus F-8 actuals; strategically valuable but the largest and least urgent item here.

---

## 5. Roadmap slotting

### Stage 1

- **S-1** — Extend audit-log coverage to financial, restrictive-practice/consent and tenant-configuration entities
- **S-2** — Automated, off-host backups of the production database and documents volume
- **S-3** — Tenant-wide restrictive-practices register page with NDIS Commission usage-report export
- **S-4** — Surface allergy/anaphylaxis, active restrictive practices and behaviour & communication data on the portal shift screen
- **S-5** — Witness approvals: confirm before medication Approve and show the full incident report before attestation
- **S-7** — Family-notification deadline on incidents, parallel to the QSC clock
- **S-10** — Worker-screening verification metadata (VerifiedAt / VerifiedBy / clearance document)
- **S-11** — Least-privilege RBAC: split bank details from coordinator-readable settings now; add Finance, Clinical and Owner roles
- **S-12** — Tenant-wide compliance worklist, with restrictive-practice review-overdue escalated and aggregated
- **S-26** — Per-account login lockout alongside the IP-based limiter

### Stage 2

- **S-6** — Apply F-5's date-effective catalogue lookup to ClaimGenerationService as well as BillingValidator
- **S-8** — Duplicate-participant detection on intake and manual create
- **S-9** — Claim status truthfulness: 'mark batch submitted' endpoint and PartiallyPaid auto-promotion
- **S-13** — Give plan-/self-managed, private and B2B billable events an invoice route, and keep them out of the PRODA batch builder
- **S-18** — Decide and unify the two disconnected claim pipelines so one ledger holds claimed amounts

### Stage 3

- **S-14** — Enforce trip headcount and wheelchair-seat capacity
- **S-15** — Record a medication dose directly from the portal shift screen
- **S-16** — Portal navigation: role-branch the home route to /portal and link the shift screen to the full participant record
- **S-17** — F-9 scope: retrofit offline queueing onto the already-shipped shift-note and witness approve/decline writes first
- **S-19** — Consent record integrity: reconcile medication-level consent with the ParticipantConsent register, and reconfirm consent changes made via the caregiver link
- **S-20** — Roster check for participant-specific health-condition training requirements
- **S-21** — Cross-entity audit log search page, with ChangedById exposed alongside ChangedByName
- **S-24** — Behaviour Support Plan register replacing checkbox-only BSP tracking
- **S-25** — Audit trail for SuperAdmin view-as impersonation sessions
- **S-27** — Public self-service complaint/feedback intake feeding F-1's register
- **S-30** — Booking cancellation cleanup: auto-cancel linked tasks, prompt waitlist promotion, release capacity
- **S-31** — Caregiver submission workflow: per-field accept, regenerate-link guard, and distinct revoked/accepted end states

### Stage 4

- **S-22** — Trip task-checklist templates instantiated on trip create
- **S-23** — 'Assigned to me' task filter and dashboard scoping on the existing ownerId API
- **S-28** — Behaviour-of-concern evidence: structured ABC incident fields and a PRN/behaviour trend view
- **S-29** — Outbound notification channel (email/SMS/web push) for workers and families
- **S-32** — Business performance dashboard: revenue pipeline by stream, outstanding-claims aging, and per-tenant comparison
- **S-33** — Staff and vehicle utilisation reporting
- **S-34** — Participant pipeline and churn-risk report
- **S-36** — Integration / background-job health panel

### Later

- **S-35** — Nominee-facing read-only plan funding summary
- **S-37** — Tenant offboarding: cascade user deactivation and a pre-deactivation data export
- **S-38** — Trip/shift cost capture and planned-vs-actual margin

---

## 6. Dropped

### Merged before ranking (restated an existing audit finding)

- **QSC-2** — Restates F-2: the audit's F-2 Shape already specifies a new AwareAt field ('awareness time, not incident time, is what the clock runs from') and both the 24h and 5-business-day deadlines computed from it. QSC-2's only contribution is the evidence that today's IsOverdue24h uses CreatedAt (backend/Odip.Api/Controllers/IncidentsController.cs:182-184,623-658; IncidentReport.cs:122-125) — carry those citations into F-2's implementation notes rather than tracking a separate item.
- **QSC-4** — Restates F-4: the audit's F-4 Problem already names 'no photo or witness statement on an incident report' and its Shape mounts a polymorphic <DocumentsPanel ownerType ownerId /> on incident detail. QSC-4's marginal addition (attaching to IncidentInjury/IncidentWitness child rows) is an implementation detail of the same polymorphic OwnerType/OwnerId design, not a new item; note it in F-4's scope.

### Killed by verification (already built)

- **S-17 — Consolidated trip pack / staff briefing PDF, with an optional family-facing itinerary share** — The core of the recommendation is already built: ItineraryTab.tsx has an "Export Trip Package" dropdown (frontend/src/pages/trip-detail/ItineraryTab.tsx:97-107) that calls generateItineraryPdf(itinerary, 'staff'|'participant') from frontend/src/components/ItineraryPdf.tsx. The staff version is already a single consolidated PDF containing: day-by-day itinerary (ItineraryPdf.tsx:222-282), accommodation (128-145), a vehicle roster with rego/driver (147-163, 'Vehicles' section), a staff roster with role/contact/assignment dates (165-183, 'Staff Roster' section, isStaff-gated), and a participants section with wheelchair/high-support/night-support flags plus a 'Support Notes' block per participant showing MobilityNotes + MedicalSummary (185-214). This is exactly the itinerary+roster+participant-notes bundle the recommendation proposes as a new endpoint — it already exists client-side, populated from GET trip itinerary data (backend/Odip.Api/Controllers/TripsController.cs:601-610 builds ItineraryParticipantDto with MobilityNotes/MedicalSummary only). So 'no single document bundles itinerary + attending participants' notes + staff/vehicle roster' is factually wrong — that document exists today.

What is genuinely missing: (1) the participant notes carried into the pack are limited to MobilityNotes/MedicalSummary text fields — no medications, allergies (AllergiesDetail exists as a separate field per Odip.Infrastructure/Services/ParticipantPatchApplier.cs:220 but is not selected into ItineraryParticipantDto), and no emergency contacts, unlike the richer per-participant Client Overview PDF (ParticipantDocumentComposer.cs). (2) There is no family/caregiver-facing itinerary share of any kind — confirmed no such feature exists in the searched codebase (grep for trip-pack/briefing/roster turned up only the rostering module and this itinerary export, nothing caregiver-facing).
