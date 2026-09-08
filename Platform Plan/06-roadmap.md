# 06 · Roadmap

Sequencing principle: **revenue-critical operations first** (participants → trips → billing → rostering), compliance next, new-stream modules as those streams firm up. Each phase ships something used in production — no big-bang cutover. Durations are deliberately omitted until Phase 0 sizes the build capacity (one developer alongside other duties vs full-time).

## Phase 0 · Discovery close-out & foundations

- ~~Review Z:\ documentation~~ **Done 2026-08-02** — findings and extracted rules in `09-process-findings.md`; spreadsheet/migration inventory in §7 there (confirm completeness with the team — especially anything not stored under the two Z:\ folders).
- Confirm remaining integration facts: **Brevity API existence** (ask Brevity directly — none evidenced internally), Employment Hero tier/API, Splose API scope, Budgetly export.
- Decide per-stream interim billing ownership (esp. nursing/PBS: ODIP vs Splose) and resolve the 60-vs-90-day claim-window rule against current NDIA terms.
- **Fork TripCore** → ODIP repo: rename, module re-foldering, new environments (dev/staging/prod, AU region), new Firebase project + database, CI, error tracking (per `08-tripcore-fork-plan.md` §1, §5-step-1).
- Seed import: Master Data Dictionary workbook → field registry, picklists, form templates.
- Housekeeping flagged in 09 §8 (credentials in documents, shared logins) — cheap to fix now, and per-user accounts are a precondition for meaningful audit trails.

**Exit:** confirmed integration facts, forked repo running in new environments, dictionary seeded.

## Phase 1 · Participant master + staff + documents

- M1 Participants (spine + dictionary domains, alerts, risk assessments, goals, consents).
- M2 Staff & credentials matrix.
- M11 Forms engine v1: Participant Profile, Traveller Profile, Risk Assessment, Staff Induction summary rendered from master data.
- M12 alert framework v1 (plan/credential expiries).
- **Migration:** participants from spreadsheets/Brevity/tour-booking exports; staff from Employment Hero export.

**Exit:** office staff maintain all client/staff data in ODIP only; paper forms print pre-filled.

## Phase 2 · Trips & STA operations

- M5 rebuilt on the new spine (parity with TripCore + funding plans, quote builder, activity instructions, pick-up/medication workflow, contingency).
- Trip staffing (the trips half of M4), traveller manifests, trip packs.
- **Migration:** TripCore data + historical bookings; tour-booking system retired.

**Exit:** 2026/27 season trips run end-to-end in ODIP.

## Phase 3 · Shift-to-claim loop

- **[Shift completion](../docs/specs/2026-09-08-shift-completion-design.md)**: worker Start/Finish in the portal, office review-and-approve queue, Completed shifts feed a shift-kind claim-generation path alongside the existing trip-claim path.
- **[Notifications](../docs/specs/2026-09-08-notifications-design.md)**: email first (SMS stubbed behind `INotificationChannel`), per-user per-event-type preferences.
- Revenue dashboard v1.

**Exit:** a completed shift becomes a claim line with no manual re-keying; staff and office are told when something needs them.

## Phase 4 · Agreements, budgets & money

- M3 agreements & funding → **[service agreements & plan budgets](../docs/specs/2026-09-08-service-agreements-and-budgets-design.md)**: token-link e-signed agreements (PDF snapshot + SHA-256 hash), manually-entered plan budgets per PACE category drawn down by claims; versioned rate card with NDIS pricing import.
- M10 Billing engine: trip claims + invoices first (highest pain), then community access.
- **[Integration ring 1](../docs/specs/2026-09-08-integration-framework-design.md)**: **Xero** (invoices out, payments back), **Employment Hero** timesheet CSV export, **Brevity connector v1** (inbound-only, reverse-engineered web transport, review-before-apply, until an official API exists). **PRODA bulk CSV export** for agency-managed claims.

**Exit:** every dollar across streams visible in one dashboard, no manually assembled claims/invoices; budgets visible per participant.

## Phase 5 · Field hardening & compliance

- Defect repair sweep — plan to follow; no spec.
- **[PWA offline notes](../docs/specs/2026-09-08-pwa-offline-notes-design.md)**: installable PWA, ShiftNote outbox in IndexedDB, Idempotency-Key replay for exactly-once sync.
- M9: incidents & reportables (with deadline timers), complaints register, restrictive practices register, audit evidence registers (shaped by Phase 0 policy review).
- Incident quick-capture (already in the worker portal) is upgraded to full workflow.
- M4 full rostering (recurring shifts, availability, conflicts, compliance gates, open shifts).
- Delivered-hours → billing engine linkage (community access/capacity building claims now evidence-backed).
- AI assistance (note drafting, claim anomaly flags) — deferred; revisit after Phase 5 exit.

**Exit:** ODIP is the roster master; audit-ready registers; notes survive a dead signal.

## Integration ring (standing)

- Ring 1 — **Xero**, **Employment Hero**, **Brevity** — built in Phase 4, see **[integration framework](../docs/specs/2026-09-08-integration-framework-design.md)**.
- Ring 2 — **Splose**, **Linxio**, **Budgetly** — shown as `NotConfigured` tiles on the Integrations dashboard from Phase 4, built out in Phase 6 when their streams are real.
- Every connector goes through the same connector/sync-job/ExternalRef/dashboard-status surface — no one-off integrations.

## Phase 6 · Streams build-out

- M8 Training module (mixed-payer enrolments, certificates, B2B invoicing).
- M7 Clinical thin-slice + **Splose connector (ring 2)**; PBS register & practitioner billing.
- STA standalone templates; **Linxio** and **Budgetly** connectors (ring 2, trip P&L actuals).

**Exit:** all current income streams managed and billed through the ODIP spine.

## Phase 7 · Horizon

- SIL module (when the stream is real): houses, vacancies, 24/7 rosters of care, funding apportionment.
- White-label enablement: document-pack export polish, consulting CRM-lite.
- **Productisation to multi-provider SaaS** — now planned in detail in `10-productisation.md`: dogfood gate → isolation hardening/pen test → first cohort of 3–5 holiday/STA providers → widen. During all earlier phases, enforce its config-over-code rule and cross-tenant test harness so this phase stays cheap.
- Participant/family portal (bookings, schedules, e-sign) — deliberately out of initial scope.
- Reporting warehouse/BI if dashboard needs outgrow in-app reporting.
- **PRODA/NDIA API** submission (replacing bulk-CSV upload) when NDIA opens API access; **Brevity official API** replaces the v1 web transport when available.
- AI assistance — see Phase 5 deferral.

## Risks to manage throughout

1. **Single-developer bus factor** — mitigations: boring tech, strong docs (continue the TripCore `docs/` discipline), IaC/scripted deploys, owner-accessible admin.
2. **Integration facts unknown** (Brevity/EH API access) — Brevity v1 uses a reverse-engineered web transport with response-shape fingerprinting that degrades to paused rather than corrupting data; EH is file-based. Both are replaced when official APIs exist.
3. **NDIS pricing churn** — versioned rate cards + annual import routine, never hard-coded prices.
4. **Scope gravity** — every stream is "evolving"; the spine model absorbs change, but new modules only start when a stream has real revenue and a defined process.
5. **Parallel-run fatigue** — each phase defines a hard cutover per function; avoid indefinite double-entry.
