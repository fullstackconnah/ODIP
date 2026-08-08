# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary design target: the **office coordinator** — desk-based staff running day-to-day trip logistics, participant bookings, staff/vehicle scheduling, and claims admin.

Other real roles exist in the system and must remain functional, but are not the primary design lens:
- Field Support Worker — mobile, on-location during trips, may have poor connectivity
- Nurse/Clinical — visits, clinical alerts
- Finance
- Admin/SuperAdmin — tenant switching, exceptions/revenue oversight
- ReadOnly — enforced at the middleware layer (403s on writes)

No participant/family-facing portal is in scope.

## Product Purpose

ODIP (Oassist Integrated Data Interface) is being built as the single source of truth for Oassist's NDIS trip and participant operations — participants, staff, trips/shifts, forms, agreements, and revenue entered once and pushed outward to satellite systems (Xero, Brevity, Employment Hero, PRODA, Splose, Linxio, Budgetly) rather than re-keyed across tools.

It is a fork-in-progress of an existing product called "TripCore" (upstream trip/participant/booking/claims/incident core, not Oassist's own IP), being overhauled and extended into a fuller NDIS operations platform for one specific business: Oassist (legal entity WOW TOURS Pty Ltd t/as Oassist), an NDIS-registered provider running supported holidays, group trips, and short-term accommodation (STA).

## Positioning

The product has a real differentiating mechanism relative to generic competitors (Brevity, ShiftCare, Splose): deep accommodation-led trip planning, per-traveller NDIS funding splits, trip task checklists, and post-trip claim generation — areas those tools don't model well.

That differentiation should NOT visibly shape design investment. Every module should receive consistent design effort regardless of this business differentiation — no module should be treated as more "hero" than another for that reason.

## Operating Context

Australian NDIS (disability-services) regulatory environment. Compliance is core to daily operation, not a bolt-on:
- Incident and reportable-incident workflows with 24-hour/5-day countdown timers
- A restrictive-practices register
- A complaints/feedback register
- Audit logging on every entity

Australian data residency is a stated hard requirement for participant data.

Multi-tenancy is functional and load-bearing: `Tenant`/`ITenantEntity` with query filters, plus a SuperAdmin "view as tenant/user" switching mechanism (`X-View-As-Tenant`/`X-View-As-User` headers) — not decorative, must keep working.

Currently used as an internal/dogfood tool only for Oassist itself; no external customer yet (a "dogfood first" strategy — Oassist runs a full operating season on it before any productisation/SaaS decision).

## Capabilities and Constraints

The working system already covers: Trips (create/detail/list), Participants (create/detail/list), Accommodation/Bookings (create/detail/list), Vehicles & Staff scheduling (with qualifications/expiry dashboard), Schedule, NDIS Claims (PRODA bulk-file claim generation, claim detail), Incidents (create/list, QSC reportable-status tracking), a Tasks dashboard, an Audit log, a Support Catalogue (pricing), Provider Settings, Public Holiday sync, Admin Users, Tenants management, general Settings, Auth/Login, and internal Dev tooling.

Constraints:
- A strict Content-Security-Policy is already enforced in production (`default-src 'self'`, only Firebase identity endpoints and Google Fonts permitted) — any new external asset/font/script requires a CSP policy update before it will load in prod.
- Role-based access control and the ReadOnly role's write-blocking behavior must not regress.

Open item: the product name's capitalization is inconsistent across the codebase — CLAUDE.md uses "ODIP", `index.html` uses "Odip" — and has not been resolved.

## Brand Commitments

Blank slate: no existing Oassist brand (letterhead, website, quote templates) needs to be matched. No logo exists yet (only the default Vite favicon remains).

Two concrete visual choices are already shipped in code and are real commitments, not placeholders, wired into `frontend/index.html`:
- Typefaces: **Plus Jakarta Sans** (headings, weight range 400–800) and **Manrope** (body, 400–700)
- Icon font: **Material Symbols Outlined**

The product is currently branded in the shipped app as "Odip — NDIS Trip Management" for Australian disability-services providers.

## Evidence on Hand

A real, working local dev environment exists (not aspirational):
- Frontend: `npm run dev` on Vite :5173, proxying `/api` to backend :5062 by default
- A separate local-test workflow runs the backend on :5100 via `odip-prototype/odip/local-test/run-api.ps1`, with a real local Postgres and a fake Firebase service account for auth
- `start-preview.ps1` combines a mock API + Vite for offline-ish preview

No customer testimonials, case studies, press, or third-party proof exist.

## Product Principles

- Single-source-of-truth data entry: data is entered once in ODIP and pushed outward to satellite systems, not re-keyed across tools.
- Compliance by default, not bolted on: incident timers, restrictive-practices and complaints registers, and audit logging are core system behavior, not add-ons.
- Consistent design effort across modules: no module is treated as more "hero" than another on account of competitive differentiation.
- Dogfood first: Oassist runs a full operating season on the platform internally before any productisation or SaaS decision.
- Multi-tenant-safe by construction: tenant scoping and the SuperAdmin view-as mechanism must keep working as the system evolves.