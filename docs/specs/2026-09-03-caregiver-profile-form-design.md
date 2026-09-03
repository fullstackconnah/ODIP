# Caregiver Profile Form — Design

**Date:** 2026-09-03
**Status:** Approved design, pending implementation plan
**Depends on:** core-01 `useWizard`, core-02 `PATCH /participants/{id}`, PF-10.1 allocation contract, PF-10.4 Profile wizard — all on `main`.

## Request

> Create a participant profile form that can be sent to the primary caregiver via a link. They
> see all the information, validate it is correct, and add information about the participant.
> They must enter their name before editing anything. Admins view the form before accepting the
> information. The caregiver must not have access to any information other than that particular
> client's. Secure; once submitted it cannot be edited unless an admin rejects it. Wizard format.

## Decisions (product owner, 2026-09-03)

| # | Question | Decision |
|---|---|---|
| 1 | Field scope | **Profile fields minus an internal/clinical exclusion list.** Caregiver sees what they would know about the person; staff-authored assessments stay internal. |
| 2 | Link lifetime | **14-day expiry, revocable, one active link per participant.** Draft edits persist so the caregiver can return. Expiry is a config value. |
| 3 | Review granularity | **Whole submission with a diff view.** Accept applies everything; Reject with a note reopens the link. |
| A1 | Link delivery *(assumption)* | Admin copies the link and sends it. ODIP has no email infrastructure; building one is out of scope. |
| A2 | Caregiver identity *(assumption)* | Name (required) and relationship (optional), captured before any edit, stored on the submission. |

## Approach

**Staged submission, applied on accept.** A `CaregiverProfileSubmission` holds the caregiver's
edits as a payload with token, status and reviewer fields. Public endpoints authenticate by token
only and serve a caregiver-visible projection. On accept, the payload is applied through the
**existing 20-group PATCH** — there is no second write path into `Participant`, and nothing
unreviewed ever reaches the live record, rosters, PDFs or the shift portal.

Rejected alternatives: direct edits with an "unreviewed" flag (unreviewed PHI would surface
platform-wide immediately); building on the `Odip.Domain/Dictionary/` forms engine (neither
existing wizard uses it — wrong place to trial a third rendering path).

## 1. Data model

```
CaregiverProfileSubmission : ITenantEntity
  Id                      Guid
  TenantId                Guid
  ParticipantId           Guid
  TokenHash               string   — SHA-256 of the raw token; the raw token is never stored
  Status                  enum     — Draft | Submitted | Accepted | Rejected | Revoked
  CaregiverName           string?  — required before any draft/submit write
  CaregiverRelationship   string?
  Payload                 jsonb    — the caregiver-visible field set
  PayloadVersion          int      — schema version of Payload; starts at 1
  CreatedByUserId         Guid
  CreatedAt               DateTime
  ExpiresAt               DateTime
  SubmittedAt             DateTime?
  ReviewedByUserId        Guid?
  ReviewedAt              DateTime?
  RejectionNote           string?
```

- One EF migration, additive. `Program.cs`'s `__EFMigrationsHistory` self-healing pins only
  older IDs; do not rename or reorder anything.
- **Partial unique index** on `(ParticipantId) WHERE "Status" IN ('Draft','Submitted')` enforces
  one active link per participant at the database, not only in code.
- **Reject** sets `Status = Draft`, clears `SubmittedAt`, extends `ExpiresAt` by the config window,
  keeps the same token so the caregiver's existing link still works.
- **Revoke** sets `Status = Revoked`. **Regenerate** revokes the active row and inserts a new one.
- `ITenantEntity` gives the admin side the existing tenant query filter for free.

## 2. Public API — token auth, outside the JWT stack

```
GET  /api/v1/public/caregiver/{token}
     → { status, caregiverName, caregiverRelationship, expiresAt, rejectionNote,
         current: CaregiverParticipantDto, draft: CaregiverPayload | null }
PUT  /api/v1/public/caregiver/{token}/draft     body: { caregiverName, caregiverRelationship, payload }
     → 204 · 400 if caregiverName empty · 409 unless Status = Draft
POST /api/v1/public/caregiver/{token}/submit    body: { caregiverName, caregiverRelationship, payload }
     → 204 · 400 on validation · 409 unless Status = Draft
```

- All three are `[AllowAnonymous]` and sit under a new `"public"` rate-limit policy, stricter than
  `"api"`. In `Program.cs` they bypass JWT but still pass the security-headers, exception-handling
  and rate-limiter middleware. Middleware order is load-bearing; the slot is documented in code.
- **Tenant and participant resolve from the token row — the public controller bypasses
  `ICurrentTenant` entirely.** (`CurrentTenant` is sealed and populated only in its constructor
  from JWT claims/headers; it cannot be re-set mid-request.) `CaregiverController` loads the
  submission by `TokenHash` with `IgnoreQueryFilters()`, then loads the participant with
  `IgnoreQueryFilters()` **and an explicit `p.Id == row.ParticipantId && p.TenantId == row.TenantId`
  match**. `X-View-As-Tenant` / `X-View-As-User` are never read on these routes. The controller
  has **no class-level `[Authorize]`** (the `AuthController` shape), rather than `[AllowAnonymous]`
  overrides on a gated controller — there is no precedent for the latter in this codebase.
- **Every failure is a 404**: unknown hash, expired, revoked, accepted, or a token whose row exists
  but the participant does not. Same shape as the medication witness endpoints, so nothing is
  enumerable and timing does not distinguish cases.
- Token: 32 bytes from `RandomNumberGenerator`, base64url in the link, SHA-256 hash in the row.
  Lookup is by hash only.
- `CaregiverParticipantDto` is a **dedicated projection**, never `ParticipantDetailDto`. It is built
  from PF-10.1's entry-allocation contract as *Profile fields minus `INTERNAL_FIELDS`*:

  ```
  INTERNAL_FIELDS (initial; a single constant on both sides)
    restrictive practices (all), HasRestrictivePracticeFlag
    behaviourRiskRating, riskEntries (ParticipantRiskEntry), risksHazardsSummary
    safety auto-notes (ParticipantNote with SourceKey)
    plan-management / funding-admin group (ndisPlan, serviceProfile except serviceStreams)
    preferredStaffId
  ```
  Shared (intake-captured) fields are included **read-only** for validation; Profile-editable
  fields are editable. The projection carries an `editable: string[]` list so the wizard does not
  hard-code it.
- **Drift guard:** a test walks the allocation contract and asserts every field is either in the
  projection or in `INTERNAL_FIELDS`. A field added to Profile later fails this test until someone
  consciously classifies it. A second test asserts no `INTERNAL_FIELDS` member appears in the DTO.
- Audit: ODIP's audit log is an automatic EF `SaveChangesInterceptor` (`AuditInterceptor`) gated
  by the `AuditedEntities.Types` allowlist. Adding `CaregiverProfileSubmission` to that set audits
  create, revoke, accept and reject with the authenticated admin for free. **Submit runs
  anonymously**, so the interceptor's `HttpContext.User` is null; `CaregiverController` sets
  `HttpContext.Items["AuditActor"] = $"caregiver:{caregiverName}"` before saving, and the
  interceptor reads that override when `User` is null. One small, contained interceptor change.

## 3. Admin API — JWT, existing role gates

```
POST   /api/v1/participants/{id}/caregiver-link          → { url, expiresAt }  (revokes any active row first)
DELETE /api/v1/participants/{id}/caregiver-link          → 204 (revoke)
GET    /api/v1/caregiver-submissions?status=Submitted    → list, tenant-scoped
GET    /api/v1/caregiver-submissions/{id}                → submission + current participant projection + diff
POST   /api/v1/caregiver-submissions/{id}/accept         → applies payload via PATCH; Status = Accepted
POST   /api/v1/caregiver-submissions/{id}/reject         body: { note }  → Status = Draft, link reopened
```

- Role gate `Admin,Coordinator,SuperAdmin`, matching `PATCH /participants/{id}`. Frontend gates on
  `canWriteParticipantDetails`, never the looser `canWrite`.
- **Accept** maps the payload onto `PatchParticipantDto`'s semantic groups and calls the PATCH
  apply logic in-process. That logic is currently inline in `ParticipantsController.Patch`; cg01
  **extracts it, behaviour-preserving, into `ParticipantPatchService.ApplyAsync(participantId,
  tenantId, dto, ct)`** which both the controller and the accept endpoint call. The existing 24
  `ParticipantsControllerPatchTests` are the regression net for that extraction. The 4 collection groups follow the documented **upsert-by-key**
  contract; the payload carries full item sets for the sections the caregiver can edit. Excluded
  groups are never present in the built DTO, so accept cannot touch an internal field even if a
  crafted payload includes one — the mapper only reads known caregiver-visible keys.
- The diff endpoint returns only fields whose payload value differs from the current value,
  grouped by wizard section.

## 4. Caregiver wizard — frontend

- Route `/caregiver/:token`, registered **outside** the authenticated shell: no nav, no tenant
  switcher, no `odip_user` read, no `usePermissions`. Loads via a small `usePublicCaregiver(token)`
  hook against the public endpoints with a plain Axios instance that attaches **no** auth or
  view-as headers.
- Built on `useWizard` with a computed, `useMemo`'d step list mirroring the Profile wizard minus
  excluded sections. Step 0 **About you** (name required, relationship optional) gates every later
  step: `validate` fails step 0 until the name is non-empty, so `visitedSteps` cannot advance.
- Field set is driven from the projection's `editable` list plus the allocation contract, not a
  hand-copied list. Shared fields render read-only with a "please check this is correct" affordance.
- Draft-save (PUT) on every step change and on a manual **Save and continue later** button.
  Reload restores the draft.
- **Submitted** state: read-only render with "Submitted — awaiting review". **Rejected** state:
  shows the admin's note at the top and reopens for editing. **Expired / revoked / unknown**: a
  single neutral "This link is no longer valid" page — never a hint about why.
- Controls: `Dropdown`, `SearchableSelect`, `CompactGridRow`. No native `<select>`.
- Served by the same SPA; no new external hosts, so the production CSP is unchanged.

## 5. Admin UI — frontend

- **Participant detail header**, gated `canWriteParticipantDetails`: a **Caregiver form** control
  showing a status chip (None / Draft / Submitted / Rejected) with **Generate link** (shows the URL
  once with a copy button and the expiry), **Regenerate**, and **Revoke**.
- **Caregiver submissions** page (`/caregiver-submissions`), a `DataTable` filtered to Submitted by
  default, with participant, caregiver name, submitted-at, and a Review action.
- **Review page**: side-by-side *current | caregiver's* for changed fields only, grouped by section,
  unchanged sections collapsed. **Accept** and **Reject** (note required). Both confirm before
  acting.

## 6. Branches

| Branch | Scope |
|---|---|
| `feat/cg01-submission-backend` | **First:** extract `ParticipantPatchService.ApplyAsync` out of `ParticipantsController.Patch` (behaviour-preserving; 24 existing tests must pass unmodified). Then: entity, migration, token service, public + admin endpoints, `"public"` rate-limit policy, `AuditedEntities` allowlist + `AuditActor` override, all backend tests |
| `feat/cg02-caregiver-projection` | `CaregiverParticipantDto`, `INTERNAL_FIELDS` on both sides, projection builder, accept-mapper onto `PatchParticipantDto`, drift-guard tests |
| `feat/cg03-caregiver-wizard` | Public route, plain Axios instance, `usePublicCaregiver`, the wizard, all four page states, frontend tests |
| `feat/cg04-admin-review` | Header control, submissions list, review page with diff, accept/reject, frontend tests |

Order: cg01 → cg02 → (cg03 ∥ cg04). cg03 and cg04 touch disjoint files.

## 7. Testing

**Backend**
- Token: generate → hash → lookup round-trips; the raw token is not persisted anywhere.
- 404 for each of: unknown hash, expired, revoked, accepted, participant deleted, **token from
  another tenant**.
- `X-View-As-Tenant` on a public route has no effect.
- PUT/POST with empty `caregiverName` → 400. PUT/POST after submit → 409. After reject → 204 again.
- Partial unique index: second active link for the same participant is rejected.
- Accept applies exactly the caregiver-visible groups via PATCH; a crafted payload containing an
  `INTERNAL_FIELDS` key leaves that field untouched.
- Reject sets Draft, clears `SubmittedAt`, extends `ExpiresAt`, stores the note.
- Rate-limit policy `"public"` is applied to the three routes.
- Audit rows written for create, revoke, submit, accept, reject.

**Frontend**
- Name gate: no step beyond 0 reachable until name entered.
- Draft persists across reload; submit renders read-only; rejected renders the note and reopens;
  invalid link renders the neutral page.
- **Drift guard** on `INTERNAL_FIELDS` vs the allocation contract.
- Public page renders with no `odip_user` in localStorage and makes no request carrying an
  `Authorization` or `X-View-As-*` header (assert on the Axios instance).
- Diff view lists changed fields only; Accept and Reject call the right endpoints; Reject requires
  a note.

**Gates** on every branch: `dotnet build`/`dotnet test`, `npm run build`/`npm test`, and
`npm run lint` at exactly 77 problems. Worktrees need `npm ci` and `.env.local` copied. The
cross-tree consistency test (`ParticipantFieldEntryMapTests`) is skippable in Docker; cg02's
drift guards must **not** read across trees — put the frontend and backend `INTERNAL_FIELDS`
checks on their own sides, each against the allocation contract already present in that tree.

## 8. Out of scope

Email delivery. Multiple caregivers per participant. Field-level accept/reject. Caregiver
accounts or logins. Editing intake-only fields. Notifying the caregiver of accept/reject.
