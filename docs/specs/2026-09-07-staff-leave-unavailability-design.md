# Staff Leave + Recurring Unavailability — Design

Status: Approved 2026-09-07 — design; implementation plan pending.

Staff today have no way to request leave — a coordinator enters everything by hand into
`StaffAvailability`, there is no approval step, no true weekly recurrence, and no audit
trail. This spec adds staff self-service leave/unavailability requests with a coordinator
approval workflow, brings trip-schedule conflict handling up to the roster board's
existing Warning/Blocking + override-reason parity, and migrates `StaffAvailability`'s
`Leave`-type rows into a new, properly audited, tenant-scoped model.

## Product rulings

1. Staff self-serve + coordinator approval. Staff submit from the portal; coordinators
   approve/decline; pending shows tentative on the roster, approved blocks; coordinators
   can enter on behalf (lands Approved).
2. Two kinds: date-range leave (Annual/Sick/Personal/Other, whole days) + recurring weekly
   unavailability (day of week + time window, effective range). Both go through the same
   approval lifecycle.
3. Roster + trip schedule warn on conflict and allow override with a short reason that is
   audit-logged. Pending leave = softer warning, no reason required.
4. Data model: NEW entities + migrate — do not extend `StaffAvailability`.

## Context — what exists today

- `StaffAvailability` (`backend/Odip.Domain/Entities/StaffAvailability.cs`) already models
  `Available | Unavailable | Leave | Training | Preferred | Tentative`
  (`AvailabilityType`, `backend/Odip.Domain/Enums/Enums.cs:150-158`), but with full
  `DateTime` start/end (not `DateOnly`/`TimeOnly`), no `Status`/approval field, an unused
  `IsRecurring`/`RecurrenceNotes` pair, and no tenant scoping (`ITenantEntity` not
  implemented). `Tentative` and `Preferred` are dead enum values — neither
  `RosterConflictService.UnavailableTypes` nor `RosteringController.LeaveTypes` includes
  them.
- `AvailabilityEditor.tsx` (`frontend/src/pages/schedule/AvailabilityEditor.tsx`), mounted
  in `SchedulePage.tsx`, is coordinator-only inline CRUD on `StaffAvailability` — no
  recurrence UI, no non-Leave creation, per its own original spec
  (`docs/superpowers/specs/2026-03-19-unavailability-schedule-design.md`).
- `LeaveBar.tsx` (`frontend/src/pages/rostering/components/LeaveBar.tsx`) already renders a
  read-only muted bar per staff row from `RosterStaffRowDto.Leave`
  (`LeaveBarDto { startDate, endDate, availabilityType, notes }`,
  `backend/Odip.Application/DTOs/RosteringDTOs.cs:59-65`), built in
  `RosteringController.GetBoard` (lines 254-260) by filtering to a private `LeaveTypes`
  constant (`RosteringController.cs:40`) that duplicates `RosterConflictService`'s own
  `UnavailableTypes` set (`backend/Odip.Domain/Rostering/Services/RosterConflictService.cs:59`).
- `RosterConflictService.Check` (same file) fires `STAFF_UNAVAILABLE`
  (`Code = "STAFF_UNAVAILABLE"`, line 51) as a Warning when an `Availability` record of
  type `Unavailable`/`Leave`/`Training` overlaps the candidate window (lines 144-153) — the
  one existing finding that a leave record already feeds. `RosterFinding` is
  `record RosterFinding(string Code, RosterFindingSeverity Severity, string Message)`
  (line 8) — no `RequiresReason` field yet.
- Trip-side conflict handling has no comparable rigor: `StaffAssignment`
  (`backend/Odip.Domain/Entities/StaffAssignment.cs`) has a bare `HasConflict` bool, no
  reason field. `StaffAssignmentsController` (`api/v1/staff-assignments`,
  `backend/Odip.Api/Controllers/VehiclesStaffController.cs:603-604`) computes it inline
  against overlapping assignments and `Unavailable`/`Leave` availability rows (lines
  494/649/661/689) with no findings, no override capture, no dry-run check endpoint.
  `StaffAssignModal.tsx` (`frontend/src/pages/schedule/StaffAssignModal.tsx`) submits with
  no conflict-check call at all; `StatusBadge.tsx`
  (`frontend/src/pages/schedule/StatusBadge.tsx`) renders a `Conflict` cell state purely as
  styling, with no click-through to a reason.
- `AuditedEntities.Types` (`backend/Odip.Infrastructure/Audit/AuditedEntities.cs:8`) already
  covers `Shift`, `ShiftPattern`, `StaffParticipantCompatibility`, `StaffAssignment` (lines
  15/22/36) — `StaffAvailability` is conspicuously absent, so today's leave data has no
  field-level history at all.
- `PortalController` (`backend/Odip.Api/Controllers/PortalController.cs`) is the existing
  self-scoping idiom every new staff-facing endpoint should copy: plain `[Authorize]`,
  every action resolves the caller's own id via `ResolveCurrentStaffIdAsync` (used at lines
  65/112/172/193/226/261/291/333/374, defined line 409), and 404s (never 403s) on anything
  belonging to someone else. It has zero leave/availability endpoints today.
- Frontend permissions (`frontend/src/lib/permissions.ts`) use one boolean per backend
  capability (`canWrite*`, lines 85-188) and a `PageKey` union (lines 3-20) gating routes
  via `canAccessPage`; `SupportWorker` is restricted to `SUPPORT_WORKER_PAGES` (line 22),
  which does not include `rostering` or `staff` — a staff leave UI must live under
  `/portal/*`.
- No notification mechanism exists anywhere in the backend (no email, no generic inbox) —
  confirmed by exploration; the closest pattern is `ParticipantAlertsService`'s read-time
  computed badge.

## 1. Data model

Two new tenant-scoped, audited entities in `backend/Odip.Domain/Rostering/` (co-located
with `ShiftPattern`, the closest structural analogue), plus one migration.

```csharp
// backend/Odip.Domain/Rostering/LeaveEntities.cs (new file)

public enum LeaveType { Annual, Sick, Personal, Other }
public enum LeaveStatus { Pending, Approved, Declined, Cancelled }

public class LeaveRequest : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public LeaveType LeaveType { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }             // inclusive
    public LeaveStatus Status { get; set; } = LeaveStatus.Pending;
    public string? Reason { get; set; }               // staff's own note
    public Guid RequestedByUserId { get; set; }
    public DateTime RequestedAt { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }          // required on Declined
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class RecurringUnavailability : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public DayOfWeek DayOfWeek { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }              // same-day only, no overnight
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public string? Notes { get; set; }
    public LeaveStatus Status { get; set; } = LeaveStatus.Pending;
    public Guid RequestedByUserId { get; set; }
    public DateTime RequestedAt { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
```

```csharp
// backend/Odip.Domain/Rostering/Services/RecurringUnavailabilityExpander.cs (new file)
public sealed class RecurringUnavailabilityExpander
{
    // Mirrors ShiftPatternExpander.Occurrences (backend/Odip.Domain/Rostering/Services/
    // ShiftPatternExpander.cs:17): every DayOfWeek match inside the intersection of
    // [from,to] and [EffectiveFrom, EffectiveTo ?? DateOnly.MaxValue].
    public IReadOnlyList<DateOnly> Occurrences(RecurringUnavailability rule, DateOnly from, DateOnly to);
}
```

Both entities land in `AuditedEntities.Types`
(`backend/Odip.Infrastructure/Audit/AuditedEntities.cs:8`) on day one, alongside
`StaffAvailability` itself (currently missing — add it here too, per ruling 4's intent
that the legacy entity's remaining `Unavailable`/`Training`/`Preferred`/`Available` rows
also get history from this point forward).

**Existing `StaffAvailability`** (`backend/Odip.Domain/Entities/StaffAvailability.cs`)
keeps `Unavailable`/`Training`/`Preferred`/`Available` rows; the migration's data step
copies its `Leave`-type rows into `LeaveRequest` (`Approved`, `LeaveType.Other`, dates
truncated `DateTime → DateOnly`) and deletes the source rows. `AvailabilityEditor.tsx`
loses its "Leave" option in the type dropdown; a note there links to the new approvals
page.

Enums are plain int-backed EF columns (repo default; `AuditLog.Action` at
`OdipDbContext.cs:800` is the only documented exception, for a concrete raw-SQL reason
that doesn't apply here).

## 2. API + permissions

**Portal (staff self-service)** — new actions on `PortalController`
(`backend/Odip.Api/Controllers/PortalController.cs`), following its `[Authorize]` +
`ResolveCurrentStaffIdAsync` self-scoping idiom (404, never 403, on anything not the
caller's own):

| Method | Route | Roles | Request | Response | Status |
|---|---|---|---|---|---|
| GET | `/portal/leave` | any authenticated | — | `{ leave: LeaveRequestDto[], unavailability: RecurringUnavailabilityDto[] }` | 200 |
| POST | `/portal/leave` | any authenticated | `CreateLeaveRequestDto` | `LeaveRequestDto` | 201, 400, 409 |
| POST | `/portal/leave/{id}/cancel` | any authenticated | — | `LeaveRequestDto` | 200, 404, 409 (not Pending) |
| POST | `/portal/unavailability` | any authenticated | `CreateRecurringUnavailabilityDto` | `RecurringUnavailabilityDto` | 201, 400, 409 |
| POST | `/portal/unavailability/{id}/cancel` | any authenticated | — | `RecurringUnavailabilityDto` | 200, 404, 409 (not Pending) |

**Coordinator side** — new `LeaveController` at `api/v1/leave`
(`backend/Odip.Api/Controllers/LeaveController.cs`, new file), mirroring
`RosteringController`'s controller-level gate
(`[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]`, `RosteringController.cs:30`):

| Method | Route | Roles | Request | Response | Status |
|---|---|---|---|---|---|
| GET | `/leave?status=&userId=&from=&to=` | Admin, Coordinator, SuperAdmin | — | `LeaveRequestDto[]` | 200 |
| POST | `/leave` | Admin, Coordinator, SuperAdmin | `CreateLeaveRequestDto` (+ `userId`) | `LeaveRequestDto` (lands `Approved`) | 201, 400 |
| POST | `/leave/{id}/approve` | Admin, Coordinator, SuperAdmin | — | `{ leave: LeaveRequestDto, overlaps: RosterFindingDto[] }` | 200, 404, 409 |
| POST | `/leave/{id}/decline` | Admin, Coordinator, SuperAdmin | `LeaveDecisionDto` (note required) | `LeaveRequestDto` | 200, 400 (no note), 404, 409 |
| POST | `/leave/{id}/cancel` | Admin, Coordinator, SuperAdmin | — | `LeaveRequestDto` | 200, 404 |
| GET/POST/`{id}`/approve/decline/cancel | `/leave/unavailability/...` (same shape) | same | same DTOs, `RecurringUnavailability*` | same, except approve returns `{ unavailability: RecurringUnavailabilityDto, overlaps: RosterFindingDto[] }` | same |

Validation on create (both portal and coordinator paths): `EndDate >= StartDate`;
`StartTime < EndTime`; `EffectiveTo >= EffectiveFrom` when set; a request that exactly
duplicates an existing non-`Cancelled` request for the same user (same dates/type, or same
day-of-week/times/effective-range) → 409. Overlapping leave for the same user is allowed
(e.g. Sick filed inside an existing Annual window). `ReadOnlyMiddleware` is unchanged — it
already 403s any non-GET for the `ReadOnly` role ahead of both controllers.

**DTOs** — `backend/Odip.Application/DTOs/LeaveDTOs.cs` (new file), camelCase-stable per
the discipline `RosteringDTOs.cs`'s header comment already documents ("property names must
serialise to exactly the camelCase names... a frontend is already built against them"):

| DTO | Properties (camelCase on the wire) |
|---|---|
| `LeaveRequestDto` | `id`, `userId`, `userFullName`, `leaveType`, `startDate`, `endDate`, `status`, `reason`, `requestedByUserId`, `requestedAt`, `decidedByUserId`, `decidedAt`, `decisionNote` |
| `CreateLeaveRequestDto` | `leaveType`, `startDate`, `endDate`, `reason`, `userId` (nullable — ignored on the portal path, which always uses the caller's own id; required on `POST /leave`, 400 if missing) |
| `LeaveDecisionDto` | `decisionNote` |
| `RecurringUnavailabilityDto` | `id`, `userId`, `userFullName`, `dayOfWeek`, `startTime`, `endTime`, `effectiveFrom`, `effectiveTo`, `notes`, `status`, `requestedByUserId`, `requestedAt`, `decidedByUserId`, `decidedAt`, `decisionNote` |
| `CreateRecurringUnavailabilityDto` | `dayOfWeek`, `startTime`, `endTime`, `effectiveFrom`, `effectiveTo`, `notes`, `userId` (same rule as above) |

`leaveType`/`status`/`dayOfWeek` serialise as string enum names (`"Annual"`, `"Pending"`,
`"Monday"`), matching how `RosteringDTOs.cs` already renders its own enums.

**Frontend permissions** — `frontend/src/lib/permissions.ts`, two new one-per-capability
booleans following the existing `canWrite*` convention (lines 85-188), each doc-commented
with the backend gate it mirrors:

```ts
/** Mirrors PortalController's leave endpoints — any non-ReadOnly authenticated user. */
canRequestLeave: !isReadOnly,
/** Mirrors LeaveController's [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]. */
canApproveLeave: isSuperAdmin || isAdmin || isCoordinator,
```

New `PageKey` values added to the union (`permissions.ts:3-20`): `'portal-leave'` (added to
`SUPPORT_WORKER_PAGES`, line 22) and `'leave-approvals'`.

**Notifications** — no email/push, per ruling scope and the confirmed absence of any
notification mechanism. A pending-count badge on the coordinator's Rostering nav entry and
dashboard, computed at read time (same style as `ParticipantAlertsService`,
`backend/Odip.Infrastructure/Services/ParticipantAlertsService.cs`) via
`GET /leave?status=Pending` count — no persisted alert row. Staff see status on their own
`/portal/leave` list.

## 3. Conflict engine + override parity

**One availability source.** New Infrastructure service
`backend/Odip.Infrastructure/Rostering/StaffUnavailabilityQuery.cs`:

```csharp
public enum UnavailabilityKind { ApprovedLeave, PendingLeave, RecurringRule, Legacy }

public record UnavailabilityWindow(Guid UserId, DateTime Start, DateTime End, UnavailabilityKind Kind);

public interface IStaffUnavailabilityQuery
{
    // Unions: Approved + Pending LeaveRequest (whole-day windows), Approved
    // RecurringUnavailability (expanded via RecurringUnavailabilityExpander),
    // and legacy StaffAvailability Unavailable/Training rows.
    Task<IReadOnlyList<UnavailabilityWindow>> GetWindowsAsync(
        IReadOnlyList<Guid> userIds, DateOnly from, DateOnly to, CancellationToken ct);
}
```

Every consumer — `RosteringController.GetBoard`, `RosterConflictService`'s caller, and
`StaffAssignmentsController` — goes through this service. The duplicated `LeaveTypes`
constant (`RosteringController.cs:40`) and `UnavailableTypes` constant
(`RosterConflictService.cs:59`) are both removed in favour of it.

**New finding codes in `RosterConflictService`** (`STAFF_UNAVAILABLE`,
`RosterConflictService.cs:51`, stays for legacy `StaffAvailability` rows):

| Code | Severity | RequiresReason | Message |
|---|---|---|---|
| `STAFF_ON_LEAVE` | Warning | true | `"{Name}'s leave ({LeaveType}) covers this window — cannot roster without a reason."` |
| `STAFF_RECURRING_UNAVAILABLE` | Warning | true | `"{Name} is recurringly unavailable {DayOfWeek} {Start}-{End}."` |
| `STAFF_LEAVE_PENDING` | Warning | false | `"{Name} has a pending leave request covering this window."` |

`RosterFinding` (`RosterConflictService.cs:8`) gains a fourth positional member:

```csharp
public sealed record RosterFinding(string Code, RosterFindingSeverity Severity, string Message, bool RequiresReason = false);
```

Gate (extends the existing Shift-write gate, `RosteringController`'s `EvaluateFindings`):
any `Severity == Blocking` finding → refused regardless of override; any finding with
`RequiresReason` → a non-empty `OverrideReason` plus its code recorded in
`AcknowledgedFindingCodes` is required to save; a write with only findings that have
`RequiresReason == false` is allowed with no reason, but the codes are still recorded in
`AcknowledgedFindingCodes` (so the roster board can show *why* a cell looks tentative
without asking for input). Pending `RecurringUnavailability` rules raise nothing — only
`Approved` recurring rules feed `STAFF_RECURRING_UNAVAILABLE`.

**Trip-side parity.** `StaffAssignment`
(`backend/Odip.Domain/Entities/StaffAssignment.cs`, currently just `HasConflict` at line
22) gains:

```csharp
public string? OverrideReason { get; set; }
public string? AcknowledgedFindingCodes { get; set; }
```

Both are covered automatically once `StaffAssignment` (already in `AuditedEntities.Types`,
`AuditedEntities.cs:15`) gets these fields — no interceptor change needed.
`StaffAssignmentsController` (`api/v1/staff-assignments`,
`backend/Odip.Api/Controllers/VehiclesStaffController.cs:603-604`) gains
`POST /staff-assignments/check` (dry-run, returns `RosterFindingDto[]`, no writes),
mirroring `POST /shifts/check`. Create/update (the code around lines 632-650 that
currently sets `HasConflict` inline) run the same `RosterConflictService.Check` + gate as
shifts. A trip assignment has no participant, so the check runs with a `RosterCheckContext`
built from the staff member's unavailability windows, their other shifts/assignments in the
window, and their WSC expiry only — participant-scoped rules (compatibility, restrictive
practices, etc.) are skipped, and the participant fields are left null; `RosterConflictService`
must already tolerate a null participant or gain that tolerance in this change. The
applicable codes are therefore `STAFF_ON_LEAVE`, `STAFF_RECURRING_UNAVAILABLE`,
`STAFF_LEAVE_PENDING`, `STAFF_UNAVAILABLE`, the double-booking codes and `WSC_EXPIRED`.
`HasConflict` stays a persisted column (the existing DB column is kept — no migration for it)
but is written by the controller from the check result: `true` when `OverrideReason` is
non-null, i.e. a hard finding was overridden. Acknowledged soft-only findings leave it
`false`, so `SchedulePage`'s `Conflict` badge (`frontend/src/pages/schedule/StatusBadge.tsx`)
keeps meaning "overridden conflict" and pending leave shows as `Tentative` instead (§4).
Trip windows are
`AssignmentStart..AssignmentEnd` whole days; recurring rules compare on weekday only (any
overlap on any day in the range is a finding, not per-instant time matching).

**Reverse direction.** `POST /leave/{id}/approve` and
`POST /leave/unavailability/{id}/approve` query for overlapping `Published` shifts and
`Confirmed` `StaffAssignment` rows for that user and return them as
`overlaps: RosterFindingDto[]` in the response body; approval itself is never blocked by
this. The approvals UI shows "this will conflict with N rostered shifts" before the
coordinator confirms. Nothing is auto-unassigned.

## 4. UI

**Portal `/portal/leave` (`PortalLeavePage`, new file
`frontend/src/pages/portal/PortalLeavePage.tsx`)** — two tabs, *Leave* and *Regular
unavailability*, each a `DataTable` (`frontend/src/components/DataTable.tsx`) of the
caller's own requests with a `StatusBadge`
(`frontend/src/components/StatusBadge.tsx`) showing Pending/Approved/Declined/Cancelled
plus the decision note on declined rows, and `EmptyState`
(`frontend/src/components/EmptyState.tsx`) when there are none. "Request leave" / "Add
unavailability" opens a `Modal` (`frontend/src/components/Modal.tsx`) form built with
react-hook-form + zod, wired to `useUnsavedChangesWarning`
(`frontend/src/hooks/useUnsavedChangesWarning.tsx`) and `extractErrorMessage` for API
errors. Leave form fields: type, date range, optional reason. Unavailability form fields:
day of week, start/end time, effective from/to. Pending rows get a "Withdraw" action behind
`ConfirmDialog` (`frontend/src/components/ConfirmDialog.tsx`). Portal home gets a card link
to this page.

**Coordinator `/rostering/leave` (`LeaveApprovalsPage`, new file
`frontend/src/pages/rostering/LeaveApprovalsPage.tsx`)** — `PageHeader`
(`frontend/src/components/PageHeader.tsx`) with an "Enter on behalf" action; filters for
status (default Pending), staff, and date range; a `DataTable` with columns staff, type,
dates or weekly window, requested by/when, status. Approve/Decline go through
`ConfirmDialog`; decline requires a note; the approve dialog lists any overlapping
shifts/trips returned by the approve endpoint before the coordinator confirms. "Enter on
behalf" reuses the same two forms from the portal page with a staff picker added
(`SearchableSelect`, `frontend/src/components/SearchableSelect.tsx`). A sidebar entry under
Rostering carries the pending-count badge.

**Roster board.** `LeaveBar.tsx`
(`frontend/src/pages/rostering/components/LeaveBar.tsx`) learns a `Kind` field on
`LeaveBarDto` (`RosteringDTOs.cs:59-65`, extended with `Kind: UnavailabilityKind`):
approved leave and approved recurring windows render as today's muted bar; pending leave
renders the same bar hatched/dashed with a "(pending)" label; recurring windows render as
partial-day bars only on their matching weekdays (using the existing
`clampedDayIndex`/`barOverlapsWeek` helpers in `frontend/src/pages/rostering/lib/roster.ts`).
Until this frontend work lands, PR 1 keeps `LeaveBarDto.availabilityType` filled with a compat
value for every kind (`ApprovedLeave`/`PendingLeave` → `Leave`, `RecurringRule` → `Unavailable`,
`Legacy` → the source row's own type) so the current `LeaveBar.tsx`, which still labels the bar
from `availabilityType`, keeps rendering instead of going blank; this fill is removed once the
frontend switches to keying off `Kind`.
`ShiftSlideOver.tsx`'s `FindingsList` picks up the three new codes automatically (it
already renders whatever `RosterFinding[]` comes back from `POST /shifts/check`); its
existing `reasonRequired` state switches to keying off the new `RequiresReason` field
instead of "any Warning present." `ExceptionsDrawer.tsx` needs no change — it already
flattens whatever findings the board returns.

**Trip schedule.** `StaffAssignModal.tsx`
(`frontend/src/pages/schedule/StaffAssignModal.tsx`) gains the live-check pattern
`ShiftSlideOver.tsx` already has: call `POST /staff-assignments/check` as staff/dates
change, render `FindingsList`, require a non-empty override reason when any returned
finding has `RequiresReason`. `SchedulePage.tsx` cells
(`frontend/src/pages/schedule/StatusBadge.tsx`): `Unavailable` for approved-leave or
approved-recurring overlap, a new `Tentative` badge for pending leave, `Conflict` unchanged
(now backed by the derived `HasConflict`). `StaffTab.tsx`
(`frontend/src/pages/trip-detail/StaffTab.tsx`) gains an acknowledged-conflict marker that
shows the stored `OverrideReason` on hover.

**`AvailabilityEditor.tsx`** — the "Leave" option is removed from its type dropdown; a note
in its empty/help text links to `/rostering/leave`.

## Data flow

**Staff submits → coordinator approves → board reflects it.** Staff member opens
`/portal/leave`, submits a leave request (`POST /portal/leave`) → row inserted with
`Status = Pending`, `RequestedByUserId` = self. The roster board's next `GET
/rostering/board` fetch pulls it through `StaffUnavailabilityQuery`, tagged
`PendingLeave`; `LeaveBar` renders it hatched, and any shift on that window gets
`STAFF_LEAVE_PENDING` (soft, no reason). Coordinator opens `/rostering/leave`, filters
Pending, clicks Approve on the request → `POST /leave/{id}/approve` flips `Status` to
`Approved`, returns any overlapping Published shifts/Confirmed trips as warnings, sets
`DecidedByUserId`/`DecidedAt`. The next board fetch now tags the same window
`ApprovedLeave`; `LeaveBar` renders it solid; any shift over it now fires `STAFF_ON_LEAVE`
(hard warning, reason required) instead of the pending code.

**Coordinator assigns staff to a shift/trip over leave → findings → reason → audit.**
Coordinator opens `ShiftSlideOver` (or `StaffAssignModal` for a trip) for a staff member
who has `Approved` leave overlapping the candidate window. The live dry-run call (`POST
/shifts/check` or `POST /staff-assignments/check`) returns `STAFF_ON_LEAVE` with
`RequiresReason = true`. The UI blocks Save until a reason is typed; on submit the write
carries `overrideReason` + `acknowledgedFindingCodes: ["STAFF_ON_LEAVE"]`. The controller's
gate accepts it (Warning, not Blocking), persists both fields on the `Shift` or
`StaffAssignment` row. `AuditInterceptor` (already generic, entity type already in
`AuditedEntities.Types`) writes an `AuditLog` row capturing the old/new value of
`OverrideReason` and `AcknowledgedFindingCodes` alongside every other changed field — no
new audit code needed.

## Error handling

**Validation → status/message.**

| Rule | Status | Message |
|---|---|---|
| `EndDate < StartDate` (leave) | 400 | "End date must be on or after the start date." |
| `StartTime >= EndTime` (recurring) | 400 | "Start time must be before end time." |
| `EffectiveTo < EffectiveFrom` | 400 | "Effective-to must be on or after effective-from." |
| Exact duplicate of a non-cancelled request | 409 | "An identical request already exists." |
| Decline without `DecisionNote` | 400 | "A decline reason is required." |
| Cancel on a non-`Pending` leave request (staff) | 409 | "Only pending requests can be withdrawn." |
| Approve/decline/cancel on an already-decided request | 409 | "This request has already been decided." |
| Portal action on another user's request | 404 | (never 403 — matches `PortalController`'s existing idiom) |
| Shift/trip write with a Blocking finding | 422 | finding list returned, write refused regardless of reason |
| Shift/trip write with a `RequiresReason` finding and no reason | 422 | finding list returned, `overrideReason` required |

**State-transition matrix** (`LeaveStatus`, identical for `LeaveRequest` and
`RecurringUnavailability`):

| From \ To | Approved | Declined | Cancelled |
|---|---|---|---|
| Pending | Coordinator (approve) | Coordinator (decline, note required) | Staff (own, withdraw) or Coordinator |
| Approved | — | — | Coordinator (cancel) |
| Declined | — | — | — |
| Cancelled | — | — | — |

An on-behalf entry from a coordinator (`POST /leave` or `POST /leave/unavailability`)
starts directly at `Approved`, bypassing `Pending` — it is not a transition, it is the
initial state, with `RequestedByUserId` = the coordinator's own id.

## Out of scope / explicitly deferred

- Email or push notifications of any kind — no notification mechanism exists in the
  codebase today and building one is out of scope for this feature.
- Overnight recurring unavailability windows (`EndTime < StartTime` crossing midnight).
- Monthly or nth-weekday recurrence (RRULE-style) — weekly only, matching `ShiftPattern`.
- Auto-unassigning staff from shifts/trips when their leave is approved — approval only
  surfaces the conflict, it never removes an existing assignment.
- Public-holiday interaction rules — `PublicHoliday` is architecturally unrelated to
  rostering conflict-checking today and this feature does not change that.
- Bumping the `zod`/`@hookform/resolvers` versions to fix the known rendered-validation-text
  assertion gap (see Testing below) — tracked separately, not part of this delivery.

## Testing

**Backend (`Odip.Tests`)**
- `Leave/RecurringUnavailabilityExpanderTests` — weekday matching, effective-range
  clipping, open-ended `EffectiveTo`.
- `Leave/StaffUnavailabilityQueryTests` (EF InMemory) — union of the three sources, kind
  tagging, pending vs. approved.
- `Rostering/RosterConflictServiceTests` extended — the three new codes, `RequiresReason`,
  the gate for soft-only findings.
- `Leave/LeaveControllerTests` + `Portal/PortalLeaveTests` — role gating, self-scoping
  404s, approve/decline transitions, decline-note required, on-behalf lands `Approved`,
  overlap warnings returned on approve.
- `Rostering/StaffAssignmentGateTests` — trip create/update refuses hard findings without a
  reason, records `AcknowledgedFindingCodes`, `HasConflict` is correctly derived.
- `Leave/LeaveAuditTests` — copies the `Rostering/RosteringAuditTests.cs` scaffold: field
  changes and decision reasons land in `AuditLog`.

**Frontend** — co-located `*.test.tsx`, mocking only `@/api/hooks` per the rostering
convention (see `ShiftSlideOver.test.tsx`'s own comment on the choice), with new fixtures
`makeLeaveRequest` / `makeRecurringRule` added beside `test-fixtures.ts`:
`PortalLeavePage`, `LeaveApprovalsPage`, `StaffAssignModal` (live check + reason gate),
`LeaveBar` (pending vs. approved), `SchedulePage` (Tentative badge). Known limitation: the
`zod@4`/`@hookform/resolvers@3` version mismatch in this repo means rendered validation
text can't be reliably asserted in tests — assert submit payloads instead until the
resolver versions are bumped (out of scope here, see above).

## Delivery

One spec, one plan, three PRs:

1. **Backend domain + migration + query service + conflict codes + controllers** —
   `LeaveRequest`/`RecurringUnavailability` entities, `RecurringUnavailabilityExpander`,
   the single additive `AddStaffLeaveAndRecurringUnavailability` migration,
   `StaffUnavailabilityQuery`, the three new `RosterConflictService` codes +
   `RequiresReason`, `LeaveController`, `PortalController` leave/unavailability actions,
   `LeaveDTOs.cs`, `AuditedEntities.Types` additions, all backend tests above.
2. **Portal + approvals pages + `LeaveBar`** — `PortalLeavePage`, `LeaveApprovalsPage`,
   `permissions.ts` additions, `LeaveBar` `Kind` handling, sidebar badge, frontend tests
   for these three.
3. **Trip-side parity** — `StaffAssignment.OverrideReason`/`AcknowledgedFindingCodes`,
   `POST /staff-assignments/check`, `StaffAssignModal` live check, `SchedulePage` Tentative
   badge, `StaffTab` conflict marker, frontend tests for these.

Spec path: `docs/specs/2026-09-07-staff-leave-unavailability-design.md` (this file).

## Verification notes

Every entity, enum, controller, component, and helper the approved design names —
`StaffAvailability`, `AvailabilityEditor`, `LeaveBar`, `STAFF_UNAVAILABLE`,
`RosterConflictService`, `RosterFinding`, `ShiftPatternExpander`,
`StaffAssignment.HasConflict`, `PortalController` + `ResolveCurrentStaffIdAsync`,
`AuditedEntities.Types`, `permissions.ts`'s `PageKey`/`SUPPORT_WORKER_PAGES`/`canWrite*`
convention, `ShiftSlideOver`'s findings/override-reason flow, `RosteringController`'s
role gate, `StaffAssignmentsController`'s inline `HasConflict` computation — was located
and read directly in this pass, with the exact paths and line numbers cited above.
Nothing named in the design was missing from the repo.

## Open questions

None.
