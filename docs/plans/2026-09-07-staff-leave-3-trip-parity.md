# Staff Leave + Recurring Unavailability — Trip-Side Parity Implementation Plan (PR 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring trip-schedule staff conflict handling up to the roster board's existing
Blocking/Warning + override-reason parity — a `POST /staff-assignments/check` dry-run, the same
gate on trip-assignment create/update, `Tentative`/`Unavailable` schedule cells sourced from
`IStaffUnavailabilityQuery`, and an acknowledged-conflict marker on the trip staff tab —
consuming the entities, conflict codes, and query service PR 1 ships, with no portal/approvals
UI (PR 2's scope).

**Architecture:** `RosterConflictService` gains a `CheckStaffAssignment` overload and tolerates a
null `RosterCheckContext.Participant`; the window-overlap rules `Check(Shift, ...)` already runs
are extracted into shared, Shift-decoupled private cores so `CheckStaffAssignment` reuses them
instead of duplicating them (WSC, double-booked-shift, double-booked-trip, staff-unavailable —
participant-scoped rules are skipped outright, never merely tolerated). A new
`Odip.Api/Rostering/RosterGate.cs` lifts the Blocking/RequiresReason/override gate out of
`RosteringController` (a behaviour-preserving refactor) so `StaffAssignmentsController` shares it
verbatim rather than re-implementing it. `ScheduleController` swaps its raw `StaffAvailability`
overlap query for `IStaffUnavailabilityQuery`, adding a `Tentative` cell state for pending leave.
`StaffAssignModal.tsx` gains the same live-check/findings/override-reason flow `ShiftSlideOver.tsx`
already has for shifts — undebounced, since staff/trip are fixed props for the modal's lifetime,
not live-edited fields. That flow's findings/reason-field JSX is then extracted into a shared
`RosterGateFields` component so `StaffTab.tsx`'s own inline edit modal — which has editable
Assignment Start/End dates and can trip the same gate — gets identical treatment instead of a
generic error message.

**Tech Stack:** .NET 8, EF Core 8 + Npgsql, xUnit + Moq + EF InMemory, React 19, TypeScript,
TanStack Query, vitest + Testing Library.

**Spec:** `docs/specs/2026-09-07-staff-leave-unavailability-design.md` — read it first; this plan
argues from it.

## Global Constraints

- Run all backend commands from `odip-prototype/odip/backend`; frontend commands from
  `odip-prototype/odip/frontend`. Repo root for `git` is `F:\Projects\personal\ODIP`.
- Never touch `bin/`, `obj/`, `_to_delete/`, `odip-prototype.zip`, `docs/superpowers/`,
  `.claude/worktrees/`, `docs/specs/odip-updates-2026-09/`.
- **No migration in this PR.** `StaffAssignment.OverrideReason`/`AcknowledgedFindingCodes` columns
  and the `LeaveRequest`/`RecurringUnavailability` schema are already shipped by PR 1's single
  `AddStaffLeaveAndRecurringUnavailability` migration. `Program.cs` has raw-SQL
  `__EFMigrationsHistory` self-healing pinned to specific migration IDs — never rename/reorder an
  existing migration file.
- No MediatR handlers, no AutoMapper profiles — both packages are referenced but unused by design.
- Enums are plain int-backed EF columns (repo default) — nothing new here needs
  `HasConversion<string>()`.
- Blocking/Warning/override gate (PR 1's rule, now shared via `RosterGate`): any
  `Severity == Blocking` finding refuses the write regardless of reason; any finding with
  `RequiresReason == true` needs a non-empty `overrideReason`; codes are recorded in
  `AcknowledgedFindingCodes` whenever any finding fired, reason-required or not. `HasConflict` is
  written by the controller from the check result: `true` iff `OverrideReason` is non-null.
- Trip windows are whole days `AssignmentStart..AssignmentEnd` (`AssignmentEnd` inclusive);
  recurring-unavailability comparisons are weekday-only via `IStaffUnavailabilityQuery`'s
  pre-expanded occurrences — no per-instant time matching on the trip path.
- A trip assignment carries no participant: `RosterCheckContext.Participant` is nullable, and
  `RosterConflictService.CheckStaffAssignment` skips every participant-scoped rule (compatibility,
  credential/competency, ratio, over-hours) outright rather than merely tolerating a null value.
- DTOs: `namespace Odip.Application.DTOs;`, `public record`, `{ get; init; }`, camelCase wire
  contract — `RosteringDTOs.cs`'s own header comment states the discipline this file joins.
- `StaffAssignment` is **not** `ITenantEntity` — tenant scope comes from its `TripInstance`/`User`
  FKs, unchanged by this PR. Don't add a query filter for it.
- Backend tests: xUnit, `Mock<ICurrentTenant>` into `OdipDbContext`, controllers constructed
  directly with `new`, fixtures inline per file — copy the scaffold in
  `Odip.Tests/Rostering/RosteringControllerTests.cs` / `RosterConflictServiceTests.cs`.
- Frontend tests: mock only `@/api/hooks` (see `ShiftSlideOver.test.tsx`'s own comment on the
  choice — it exercises the actual override-gate wiring), fixtures co-located or in
  `src/pages/rostering/test-fixtures.ts`. This plan's forms use plain `useState`, matching
  `ShiftSlideOver.tsx`/`StaffAssignModal.tsx`'s existing pattern (not react-hook-form + zod), so
  the `zod@4.5.2`/`@hookform/resolvers@3.10.0` rendered-validation-text gap doesn't apply here.
- Gates before every commit: backend `dotnet build` (0 errors) + `dotnet test` (0 failed);
  frontend `npm run build`, `npm test -- --run`, `npx eslint <changed files>` (gate = no NEW lint
  errors vs main).
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  ```

## What PR 1 already ships (consumed here, not redefined)

`IStaffUnavailabilityQuery`/`StaffUnavailabilityQuery` (`Odip.Infrastructure/Rostering/`,
DI-registered scoped), `UnavailabilityKind`/`UnavailabilityWindow`
(`Odip.Domain/Rostering/Services/UnavailabilityWindow.cs`), `RosterFinding.RequiresReason` (4th
positional member, default `false`), the `STAFF_ON_LEAVE`/`STAFF_RECURRING_UNAVAILABLE`/
`STAFF_LEAVE_PENDING` codes on `RosterConflictService`, `RosterFindingDto.RequiresReason` (C#),
`StaffAssignment.OverrideReason`/`AcknowledgedFindingCodes` (columns + properties, unwired), and
`RosteringController`'s rewritten `EvaluateFindings`/`ToFindingDto`/`CheckAsync`.

## What PR 2 already ships (consumed here, not redefined)

PR 2's Task 1 (`src/api/types/rostering.ts`) already adds **`RosterFindingDto.requiresReason:
boolean`** and `LeaveBarDto.kind: UnavailabilityKind` (alongside `LeaveBarDto`'s existing
`availabilityType`/`notes`) to the frontend types, and updates the shared `makeFinding` test
fixture (`src/pages/rostering/test-fixtures.ts`) to default `requiresReason: false`. This plan
does **not** touch `rostering.ts` or `makeFinding` again — every frontend finding this plan renders
already carries `requiresReason` by the time this PR lands. PR 2 also explicitly scopes
`StaffAssignModal.tsx`, `SchedulePage.tsx`'s `Tentative` badge, `StaffTab.tsx`'s conflict marker,
and every backend file to "PR 3/PR 1" in its own self-review — confirming no overlap with this
plan's scope.

---

## File Structure

| File | Responsibility |
|---|---|
| Modify `Odip.Domain/Rostering/Services/RosterConflictService.cs` | `RosterCheckContext.Participant` nullable; window-derivation extracted from `Shift`-coupled private methods into reusable cores; new `CheckStaffAssignment` public method |
| Modify `Odip.Tests/Rostering/RosterConflictServiceTests.cs` | `CompliantContext`'s `participant` param retyped nullable; new tests for null-tolerance + `CheckStaffAssignment` |
| Create `Odip.Api/Rostering/RosterGate.cs` | Shared Blocking/RequiresReason/override gate — `ToFindingDto`, `EvaluateFindings`, `ComputeOverride` |
| Modify `Odip.Api/Controllers/RosteringController.cs` | `ToFindingDto`/`EvaluateFindings`/`ApplyOverride` become thin wrappers over `RosterGate` (behaviour-preserving) |
| Modify `Odip.Application/DTOs/DTOs.cs` | `StaffAssignmentDto`/`CreateStaffAssignmentDto` gain override fields; new `CheckStaffAssignmentDto` |
| Modify `Odip.Api/Controllers/VehiclesStaffController.cs` | `StaffAssignmentsController`: inject `IStaffUnavailabilityQuery`; `POST check`; `Create`/`Update` run the gate; `HasConflict` correctly derived (fixes `Update` never recomputing it) |
| Create `Odip.Tests/Rostering/StaffAssignmentGateTests.cs` | Gate coverage per spec's Testing section |
| Modify `Odip.Tests/SameTenantValidation/SameTenantWritePathTests.cs` | Fix 3 stale 1-arg `StaffAssignmentsController` call sites (lines 410/433/454) so the suite still compiles once the constructor gains `IStaffUnavailabilityQuery` |
| Modify `Odip.Api/Controllers/ScheduleController.cs` | `IStaffUnavailabilityQuery` replaces the raw `StaffAvailability` overlap query for trip-status; new `Tentative` status |
| Create `Odip.Tests/Schedule/ScheduleControllerTests.cs` | Tentative/Unavailable/Available coverage |
| Modify `frontend/src/api/types/staff.ts` | `StaffAssignmentDto`/`CreateStaffAssignmentDto` gain override fields; new `CheckStaffAssignmentDto` |
| Modify `frontend/src/api/hooks/staff.ts` | New `useCheckStaffAssignment` |
| Modify `frontend/src/pages/schedule/StaffAssignModal.tsx` | Live check, `FindingsList`, override-reason gate, async `onAssign`; later (Task 9) its findings/reason-field JSX is extracted into `RosterGateFields` so `StaffTab`'s edit modal can reuse it without duplicating it |
| Modify `frontend/src/pages/SchedulePage.tsx` | `handleStaffAssign` becomes async/throwing so the modal can catch a 422 |
| Create `frontend/src/pages/schedule/StaffAssignModal.test.tsx` | Live check, reason gate, payload, blocking, server 422 |
| Modify `frontend/src/pages/schedule/StatusBadge.tsx` | New `Tentative` style |
| Create `frontend/src/pages/SchedulePage.test.tsx` | Tentative badge renders |
| Create `frontend/src/pages/rostering/components/RosterGateFields.tsx` | Findings list + conditional override-reason textarea + blocking message — extracted out of `StaffAssignModal.tsx` so `StaffTab`'s edit modal can share it verbatim |
| Modify `frontend/src/pages/trip-detail/StaffTab.tsx` | Acknowledged-conflict marker shows `overrideReason` on hover; edit modal gains the same live-check/`RosterGateFields`/override-reason gate as `StaffAssignModal` |
| Modify `frontend/src/pages/trip-detail/StaffTab.test.tsx` | Extend with the marker test + edit-modal gate tests |
| Modify `Odip.Api/Controllers/TasksDashboardController.cs` | `Recheck` derives staff `HasConflict` from `OverrideReason` |
| Modify `Odip.Api/Controllers/TripsController.cs` | Projects override fields |
| Modify `Odip.Api/Controllers/VehiclesStaffController.cs` | `StaffController` projection gains override fields |

---

## Task 1: `RosterConflictService` — null-participant tolerance + `CheckStaffAssignment`

**Files:**
- Modify: `Odip.Domain/Rostering/Services/RosterConflictService.cs`
- Test: `Odip.Tests/Rostering/RosterConflictServiceTests.cs`

**Interfaces:**
- Consumes: `UnavailabilityWindow`/`UnavailabilityKind` (PR 1), `RosterFinding.RequiresReason` (PR 1).
- Produces: `RosterCheckContext.Participant` is now `Participant?`; `public IReadOnlyList<RosterFinding>
  CheckStaffAssignment(DateOnly assignmentStart, DateOnly assignmentEnd, Guid excludeAssignmentId,
  RosterCheckContext ctx)` — Task 4 (`StaffAssignmentsController`) is its only caller.

**Ruling — how the trip-side check reuses `Check(Shift, ...)`'s rules:** `RosterConflictService.Check`
takes a `Shift candidate`, but a `StaffAssignment` isn't a `Shift` and its window spans multiple
days (`Shift.EndsNextDay` only ever spans one). Rather than building a fake `Shift` or duplicating
the WSC/double-booked-shift/double-booked-trip/staff-unavailable rules, this task extracts each
one's window/date-derivation into a private core that takes an explicit window/range instead of a
`Shift`, and `CheckStaffAssignment` calls those cores directly. The four `Shift`-facing methods
become one-line wrappers around their cores, so `Check(Shift, ...)`'s behaviour — including exact
message text — is unchanged; verified per-step below.

- [ ] **Step 1: `RosterCheckContext.Participant` → nullable, with a doc update**

```csharp
// Before:
/// <param name="Participant">The participant the candidate shift is for.</param>
...
public sealed record RosterCheckContext(
    User Staff,
    Participant Participant,
    IReadOnlyList<Shift> StaffShiftsInWeek,
    IReadOnlyList<Shift> ParticipantShiftsOnDate,
    IReadOnlyList<StaffAssignment> TripAssignments,
    IReadOnlyList<UnavailabilityWindow> Availability,
    CompatibilityLevel Compatibility,
    decimal WeeklyHoursThreshold);

// After:
/// <param name="Participant">The participant the candidate shift is for. Null for a trip-assignment
/// candidate (<see cref="CheckStaffAssignment"/>) — participant-scoped rules are skipped entirely
/// in that path, and <see cref="CheckCompatibility"/>/<see cref="CheckCompetencyMissing"/>/
/// <see cref="CheckRatioShortfall"/> all no-op on a null Participant so <see cref="Check"/> stays
/// safe if it's ever called with one too.</param>
...
public sealed record RosterCheckContext(
    User Staff,
    Participant? Participant,
    IReadOnlyList<Shift> StaffShiftsInWeek,
    IReadOnlyList<Shift> ParticipantShiftsOnDate,
    IReadOnlyList<StaffAssignment> TripAssignments,
    IReadOnlyList<UnavailabilityWindow> Availability,
    CompatibilityLevel Compatibility,
    decimal WeeklyHoursThreshold);
```

- [ ] **Step 2: Guard the three participant-scoped rules**

```csharp
// Before:
private static void CheckCompatibility(RosterCheckContext ctx, List<RosterFinding> findings)
{
    if (ctx.Compatibility == CompatibilityLevel.Excluded)
    {
        findings.Add(new RosterFinding(CompatibilityExcluded, RosterFindingSeverity.Warning,
            $"{ctx.Staff.FullName} is marked Excluded for {ctx.Participant.FullName}."));
    }
}

// After:
private static void CheckCompatibility(RosterCheckContext ctx, List<RosterFinding> findings)
{
    if (ctx.Participant is null) return;

    if (ctx.Compatibility == CompatibilityLevel.Excluded)
    {
        findings.Add(new RosterFinding(CompatibilityExcluded, RosterFindingSeverity.Warning,
            $"{ctx.Staff.FullName} is marked Excluded for {ctx.Participant.FullName}."));
    }
}
```

```csharp
// Before:
private static void CheckCompetencyMissing(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var staff = ctx.Staff;
    var participant = ctx.Participant;

    if ((participant.OvernightSupport != OvernightSupportType.None || candidate.NightType != SleepoverType.None)
        && !staff.IsOvernightEligible)
    ...

// After:
private static void CheckCompetencyMissing(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var staff = ctx.Staff;
    var participant = ctx.Participant;
    if (participant is null) return;

    if ((participant.OvernightSupport != OvernightSupportType.None || candidate.NightType != SleepoverType.None)
        && !staff.IsOvernightEligible)
    ...
```

(The rest of `CheckCompetencyMissing`'s body — the manual-handling and first-aid checks — is
unchanged; `participant` is now a non-null local after the guard.)

```csharp
// Before:
private static void CheckRatioShortfall(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    if (candidate.Ratio != SupportRatio.TwoToOne) return;

    var window = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);

    var covering = ctx.ParticipantShiftsOnDate
        .Where(s => Overlaps(window, ToWindow(s.ServiceDate, s.StartTime, s.EndTime, s.EndsNextDay)))
        .Select(s => s.UserId)
        .Append(candidate.UserId)
        .Where(id => id.HasValue)
        .Select(id => id!.Value)
        .Distinct()
        .Count();

    if (covering < 2)
    {
        findings.Add(new RosterFinding(RatioShortfall, RosterFindingSeverity.Warning,
            $"{ctx.Participant.FullName}'s 2:1 shift on {Fmt(candidate.ServiceDate)} has only " +
            $"{covering} of 2 support workers rostered."));
    }
}

// After:
private static void CheckRatioShortfall(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var participant = ctx.Participant;
    if (candidate.Ratio != SupportRatio.TwoToOne || participant is null) return;

    var window = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);

    var covering = ctx.ParticipantShiftsOnDate
        .Where(s => Overlaps(window, ToWindow(s.ServiceDate, s.StartTime, s.EndTime, s.EndsNextDay)))
        .Select(s => s.UserId)
        .Append(candidate.UserId)
        .Where(id => id.HasValue)
        .Select(id => id!.Value)
        .Distinct()
        .Count();

    if (covering < 2)
    {
        findings.Add(new RosterFinding(RatioShortfall, RosterFindingSeverity.Warning,
            $"{participant.FullName}'s 2:1 shift on {Fmt(candidate.ServiceDate)} has only " +
            $"{covering} of 2 support workers rostered."));
    }
}
```

- [ ] **Step 3: Extract `CheckWorkerScreening`'s date-only core**

```csharp
// Before:
private static void CheckWorkerScreening(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var expiry = ctx.Staff.WorkerScreeningExpiryDate;
    if (expiry is null)
    {
        findings.Add(new RosterFinding(WscMissing, RosterFindingSeverity.Warning,
            $"{ctx.Staff.FullName} has no worker screening recorded — confirm it before the shift."));
        return;
    }

    if (expiry.Value < candidate.ServiceDate)
    {
        findings.Add(new RosterFinding(WscExpired, RosterFindingSeverity.Blocking,
            $"{ctx.Staff.FullName}'s worker screening expired {Fmt(expiry.Value)} — cannot roster."));
    }
}

// After:
private static void CheckWorkerScreening(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    => CheckWorkerScreeningForDate(candidate.ServiceDate, ctx, findings);

/// <summary>Core WSC rule, decoupled from Shift so CheckStaffAssignment can reuse it against an assignment's start date.</summary>
private static void CheckWorkerScreeningForDate(DateOnly referenceDate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var expiry = ctx.Staff.WorkerScreeningExpiryDate;
    if (expiry is null)
    {
        findings.Add(new RosterFinding(WscMissing, RosterFindingSeverity.Warning,
            $"{ctx.Staff.FullName} has no worker screening recorded — confirm it before the shift."));
        return;
    }

    if (expiry.Value < referenceDate)
    {
        findings.Add(new RosterFinding(WscExpired, RosterFindingSeverity.Blocking,
            $"{ctx.Staff.FullName}'s worker screening expired {Fmt(expiry.Value)} — cannot roster."));
    }
}
```

- [ ] **Step 4: Extract `CheckDoubleBookedShift`'s window core**

```csharp
// Before:
private static void CheckDoubleBookedShift(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);

    foreach (var other in ctx.StaffShiftsInWeek)
    {
        if (other.Id == candidate.Id)
            continue;

        var otherWindow = ToWindow(other.ServiceDate, other.StartTime, other.EndTime, other.EndsNextDay);
        if (Overlaps(candidateWindow, otherWindow))
        {
            findings.Add(new RosterFinding(DoubleBookedShift, RosterFindingSeverity.Warning,
                $"{ctx.Staff.FullName} already has a shift on {Fmt(other.ServiceDate)} that overlaps this one."));
        }
    }
}

// After:
private static void CheckDoubleBookedShift(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);
    CheckDoubleBookedShiftForWindow(candidateWindow, candidate.Id, ctx, findings);
}

/// <summary>Core overlap rule, decoupled from Shift so CheckStaffAssignment can reuse it — excludeShiftId
/// is Guid.Empty for a trip-assignment candidate (nothing to exclude, it isn't itself a Shift row).</summary>
private static void CheckDoubleBookedShiftForWindow((DateTime Start, DateTime End) candidateWindow, Guid excludeShiftId, RosterCheckContext ctx, List<RosterFinding> findings)
{
    foreach (var other in ctx.StaffShiftsInWeek)
    {
        if (other.Id == excludeShiftId)
            continue;

        var otherWindow = ToWindow(other.ServiceDate, other.StartTime, other.EndTime, other.EndsNextDay);
        if (Overlaps(candidateWindow, otherWindow))
        {
            findings.Add(new RosterFinding(DoubleBookedShift, RosterFindingSeverity.Warning,
                $"{ctx.Staff.FullName} already has a shift on {Fmt(other.ServiceDate)} that overlaps this one."));
        }
    }
}
```

- [ ] **Step 5: Extract `CheckDoubleBookedTrip`'s range core**

```csharp
// Before:
private static void CheckDoubleBookedTrip(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    foreach (var assignment in ctx.TripAssignments)
    {
        if (assignment.AssignmentStart <= candidate.ServiceDate && candidate.ServiceDate <= assignment.AssignmentEnd)
        {
            findings.Add(new RosterFinding(DoubleBookedTrip, RosterFindingSeverity.Warning,
                $"{ctx.Staff.FullName} is assigned to a trip covering {Fmt(candidate.ServiceDate)}."));
        }
    }
}

// After:
private static void CheckDoubleBookedTrip(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    => CheckDoubleBookedTripForRange(candidate.ServiceDate, candidate.ServiceDate, Guid.Empty, ctx, findings);

/// <summary>Core overlap rule, decoupled from Shift so CheckStaffAssignment can reuse it against a
/// multi-day AssignmentStart..AssignmentEnd range; excludeAssignmentId skips the assignment's own
/// prior row on an update. For the Shift path rangeStart == rangeEnd, so the message text is
/// byte-identical to the pre-extraction version.</summary>
private static void CheckDoubleBookedTripForRange(DateOnly rangeStart, DateOnly rangeEnd, Guid excludeAssignmentId, RosterCheckContext ctx, List<RosterFinding> findings)
{
    foreach (var assignment in ctx.TripAssignments)
    {
        if (assignment.Id == excludeAssignmentId)
            continue;

        if (assignment.AssignmentStart <= rangeEnd && rangeStart <= assignment.AssignmentEnd)
        {
            var when = rangeStart == rangeEnd ? Fmt(rangeStart) : $"{Fmt(rangeStart)}-{Fmt(rangeEnd)}";
            findings.Add(new RosterFinding(DoubleBookedTrip, RosterFindingSeverity.Warning,
                $"{ctx.Staff.FullName} is assigned to a trip covering {when}."));
        }
    }
}
```

- [ ] **Step 6: Extract `CheckStaffUnavailable`'s window core**

```csharp
// Before (this is PR 1's already-shipped version):
private static void CheckStaffUnavailable(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);

    foreach (var window in ctx.Availability)
    {
        if (window.Start >= candidateWindow.End || candidateWindow.Start >= window.End)
            continue;

        switch (window.Kind)
        {
            case UnavailabilityKind.Legacy:
                findings.Add(new RosterFinding(StaffUnavailable, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} is marked unavailable for part of {Fmt(candidate.ServiceDate)}."));
                break;
            case UnavailabilityKind.ApprovedLeave:
                findings.Add(new RosterFinding(StaffOnLeave, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName}'s approved leave covers this window — cannot roster without a reason.",
                    RequiresReason: true));
                break;
            case UnavailabilityKind.PendingLeave:
                findings.Add(new RosterFinding(StaffLeavePending, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} has a pending leave request covering this window."));
                break;
            case UnavailabilityKind.RecurringRule:
                findings.Add(new RosterFinding(StaffRecurringUnavailable, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} is recurringly unavailable {window.Start:dddd} {window.Start:HH:mm}-{window.End:HH:mm}.",
                    RequiresReason: true));
                break;
        }
    }
}

// After:
private static void CheckStaffUnavailable(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);
    CheckStaffUnavailableForWindow(candidateWindow, candidate.ServiceDate, ctx, findings);
}

/// <summary>Core rule, decoupled from Shift so CheckStaffAssignment can reuse it. referenceDate is
/// only used in the Legacy-kind message text (the ApprovedLeave/PendingLeave/RecurringRule
/// messages don't need one) — for the Shift path this is candidate.ServiceDate, byte-identical to
/// the pre-extraction message; for the trip path this is the assignment's start date.</summary>
private static void CheckStaffUnavailableForWindow((DateTime Start, DateTime End) candidateWindow, DateOnly referenceDate, RosterCheckContext ctx, List<RosterFinding> findings)
{
    foreach (var window in ctx.Availability)
    {
        if (window.Start >= candidateWindow.End || candidateWindow.Start >= window.End)
            continue;

        switch (window.Kind)
        {
            case UnavailabilityKind.Legacy:
                findings.Add(new RosterFinding(StaffUnavailable, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} is marked unavailable for part of {Fmt(referenceDate)}."));
                break;
            case UnavailabilityKind.ApprovedLeave:
                findings.Add(new RosterFinding(StaffOnLeave, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName}'s approved leave covers this window — cannot roster without a reason.",
                    RequiresReason: true));
                break;
            case UnavailabilityKind.PendingLeave:
                findings.Add(new RosterFinding(StaffLeavePending, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} has a pending leave request covering this window."));
                break;
            case UnavailabilityKind.RecurringRule:
                findings.Add(new RosterFinding(StaffRecurringUnavailable, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} is recurringly unavailable {window.Start:dddd} {window.Start:HH:mm}-{window.End:HH:mm}.",
                    RequiresReason: true));
                break;
        }
    }
}
```

- [ ] **Step 7: Add `CheckStaffAssignment`**

Add this public method after `Check` (the pipeline runner), before the private `Check*` methods:

```csharp
/// <summary>
/// Trip-side analogue of <see cref="Check(Shift, RosterCheckContext)"/> for a candidate
/// StaffAssignment: WSC, double-booked-shift, double-booked-trip and staff-unavailability rules
/// only — participant-scoped rules (compatibility, credential/competency, ratio, over-hours) are
/// skipped outright rather than merely tolerated, since a trip assignment carries no participant
/// at all. See docs/specs/2026-09-07-staff-leave-unavailability-design.md §3. Trip windows are
/// whole days: AssignmentStart 00:00 through the day AFTER AssignmentEnd at 00:00 (AssignmentEnd
/// itself is inclusive). ctx.Participant is expected to be null — build the context the same way
/// StaffAssignmentsController.CheckAsync does.
/// </summary>
public IReadOnlyList<RosterFinding> CheckStaffAssignment(
    DateOnly assignmentStart, DateOnly assignmentEnd, Guid excludeAssignmentId, RosterCheckContext ctx)
{
    ArgumentNullException.ThrowIfNull(ctx);

    var findings = new List<RosterFinding>();
    var window = (Start: assignmentStart.ToDateTime(TimeOnly.MinValue), End: assignmentEnd.AddDays(1).ToDateTime(TimeOnly.MinValue));

    CheckWorkerScreeningForDate(assignmentStart, ctx, findings);
    CheckDoubleBookedShiftForWindow(window, Guid.Empty, ctx, findings);
    CheckDoubleBookedTripForRange(assignmentStart, assignmentEnd, excludeAssignmentId, ctx, findings);
    CheckStaffUnavailableForWindow(window, assignmentStart, ctx, findings);

    return findings;
}
```

- [ ] **Step 8: Build**

Run: `dotnet build`
Expected: 0 errors. `Odip.Tests/Rostering/RosterConflictServiceTests.cs`'s `CompliantContext` helper
still compiles (a `Participant` argument widens fine to `Participant?`).

- [ ] **Step 9: Retype `CompliantContext`'s `participant` parameter**

```csharp
// Before:
    private static RosterCheckContext CompliantContext(
        User staff,
        Participant participant,
        IReadOnlyList<Shift>? staffShiftsInWeek = null,
        IReadOnlyList<Shift>? participantShiftsOnDate = null,
        IReadOnlyList<StaffAssignment>? tripAssignments = null,
        IReadOnlyList<UnavailabilityWindow>? availability = null,
        CompatibilityLevel compatibility = CompatibilityLevel.Allowed,
        decimal weeklyHoursThreshold = RosterConflictService.DefaultWeeklyHoursThreshold) => new(

// After:
    private static RosterCheckContext CompliantContext(
        User staff,
        Participant? participant,
        IReadOnlyList<Shift>? staffShiftsInWeek = null,
        IReadOnlyList<Shift>? participantShiftsOnDate = null,
        IReadOnlyList<StaffAssignment>? tripAssignments = null,
        IReadOnlyList<UnavailabilityWindow>? availability = null,
        CompatibilityLevel compatibility = CompatibilityLevel.Allowed,
        decimal weeklyHoursThreshold = RosterConflictService.DefaultWeeklyHoursThreshold) => new(
```

(The rest of the helper — the `Staff:`/`Participant:`/... named-argument body — is unchanged.)

- [ ] **Step 10: Write the failing tests**

Append to `Odip.Tests/Rostering/RosterConflictServiceTests.cs`:

```csharp
    // ── Trip-side parity: null-participant tolerance + CheckStaffAssignment ──

    [Fact]
    public void Check_ToleratesNullParticipant_SkipsParticipantScopedFindings()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, null, compatibility: CompatibilityLevel.Excluded));

        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.CompatibilityExcluded);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.CompetencyMissing);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.RatioShortfall);
    }

    [Fact]
    public void CheckStaffAssignment_ApprovedLeaveOverlappingWholeDayWindow_FiresStaffOnLeave()
    {
        var staff = CompliantStaff();
        var window = new UnavailabilityWindow(staff.Id,
            new DateTime(2026, 9, 10), new DateTime(2026, 9, 13), UnavailabilityKind.ApprovedLeave);
        var ctx = CompliantContext(staff, null, availability: new[] { window });

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 11), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffOnLeave);
        Assert.True(finding.RequiresReason);
    }

    [Fact]
    public void CheckStaffAssignment_NeverProducesParticipantScopedCodes()
    {
        var staff = CompliantStaff();
        var ctx = CompliantContext(staff, null, compatibility: CompatibilityLevel.Excluded);

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 11), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.CompatibilityExcluded);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.CompetencyMissing);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.RatioShortfall);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.OverHours);
    }

    [Fact]
    public void CheckStaffAssignment_ExpiredScreeningAtAssignmentStart_FiresBlockingWscExpired()
    {
        var staff = CompliantStaff();
        staff.WorkerScreeningExpiryDate = new DateOnly(2026, 9, 1);
        var ctx = CompliantContext(staff, null);

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.WscExpired);
        Assert.Equal(RosterFindingSeverity.Blocking, finding.Severity);
    }

    [Fact]
    public void CheckStaffAssignment_ExcludesItsOwnPriorAssignmentFromDoubleBookedTrip()
    {
        var staff = CompliantStaff();
        var selfId = Guid.NewGuid();
        var selfAssignment = new StaffAssignment
        {
            Id = selfId, UserId = staff.Id, TripInstanceId = Guid.NewGuid(),
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
        };
        var ctx = CompliantContext(staff, null, tripAssignments: new[] { selfAssignment });

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), selfId, ctx);

        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.DoubleBookedTrip);
    }

    [Fact]
    public void CheckStaffAssignment_OverlappingOtherTripAssignment_FiresDoubleBookedTrip()
    {
        var staff = CompliantStaff();
        var other = new StaffAssignment
        {
            Id = Guid.NewGuid(), UserId = staff.Id, TripInstanceId = Guid.NewGuid(),
            AssignmentStart = new DateOnly(2026, 9, 11), AssignmentEnd = new DateOnly(2026, 9, 13),
        };
        var ctx = CompliantContext(staff, null, tripAssignments: new[] { other });

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedTrip));
    }

    [Fact]
    public void CheckStaffAssignment_OverlappingShiftInWindow_FiresDoubleBookedShift()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var shift = CandidateShift(staff, participant, serviceDate: new DateOnly(2026, 9, 11));
        var ctx = CompliantContext(staff, null, staffShiftsInWeek: new[] { shift });

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedShift));
    }
```

- [ ] **Step 11: Run to confirm the new tests pass and the whole suite is unaffected**

Run: `dotnet test --filter "FullyQualifiedName~RosterConflictServiceTests"`
Expected: `Failed: 0` — every pre-existing test still passes unchanged (the extractions are
byte-identical for the Shift path; only new tests were added, nothing was removed or reworded).

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0` (this task touches nothing `RosteringController.cs`/
`RosteringControllerTests.cs` depend on beyond the already-nullable-compatible `Participant`
argument, so no other suite is affected).

- [ ] **Step 12: Commit**

```bash
git add Odip.Domain/Rostering/Services/RosterConflictService.cs Odip.Tests/Rostering/RosterConflictServiceTests.cs
git commit -m "feat(leave): RosterConflictService.CheckStaffAssignment + null-participant tolerance

Extracts the WSC/double-booked-shift/double-booked-trip/staff-unavailable
rules into Shift-decoupled cores so the trip-assignment check reuses them
instead of duplicating them. Check(Shift, ...) behaviour is unchanged.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 2: `RosterGate` — shared Blocking/RequiresReason/override gate

**Files:**
- Create: `Odip.Api/Rostering/RosterGate.cs`
- Modify: `Odip.Api/Controllers/RosteringController.cs`

**Interfaces:**
- Consumes: `RosterFinding`, `RosterFindingSeverity` (`Odip.Domain.Rostering.Services`);
  `RosterFindingDto`, `ApiResponse<T>` (`Odip.Application`).
- Produces: `public static class RosterGate { public static RosterFindingDto ToFindingDto(RosterFinding
  f); public static ApiResponse<List<RosterFindingDto>>? EvaluateFindings(List<RosterFinding>
  findings, string? overrideReason, string subject = "shift"); public static (string?
  OverrideReason, string? AcknowledgedFindingCodes) ComputeOverride(List<RosterFinding> findings,
  string? overrideReason, List<string>? acknowledgedCodes); }` — Task 4
  (`StaffAssignmentsController`) is its other caller.

This is a pure refactor — no behaviour change for `RosteringController`. The regression net is the
existing `RosteringControllerTests.cs` suite (unchanged by this task).

- [ ] **Step 1: Write `RosterGate.cs`**

```csharp
// Odip.Api/Rostering/RosterGate.cs (new file)
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering.Services;

namespace Odip.Api.Rostering;

/// <summary>
/// The Blocking/RequiresReason/override gate every roster-checked write runs through, shared by
/// RosteringController (shifts) and StaffAssignmentsController (trip-side parity) so the two
/// controllers can't drift. Moved verbatim out of RosteringController, which now delegates to it
/// — see that controller's own EvaluateFindings/ApplyOverride, both now one-line wrappers.
/// </summary>
public static class RosterGate
{
    public static RosterFindingDto ToFindingDto(RosterFinding f) => new()
    {
        Code = f.Code, Severity = f.Severity, Message = f.Message, RequiresReason = f.RequiresReason
    };

    /// <summary>
    /// Any Blocking finding rejects the write regardless of <paramref name="overrideReason"/>; any
    /// finding with RequiresReason true needs a non-empty reason; a write whose findings are all
    /// RequiresReason == false may proceed with no reason at all (ComputeOverride still records
    /// their codes in AcknowledgedFindingCodes, so the UI can show why a cell looks tentative
    /// without ever having asked for input). Returns the 422 response body to return, or null when
    /// the write may proceed. <paramref name="subject"/> only changes the wording of the two
    /// rejection messages ("shift" for RosteringController, "trip assignment" for
    /// StaffAssignmentsController) — it keeps RosteringController's existing message text
    /// byte-identical when called with the default.
    /// </summary>
    public static ApiResponse<List<RosterFindingDto>>? EvaluateFindings(List<RosterFinding> findings, string? overrideReason, string subject = "shift")
    {
        if (findings.Count == 0) return null;

        var findingDtos = findings.Select(ToFindingDto).ToList();
        var errors = findings.Select(f => f.Message).ToList();

        if (findings.Any(f => f.Severity == RosterFindingSeverity.Blocking))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, $"One or more blocking findings prevent this {subject} from being saved.");
        }

        if (findings.Any(f => f.RequiresReason) && string.IsNullOrWhiteSpace(overrideReason))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, $"This {subject} has warnings that must be acknowledged with an override reason before it can be saved.");
        }

        return null;
    }

    /// <summary>
    /// Computes the (OverrideReason, AcknowledgedFindingCodes) pair a write should persist, given
    /// the findings EvaluateFindings already approved. Returns values rather than mutating an
    /// entity so both Shift and StaffAssignment (different entities, same two field names) can use
    /// it from their own controller.
    /// </summary>
    public static (string? OverrideReason, string? AcknowledgedFindingCodes) ComputeOverride(
        List<RosterFinding> findings, string? overrideReason, List<string>? acknowledgedCodes)
    {
        if (findings.Count == 0) return (null, null);

        var codes = acknowledgedCodes is { Count: > 0 } ? acknowledgedCodes : findings.Select(f => f.Code).Distinct();
        return (overrideReason, string.Join(",", codes));
    }
}
```

- [ ] **Step 2: `RosteringController` — delegate to `RosterGate`**

Add `using Odip.Api.Rostering;` to the top of `RosteringController.cs`, alongside the existing
`using Odip.Infrastructure.Services;`.

```csharp
// Before:
    private static RosterFindingDto ToFindingDto(RosterFinding f) => new() { Code = f.Code, Severity = f.Severity, Message = f.Message, RequiresReason = f.RequiresReason };

// After:
    private static RosterFindingDto ToFindingDto(RosterFinding f) => RosterGate.ToFindingDto(f);
```

```csharp
// Before:
    private ApiResponse<List<RosterFindingDto>>? EvaluateFindings(List<RosterFinding> findings, string? overrideReason)
    {
        if (findings.Count == 0) return null;

        var findingDtos = findings.Select(ToFindingDto).ToList();
        var errors = findings.Select(f => f.Message).ToList();

        if (findings.Any(f => f.Severity == RosterFindingSeverity.Blocking))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, "One or more blocking findings prevent this shift from being saved.");
        }

        if (findings.Any(f => f.RequiresReason) && string.IsNullOrWhiteSpace(overrideReason))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, "This shift has warnings that must be acknowledged with an override reason before it can be saved.");
        }

        return null;
    }

// After:
    private ApiResponse<List<RosterFindingDto>>? EvaluateFindings(List<RosterFinding> findings, string? overrideReason) =>
        RosterGate.EvaluateFindings(findings, overrideReason);
```

```csharp
// Before:
    private static void ApplyOverride(Shift shift, List<RosterFinding> findings, string? overrideReason, List<string>? acknowledgedCodes)
    {
        if (findings.Count == 0)
        {
            shift.OverrideReason = null;
            shift.AcknowledgedFindingCodes = null;
            return;
        }

        shift.OverrideReason = overrideReason;
        var codes = acknowledgedCodes is { Count: > 0 } ? acknowledgedCodes : findings.Select(f => f.Code).Distinct();
        shift.AcknowledgedFindingCodes = string.Join(",", codes);
    }

// After:
    private static void ApplyOverride(Shift shift, List<RosterFinding> findings, string? overrideReason, List<string>? acknowledgedCodes)
    {
        var (reason, codes) = RosterGate.ComputeOverride(findings, overrideReason, acknowledgedCodes);
        shift.OverrideReason = reason;
        shift.AcknowledgedFindingCodes = codes;
    }
```

- [ ] **Step 3: Build and run the full regression net**

Run: `dotnet build`
Expected: 0 errors.

Run: `dotnet test --filter "FullyQualifiedName~RosteringControllerTests|FullyQualifiedName~RosteringAuditTests"`
Expected: `Failed: 0` — every existing test passes with identical assertions; the wrappers produce
byte-identical output to the code they replaced.

Run: `dotnet test`
Expected: `Failed: 0`.

- [ ] **Step 4: Commit**

```bash
git add Odip.Api/Rostering/RosterGate.cs Odip.Api/Controllers/RosteringController.cs
git commit -m "refactor(rostering): extract the Blocking/RequiresReason/override gate into RosterGate

Behaviour-preserving — RosteringController.EvaluateFindings/ToFindingDto/
ApplyOverride are now thin wrappers. StaffAssignmentsController (trip-side
parity) will share the same gate rather than re-implementing it.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 3: DTOs — `StaffAssignmentDto`/`CreateStaffAssignmentDto` overrides + `CheckStaffAssignmentDto`

**Files:**
- Modify: `Odip.Application/DTOs/DTOs.cs:1416-1448`

**Interfaces:**
- Produces: `StaffAssignmentDto.OverrideReason`/`AcknowledgedFindingCodes` (both `string?`);
  `CreateStaffAssignmentDto.OverrideReason` (`string?`) and `.AcknowledgedFindingCodes`
  (`List<string>?`, inherited by `UpdateStaffAssignmentDto`); new `CheckStaffAssignmentDto` record.

**Ruling — `CheckStaffAssignmentDto` carries `TripInstanceId` though the check itself never reads
it:** mirrors `CreateStaffAssignmentDto`'s shape and keeps the dry-run request self-describing (a
caller can log/display which trip a check was against) even though `RosterConflictService.
CheckStaffAssignment` has no participant/trip-scoped rule that would use it today.

**Ruling — `CreateStaffAssignmentDto` also gains `AcknowledgedFindingCodes` (`List<string>?`)
though the brief names only `overrideReason`:** `RosterGate.ComputeOverride` needs an explicit
acknowledged-codes list to default correctly, the same as `CreateShiftDto.AcknowledgedFindingCodes`
already does for shifts — the frontend can now send exactly which codes it acknowledged instead of
letting the server infer "every current code," matching the existing Shift pattern exactly.

- [ ] **Step 1: Extend `StaffAssignmentDto`, `CreateStaffAssignmentDto`, add `CheckStaffAssignmentDto`**

```csharp
// Before (DTOs.cs:1416-1431):
public record StaffAssignmentDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid StaffId { get; init; }
    public string? StaffName { get; init; }
    public string? AssignmentRole { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public AssignmentStatus Status { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; }
    public string? ShiftNotes { get; init; }
    public bool HasConflict { get; init; }
}

// After:
public record StaffAssignmentDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid StaffId { get; init; }
    public string? StaffName { get; init; }
    public string? AssignmentRole { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public AssignmentStatus Status { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; }
    public string? ShiftNotes { get; init; }
    public bool HasConflict { get; init; }
    public string? OverrideReason { get; init; }
    public string? AcknowledgedFindingCodes { get; init; }
}
```

```csharp
// Before (DTOs.cs:1433-1443):
public record CreateStaffAssignmentDto
{
    public Guid TripInstanceId { get; init; }
    public Guid StaffId { get; init; }
    public string? AssignmentRole { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; } = SleepoverType.None;
    public string? ShiftNotes { get; init; }
}

// After:
public record CreateStaffAssignmentDto
{
    public Guid TripInstanceId { get; init; }
    public Guid StaffId { get; init; }
    public string? AssignmentRole { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; } = SleepoverType.None;
    public string? ShiftNotes { get; init; }
    /// <summary>Required when the candidate carries a RequiresReason finding; ignored (never enough) for a Blocking finding.</summary>
    public string? OverrideReason { get; init; }
    /// <summary>Finding codes the coordinator is acknowledging. Defaults to every current finding's code when omitted.</summary>
    public List<string>? AcknowledgedFindingCodes { get; init; }
}
```

`UpdateStaffAssignmentDto : CreateStaffAssignmentDto` (DTOs.cs:1445-1448) is unchanged — it
inherits both new properties automatically.

Add `CheckStaffAssignmentDto` immediately after `UpdateStaffAssignmentDto`:

```csharp
/// <summary>Dry-run input for POST /staff-assignments/check — mirrors CheckShiftDto's shape for the trip-assignment analogue.</summary>
public record CheckStaffAssignmentDto
{
    public Guid StaffId { get; init; }
    public Guid TripInstanceId { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    /// <summary>The existing assignment being re-checked, if any — excluded from its own conflict queries. Null for a brand-new candidate.</summary>
    public Guid? ExcludeAssignmentId { get; init; }
}
```

- [ ] **Step 2: Build**

Run: `dotnet build`
Expected: 0 errors — `StaffAssignmentsController`'s existing DTO literals (`new StaffAssignmentDto {
... }`) don't set the two new properties yet, which is fine (they default to `null`); Task 4 sets
them.

- [ ] **Step 3: Commit**

```bash
git add Odip.Application/DTOs/DTOs.cs
git commit -m "feat(leave): StaffAssignmentDto override fields + CheckStaffAssignmentDto

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 4: `StaffAssignmentsController` — dry-run check + gated create/update

**Files:**
- Modify: `Odip.Api/Controllers/VehiclesStaffController.cs:601-704`
- Modify: `Odip.Tests/SameTenantValidation/SameTenantWritePathTests.cs:410,433,454`
- Test: `Odip.Tests/Rostering/StaffAssignmentGateTests.cs`

**Interfaces:**
- Consumes: `IStaffUnavailabilityQuery` (PR 1), `RosterConflictService.CheckStaffAssignment`
  (Task 1), `RosterGate.EvaluateFindings`/`ComputeOverride`/`ToFindingDto` (Task 2),
  `CheckStaffAssignmentDto` (Task 3).
- Produces: `POST api/v1/staff-assignments/check`; `Create`/`Update` now run the same gate as
  shifts; `HasConflict` correctly derived on both (fixes `Update`, which never recomputed it
  before this task).

**Ruling — `Update` previously never recomputed `HasConflict` at all** (confirmed by reading the
current method: it copies every field from the DTO except `HasConflict`, leaving whatever value
was set at `Create` time frozen forever, even after the assignment's dates/staff changed). This
task fixes that as part of wiring the gate — there is no way to run the gate on `Update` without
also correctly deriving `HasConflict` from its result.

- [ ] **Step 1: Write the failing tests**

Create `Odip.Tests/Rostering/StaffAssignmentGateTests.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// StaffAssignmentsController's trip-side parity with RosteringController: the same
/// Blocking/RequiresReason/override gate (via RosterGate), HasConflict correctly derived on both
/// create and update, /check never writing. See
/// docs/specs/2026-09-07-staff-leave-unavailability-design.md §3, Testing section.
/// </summary>
public class StaffAssignmentGateTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedStaff(OdipDbContext db)
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        };
        db.Users.Add(staff);
        db.SaveChanges();
        return staff;
    }

    private static TripInstance SeedTrip(OdipDbContext db, DateOnly start, int days = 5)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Trip", StartDate = start, DurationDays = days };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static void SeedApprovedLeave(OdipDbContext db, Guid userId, DateOnly start, DateOnly end)
    {
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual,
            StartDate = start, EndDate = end, Status = LeaveStatus.Approved,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
    }

    private static void SeedPendingLeave(OdipDbContext db, Guid userId, DateOnly start, DateOnly end)
    {
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual,
            StartDate = start, EndDate = end, Status = LeaveStatus.Pending,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
    }

    private static CreateStaffAssignmentDto CreateDto(Guid tripId, Guid staffId, DateOnly start, DateOnly end, string? overrideReason = null) => new()
    {
        TripInstanceId = tripId, StaffId = staffId, AssignmentStart = start, AssignmentEnd = end,
        IsDriver = false, SleepoverType = SleepoverType.None, OverrideReason = overrideReason,
    };

    [Fact]
    public async Task Check_ApprovedLeaveOverlap_ReturnsStaffOnLeaveFinding_AndNeverWrites()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedApprovedLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = new CheckStaffAssignmentDto
        {
            StaffId = staff.Id, TripInstanceId = trip.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
        };

        var result = await controller.Check(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.StaffOnLeave && f.RequiresReason);
        Assert.Empty(await db.StaffAssignments.ToListAsync());
    }

    [Fact]
    public async Task Create_ApprovedLeaveOverlap_NoReason_Returns422_AndDoesNotSave()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedApprovedLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Empty(await db.StaffAssignments.ToListAsync());
    }

    [Fact]
    public async Task Create_ApprovedLeaveOverlap_WithReason_Succeeds_SetsHasConflictTrue_RecordsCode()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedApprovedLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), overrideReason: "Approved by manager, staff volunteered.");

        var result = await controller.Create(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.True(body.Data!.HasConflict);
        Assert.Equal("Approved by manager, staff volunteered.", body.Data.OverrideReason);
        Assert.Contains(RosterConflictService.StaffOnLeave, body.Data.AcknowledgedFindingCodes);

        var saved = await db.StaffAssignments.SingleAsync();
        Assert.True(saved.HasConflict);
    }

    [Fact]
    public async Task Create_PendingLeaveOverlap_NoReason_Succeeds_HasConflictFalse_CodeStillRecorded()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedPendingLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var result = await controller.Create(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.Null(body.Data.OverrideReason);
        Assert.Contains(RosterConflictService.StaffLeavePending, body.Data.AcknowledgedFindingCodes);
    }

    [Fact]
    public async Task Update_MovingOutOfLeaveWindow_ClearsHasConflictAndOverrideReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10), days: 10);
        SeedApprovedLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var createResult = await controller.Create(
            CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), overrideReason: "Covering shortfall."),
            CancellationToken.None);
        var created = ((ApiResponse<StaffAssignmentDto>)((OkObjectResult)createResult.Result!).Value!).Data!;
        Assert.True(created.HasConflict);

        var updateDto = new UpdateStaffAssignmentDto
        {
            TripInstanceId = trip.Id, StaffId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 15), AssignmentEnd = new DateOnly(2026, 9, 17),
            IsDriver = false, SleepoverType = SleepoverType.None, Status = AssignmentStatus.Confirmed,
        };
        var updateResult = await controller.Update(created.Id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.Null(body.Data.OverrideReason);
    }

    [Fact]
    public async Task Update_SameDatesUnchanged_DoesNotFlagDoubleBookedAgainstItself()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10), days: 3);

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var createResult = await controller.Create(
            CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12)),
            CancellationToken.None);
        var created = ((ApiResponse<StaffAssignmentDto>)((OkObjectResult)createResult.Result!).Value!).Data!;

        var updateDto = new UpdateStaffAssignmentDto
        {
            TripInstanceId = trip.Id, StaffId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
            IsDriver = true, SleepoverType = SleepoverType.None, Status = AssignmentStatus.Confirmed,
        };
        var updateResult = await controller.Update(created.Id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.True(body.Data.IsDriver);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~StaffAssignmentGateTests"`
Expected: build error — `StaffAssignmentsController.Check` doesn't exist yet, and the 2-argument
constructor doesn't match `new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db))`.

- [ ] **Step 3: Implement — constructor, `CheckAsync`, `Check`**

Add `using Odip.Domain.Rostering.Services;` and `using Odip.Infrastructure.Rostering;` and `using
Odip.Api.Rostering;` to the top of `VehiclesStaffController.cs`, alongside the existing usings.

```csharp
// Before (VehiclesStaffController.cs:604-616):
public class StaffAssignmentsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public StaffAssignmentsController(OdipDbContext db) => _db = db;

    /// <summary>
    /// §4.4 same-tenant validation for the trip staffing assignment's staff/user ref (required,
    /// not nullable, on this DTO): must resolve to an active User — same-tenant scoping comes for
    /// free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidStaffRefAsync(Guid userId, CancellationToken ct) =>
        _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct);

// After:
public class StaffAssignmentsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IStaffUnavailabilityQuery _unavailabilityQuery;
    private readonly RosterConflictService _conflictService = new();

    public StaffAssignmentsController(OdipDbContext db, IStaffUnavailabilityQuery unavailabilityQuery)
    {
        _db = db;
        _unavailabilityQuery = unavailabilityQuery;
    }

    /// <summary>
    /// §4.4 same-tenant validation for the trip staffing assignment's staff/user ref (required,
    /// not nullable, on this DTO): must resolve to an active User — same-tenant scoping comes for
    /// free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidStaffRefAsync(Guid userId, CancellationToken ct) =>
        _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct);

    /// <summary>
    /// Builds the RosterCheckContext for a candidate trip assignment and runs
    /// RosterConflictService.CheckStaffAssignment — the trip-side analogue of
    /// RosteringController.CheckAsync. Participant is left null: a trip assignment has no
    /// participant-scoped rules to evaluate. excludeAssignmentId is the assignment's own prior Id
    /// on an update (or Guid.Empty for a brand-new candidate / the dry-run check), so an
    /// assignment never conflicts with itself.
    /// </summary>
    private async Task<List<RosterFinding>> CheckAsync(
        Guid staffId, DateOnly assignmentStart, DateOnly assignmentEnd, Guid excludeAssignmentId, CancellationToken ct)
    {
        var staff = await _db.Users.FirstOrDefaultAsync(u => u.Id == staffId, ct);
        if (staff is null)
            return new List<RosterFinding>();

        var staffShiftsInWindow = await _db.Shifts
            .Where(s => s.UserId == staffId && s.ServiceDate >= assignmentStart && s.ServiceDate <= assignmentEnd)
            .ToListAsync(ct);

        var otherTripAssignments = await _db.StaffAssignments
            .Where(a => a.UserId == staffId && a.Id != excludeAssignmentId && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= assignmentEnd && a.AssignmentEnd >= assignmentStart)
            .ToListAsync(ct);

        var availability = await _unavailabilityQuery.GetWindowsAsync(new[] { staffId }, assignmentStart, assignmentEnd, ct);

        var ctx = new RosterCheckContext(staff, null, staffShiftsInWindow, Array.Empty<Shift>(),
            otherTripAssignments, availability, CompatibilityLevel.Allowed, RosterConflictService.DefaultWeeklyHoursThreshold);

        return _conflictService.CheckStaffAssignment(assignmentStart, assignmentEnd, excludeAssignmentId, ctx).ToList();
    }

    /// <summary>Dry-run findings for a candidate trip assignment. Never writes — mirrors POST /rostering/shifts/check.</summary>
    [HttpPost("check")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<RosterFindingDto>>>> Check([FromBody] CheckStaffAssignmentDto dto, CancellationToken ct)
    {
        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<List<RosterFindingDto>>.Fail("Staff member not found."));

        var findings = await CheckAsync(dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, dto.ExcludeAssignmentId ?? Guid.Empty, ct);
        return Ok(ApiResponse<List<RosterFindingDto>>.Ok(findings.Select(RosterGate.ToFindingDto).ToList()));
    }
```

- [ ] **Step 4: Fix `SameTenantWritePathTests.cs`'s three stale 1-arg constructor call sites**

`StaffAssignmentsController` now takes a second constructor argument (`IStaffUnavailabilityQuery`)
as of Step 3 above. `Odip.Tests/SameTenantValidation/SameTenantWritePathTests.cs` has three existing
tests that still construct it with the old 1-arg form — unrelated to this PR's own scope (they cover
§4.4 same-tenant validation, already shipped), but they will fail to compile the moment Step 3
lands. Add `using Odip.Infrastructure.Rostering;` to that file's using block, immediately after the
existing `using Odip.Infrastructure.Data;`:

```csharp
// Before (SameTenantWritePathTests.cs:1-14):
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

// After:
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
```

Then fix each of the three call sites — same "Before"/"After" edit applied three times, once per
line:

```csharp
// Before (SameTenantWritePathTests.cs:410, inside StaffAssignments_Create_StaffFromAnotherTenant_ReturnsBadRequest):
        var controller = new StaffAssignmentsController(db);

// After:
        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
```

```csharp
// Before (SameTenantWritePathTests.cs:433, inside StaffAssignments_Create_InactiveStaff_ReturnsBadRequest):
        var controller = new StaffAssignmentsController(db);

// After:
        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
```

```csharp
// Before (SameTenantWritePathTests.cs:454, inside StaffAssignments_Update_StaffFromAnotherTenant_ReturnsBadRequest):
        var controller = new StaffAssignmentsController(db);

// After:
        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
```

None of these three tests exercise `Check`, `Create`'s gate, or `Update`'s gate — they only assert
the pre-existing same-tenant `BadRequest` behaviour, which Steps 4/5 below don't touch — so the
2-arg constructor is the only change these three call sites need.

- [ ] **Step 5: Rewrite `Create`**

```csharp
// Before (VehiclesStaffController.cs:617-663):
    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Create([FromBody] CreateStaffAssignmentDto dto, CancellationToken ct)
    {
        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAssignmentDto>.Fail("Staff member not found."));

        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId, UserId = dto.StaffId,
            AssignmentRole = dto.AssignmentRole, AssignmentStart = dto.AssignmentStart,
            AssignmentEnd = dto.AssignmentEnd, IsDriver = dto.IsDriver,
            SleepoverType = dto.SleepoverType, ShiftNotes = dto.ShiftNotes
        };

        // Check staff overlap conflict
        var hasConflict = await _db.StaffAssignments
            .AnyAsync(a => a.UserId == dto.StaffId && a.Id != assignment.Id
                && a.Status != AssignmentStatus.Cancelled
                && a.AssignmentStart <= dto.AssignmentEnd && a.AssignmentEnd >= dto.AssignmentStart, ct);

        // Check staff availability conflict
        if (!hasConflict)
        {
            var startDt = dto.AssignmentStart.ToDateTime(TimeOnly.MinValue);
            var endDt = dto.AssignmentEnd.ToDateTime(TimeOnly.MaxValue);
            hasConflict = await _db.StaffAvailabilities
                .AnyAsync(sa => sa.UserId == dto.StaffId
                    && (sa.AvailabilityType == AvailabilityType.Unavailable || sa.AvailabilityType == AvailabilityType.Leave)
                    && sa.StartDateTime < endDt && sa.EndDateTime > startDt, ct);
        }

        assignment.HasConflict = hasConflict;
        _db.StaffAssignments.Add(assignment);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(assignment).Reference(a => a.TripInstance).LoadAsync(ct);
        await _db.Entry(assignment).Reference(a => a.User).LoadAsync(ct);
        return Ok(ApiResponse<StaffAssignmentDto>.Ok(new StaffAssignmentDto
        {
            Id = assignment.Id, TripInstanceId = assignment.TripInstanceId, TripName = assignment.TripInstance?.TripName,
            StaffId = assignment.UserId,
            StaffName = assignment.User != null ? assignment.User.FirstName + " " + assignment.User.LastName : null,
            AssignmentRole = assignment.AssignmentRole, AssignmentStart = assignment.AssignmentStart, AssignmentEnd = assignment.AssignmentEnd,
            Status = assignment.Status, IsDriver = assignment.IsDriver, SleepoverType = assignment.SleepoverType,
            ShiftNotes = assignment.ShiftNotes, HasConflict = hasConflict
        }));
    }

// After:
    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Create([FromBody] CreateStaffAssignmentDto dto, CancellationToken ct)
    {
        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAssignmentDto>.Fail("Staff member not found."));

        var findings = await CheckAsync(dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, Guid.Empty, ct);
        var rejection = RosterGate.EvaluateFindings(findings, dto.OverrideReason, "trip assignment");
        if (rejection != null) return UnprocessableEntity(rejection);

        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId, UserId = dto.StaffId,
            AssignmentRole = dto.AssignmentRole, AssignmentStart = dto.AssignmentStart,
            AssignmentEnd = dto.AssignmentEnd, IsDriver = dto.IsDriver,
            SleepoverType = dto.SleepoverType, ShiftNotes = dto.ShiftNotes
        };

        var (overrideReason, codes) = RosterGate.ComputeOverride(findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
        assignment.OverrideReason = overrideReason;
        assignment.AcknowledgedFindingCodes = codes;
        assignment.HasConflict = overrideReason != null;

        _db.StaffAssignments.Add(assignment);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(assignment).Reference(a => a.TripInstance).LoadAsync(ct);
        await _db.Entry(assignment).Reference(a => a.User).LoadAsync(ct);
        return Ok(ApiResponse<StaffAssignmentDto>.Ok(new StaffAssignmentDto
        {
            Id = assignment.Id, TripInstanceId = assignment.TripInstanceId, TripName = assignment.TripInstance?.TripName,
            StaffId = assignment.UserId,
            StaffName = assignment.User != null ? assignment.User.FirstName + " " + assignment.User.LastName : null,
            AssignmentRole = assignment.AssignmentRole, AssignmentStart = assignment.AssignmentStart, AssignmentEnd = assignment.AssignmentEnd,
            Status = assignment.Status, IsDriver = assignment.IsDriver, SleepoverType = assignment.SleepoverType,
            ShiftNotes = assignment.ShiftNotes, HasConflict = assignment.HasConflict,
            OverrideReason = assignment.OverrideReason, AcknowledgedFindingCodes = assignment.AcknowledgedFindingCodes
        }));
    }
```

`AvailabilityType` is no longer referenced by this controller — leave the `using
Odip.Domain.Enums;` at the top of the file, since `SleepoverType`/`AssignmentStatus`/
`CompatibilityLevel` (all in `Odip.Domain.Enums`) are still used throughout.

- [ ] **Step 6: Rewrite `Update`**

```csharp
// Before (VehiclesStaffController.cs:665-691):
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Update(Guid id, [FromBody] UpdateStaffAssignmentDto dto, CancellationToken ct)
    {
        var a = await _db.StaffAssignments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<StaffAssignmentDto>.Fail("Assignment not found"));

        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAssignmentDto>.Fail("Staff member not found."));

        a.UserId = dto.StaffId; a.AssignmentRole = dto.AssignmentRole;
        a.AssignmentStart = dto.AssignmentStart; a.AssignmentEnd = dto.AssignmentEnd;
        a.IsDriver = dto.IsDriver; a.SleepoverType = dto.SleepoverType;
        a.ShiftNotes = dto.ShiftNotes; a.Status = dto.Status; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _db.Entry(a).Reference(x => x.TripInstance).LoadAsync(ct);
        await _db.Entry(a).Reference(x => x.User).LoadAsync(ct);
        return Ok(ApiResponse<StaffAssignmentDto>.Ok(new StaffAssignmentDto
        {
            Id = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance?.TripName,
            StaffId = a.UserId, StaffName = a.User != null ? a.User.FirstName + " " + a.User.LastName : null,
            AssignmentRole = a.AssignmentRole, AssignmentStart = a.AssignmentStart, AssignmentEnd = a.AssignmentEnd,
            Status = a.Status, IsDriver = a.IsDriver, SleepoverType = a.SleepoverType,
            ShiftNotes = a.ShiftNotes, HasConflict = a.HasConflict
        }));
    }

// After:
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Update(Guid id, [FromBody] UpdateStaffAssignmentDto dto, CancellationToken ct)
    {
        var a = await _db.StaffAssignments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<StaffAssignmentDto>.Fail("Assignment not found"));

        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAssignmentDto>.Fail("Staff member not found."));

        var findings = await CheckAsync(dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, a.Id, ct);
        var rejection = RosterGate.EvaluateFindings(findings, dto.OverrideReason, "trip assignment");
        if (rejection != null) return UnprocessableEntity(rejection);

        a.UserId = dto.StaffId; a.AssignmentRole = dto.AssignmentRole;
        a.AssignmentStart = dto.AssignmentStart; a.AssignmentEnd = dto.AssignmentEnd;
        a.IsDriver = dto.IsDriver; a.SleepoverType = dto.SleepoverType;
        a.ShiftNotes = dto.ShiftNotes; a.Status = dto.Status; a.UpdatedAt = DateTime.UtcNow;

        var (overrideReason, codes) = RosterGate.ComputeOverride(findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
        a.OverrideReason = overrideReason;
        a.AcknowledgedFindingCodes = codes;
        a.HasConflict = overrideReason != null;

        await _db.SaveChangesAsync(ct);
        await _db.Entry(a).Reference(x => x.TripInstance).LoadAsync(ct);
        await _db.Entry(a).Reference(x => x.User).LoadAsync(ct);
        return Ok(ApiResponse<StaffAssignmentDto>.Ok(new StaffAssignmentDto
        {
            Id = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance?.TripName,
            StaffId = a.UserId, StaffName = a.User != null ? a.User.FirstName + " " + a.User.LastName : null,
            AssignmentRole = a.AssignmentRole, AssignmentStart = a.AssignmentStart, AssignmentEnd = a.AssignmentEnd,
            Status = a.Status, IsDriver = a.IsDriver, SleepoverType = a.SleepoverType,
            ShiftNotes = a.ShiftNotes, HasConflict = a.HasConflict,
            OverrideReason = a.OverrideReason, AcknowledgedFindingCodes = a.AcknowledgedFindingCodes
        }));
    }
```

- [ ] **Step 7: Run to confirm the new tests pass**

Run: `dotnet test --filter "FullyQualifiedName~StaffAssignmentGateTests"`
Expected: `Passed: 6, Failed: 0`.

- [ ] **Step 8: Build, full suite**

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0` — this is also the check that Step 4's
`SameTenantWritePathTests.cs` fix actually compiles and its own suite (unaffected in behaviour by
this task) still passes.

- [ ] **Step 9: Commit**

```bash
git add Odip.Api/Controllers/VehiclesStaffController.cs Odip.Tests/Rostering/StaffAssignmentGateTests.cs Odip.Tests/SameTenantValidation/SameTenantWritePathTests.cs
git commit -m "feat(leave): trip-side conflict gate — POST /staff-assignments/check, gated create/update

Create and Update now run RosterConflictService.CheckStaffAssignment through
the shared RosterGate, matching the roster board's shift gate exactly.
HasConflict is now correctly derived on Update too (it was never
recomputed there before this change). Also fixes 3 stale 1-arg
StaffAssignmentsController call sites in SameTenantWritePathTests.cs that
would otherwise fail to compile against the new 2-arg constructor.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 5: `ScheduleController` — `Tentative`/`Unavailable` via `IStaffUnavailabilityQuery`

**Files:**
- Modify: `Odip.Api/Controllers/ScheduleController.cs:14-229`
- Test: `Odip.Tests/Schedule/ScheduleControllerTests.cs` (new file/folder)

**Interfaces:**
- Consumes: `IStaffUnavailabilityQuery` (PR 1).
- Produces: `ScheduleStaffTripStatusDto.Status` can now be `"Tentative"` in addition to the
  existing `"Assigned"`/`"Conflict"`/`"Unavailable"`/`"Available"`.

**Ruling — Training-type legacy `StaffAvailability` rows now also count as `"Unavailable"` on the
schedule page:** the original inline query only checked `Unavailable`/`Leave` (never `Training`);
`IStaffUnavailabilityQuery`'s `Legacy` kind covers `Unavailable`/`Training` (mirroring the roster
board's own `STAFF_UNAVAILABLE` rule, which always included `Training`). This is the intended
effect of routing every unavailability-aware caller through one shared source (spec §3) — a minor,
consistent behaviour improvement, not a regression.

- [ ] **Step 1: Write the failing tests**

Create `Odip.Tests/Schedule/ScheduleControllerTests.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Schedule;

/// <summary>
/// ScheduleController's trip-status cells now source unavailability from IStaffUnavailabilityQuery
/// (PR 1) instead of a raw StaffAvailability query — see
/// docs/specs/2026-09-07-staff-leave-unavailability-design.md §4.
/// </summary>
public class ScheduleControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedStaff(OdipDbContext db)
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        db.Users.Add(staff);
        db.SaveChanges();
        return staff;
    }

    private static TripInstance SeedTrip(OdipDbContext db, DateOnly start, int days = 3)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Trip", StartDate = start, DurationDays = days, Status = TripStatus.Published };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static ScheduleStaffTripStatusDto StatusFor(ApiResponse<ScheduleOverviewDto> body, Guid staffId, Guid tripId) =>
        body.Data!.Staff.Single(s => s.Id == staffId).TripStatuses.Single(t => t.TripId == tripId);

    [Fact]
    public async Task PendingLeaveOverlappingTrip_StatusIsTentative()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 12),
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Tentative", StatusFor(body, staff.Id, trip.Id).Status);
    }

    [Fact]
    public async Task ApprovedLeaveOverlappingTrip_StatusIsUnavailable()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 12),
            Status = LeaveStatus.Approved, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Unavailable", StatusFor(body, staff.Id, trip.Id).Status);
    }

    [Fact]
    public async Task NoOverlap_StatusIsAvailable()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Available", StatusFor(body, staff.Id, trip.Id).Status);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~ScheduleControllerTests"`
Expected: build error — `ScheduleController`'s constructor still takes only `OdipDbContext`.

- [ ] **Step 3: Implement**

Add `using Odip.Domain.Rostering.Services;` and `using Odip.Infrastructure.Rostering;` to the top
of `ScheduleController.cs`.

```csharp
// Before (ScheduleController.cs:14-17):
public class ScheduleController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ScheduleController(OdipDbContext db) => _db = db;

// After:
public class ScheduleController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IStaffUnavailabilityQuery _unavailabilityQuery;

    public ScheduleController(OdipDbContext db, IStaffUnavailabilityQuery unavailabilityQuery)
    {
        _db = db;
        _unavailabilityQuery = unavailabilityQuery;
    }
```

```csharp
// Before (ScheduleController.cs:139-146, immediately before the staffDtos projection):
        // Load availability within the overall trip window
        var overallStart = trips.Min(t => t.StartDate).ToDateTime(TimeOnly.MinValue);
        var overallEnd = trips.Max(t => t.StartDate.AddDays(t.DurationDays - 1)).ToDateTime(TimeOnly.MaxValue);

        var staffAvailability = await _db.StaffAvailabilities
            .Where(a => staffIds.Contains(a.UserId)
                && a.StartDateTime < overallEnd && a.EndDateTime > overallStart)
            .ToListAsync(ct);

// After:
        // Load availability within the overall trip window
        var overallStart = trips.Min(t => t.StartDate).ToDateTime(TimeOnly.MinValue);
        var overallEnd = trips.Max(t => t.StartDate.AddDays(t.DurationDays - 1)).ToDateTime(TimeOnly.MaxValue);

        var staffAvailability = await _db.StaffAvailabilities
            .Where(a => staffIds.Contains(a.UserId)
                && a.StartDateTime < overallEnd && a.EndDateTime > overallStart)
            .ToListAsync(ct);

        // Unavailability windows (approved leave, approved recurring rules, legacy StaffAvailability
        // Unavailable/Training rows) via the shared IStaffUnavailabilityQuery — see
        // docs/specs/2026-09-07-staff-leave-unavailability-design.md §3/§4. staffAvailability above
        // stays as-is: it still feeds ScheduleStaffDto.Availability, which this change doesn't touch.
        var overallStartDate = trips.Min(t => t.StartDate);
        var overallEndDate = trips.Max(t => t.StartDate.AddDays(t.DurationDays - 1));
        var unavailabilityWindows = await _unavailabilityQuery.GetWindowsAsync(staffIds, overallStartDate, overallEndDate, ct);
```

```csharp
// Before (ScheduleController.cs:150-151, top of the staffDtos.Select lambda):
            var myAssignments = staffAssignments.Where(a => a.UserId == s.Id).ToList();
            var myAvailability = staffAvailability.Where(a => a.UserId == s.Id).ToList();

// After:
            var myAssignments = staffAssignments.Where(a => a.UserId == s.Id).ToList();
            var myAvailability = staffAvailability.Where(a => a.UserId == s.Id).ToList();
            var myWindows = unavailabilityWindows.Where(w => w.UserId == s.Id).ToList();
```

```csharp
// Before (ScheduleController.cs:184-201, inside the tripStatuses.Select lambda):
                // Check availability records for unavailability/leave
                var tripStartDt = tripStart.ToDateTime(TimeOnly.MinValue);
                var tripEndDt = tripEnd.ToDateTime(TimeOnly.MaxValue);
                var unavailable = myAvailability.Any(a =>
                    (a.AvailabilityType == AvailabilityType.Unavailable || a.AvailabilityType == AvailabilityType.Leave)
                    && a.StartDateTime < tripEndDt && a.EndDateTime > tripStartDt);
                if (unavailable)
                {
                    return new ScheduleStaffTripStatusDto
                    {
                        TripId = t.Id, Status = "Unavailable"
                    };
                }

                return new ScheduleStaffTripStatusDto
                {
                    TripId = t.Id, Status = "Available"
                };

// After:
                // Unavailability windows (approved leave, approved recurring rules, legacy
                // StaffAvailability Unavailable/Training rows) via the shared
                // IStaffUnavailabilityQuery — see docs/specs/2026-09-07-staff-leave-unavailability-design.md §4.
                var tripStartDt = tripStart.ToDateTime(TimeOnly.MinValue);
                var tripEndDt = tripEnd.ToDateTime(TimeOnly.MaxValue);
                var unavailable = myWindows.Any(w =>
                    (w.Kind == UnavailabilityKind.ApprovedLeave || w.Kind == UnavailabilityKind.RecurringRule || w.Kind == UnavailabilityKind.Legacy)
                    && w.Start < tripEndDt && tripStartDt < w.End);
                if (unavailable)
                {
                    return new ScheduleStaffTripStatusDto
                    {
                        TripId = t.Id, Status = "Unavailable"
                    };
                }

                // Pending leave is a softer signal than an approved one — the coordinator can still
                // assign, but the cell shows Tentative rather than Available so the risk is visible
                // up front. Pending RecurringUnavailability rules never produce a window at all
                // (StaffUnavailabilityQuery only expands Approved rules), so there's no
                // Tentative-via-pending-recurring case to handle here.
                var pendingLeave = myWindows.Any(w =>
                    w.Kind == UnavailabilityKind.PendingLeave && w.Start < tripEndDt && tripStartDt < w.End);
                if (pendingLeave)
                {
                    return new ScheduleStaffTripStatusDto
                    {
                        TripId = t.Id, Status = "Tentative"
                    };
                }

                return new ScheduleStaffTripStatusDto
                {
                    TripId = t.Id, Status = "Available"
                };
```

- [ ] **Step 4: Run to confirm pass**

Run: `dotnet test --filter "FullyQualifiedName~ScheduleControllerTests"`
Expected: `Passed: 3, Failed: 0`.

- [ ] **Step 5: Build, full suite, commit**

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0`.

```bash
git add Odip.Api/Controllers/ScheduleController.cs Odip.Tests/Schedule/ScheduleControllerTests.cs
git commit -m "feat(leave): ScheduleController Tentative cell for pending leave, via IStaffUnavailabilityQuery

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 6: Frontend API layer — `staff.ts` types + `useCheckStaffAssignment`

**Files:**
- Modify: `frontend/src/api/types/staff.ts:85-114`
- Modify: `frontend/src/api/hooks/staff.ts:1-14`

**Interfaces:**
- Consumes: `RosterFindingDto` — already carries `requiresReason` as of PR 2's Task 1
  (`src/api/types/rostering.ts`); this task does **not** touch that file.
- Produces: `StaffAssignmentDto.overrideReason`/`acknowledgedFindingCodes`;
  `CreateStaffAssignmentDto.overrideReason`/`acknowledgedFindingCodes`; `CheckStaffAssignmentDto`;
  `useCheckStaffAssignment()`.

- [ ] **Step 1: Extend the wire types**

```ts
// Before (staff.ts:85-99):
export interface StaffAssignmentDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  staffId: string
  staffName: string | null
  assignmentRole: string | null
  assignmentStart: string
  assignmentEnd: string
  status: AssignmentStatus
  isDriver: boolean
  sleepoverType: SleepoverType
  shiftNotes: string | null
  hasConflict: boolean
}

// After:
export interface StaffAssignmentDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  staffId: string
  staffName: string | null
  assignmentRole: string | null
  assignmentStart: string
  assignmentEnd: string
  status: AssignmentStatus
  isDriver: boolean
  sleepoverType: SleepoverType
  shiftNotes: string | null
  hasConflict: boolean
  overrideReason: string | null
  acknowledgedFindingCodes: string | null
}
```

```ts
// Before (staff.ts:101-114):
export interface CreateStaffAssignmentDto {
  tripInstanceId: string
  staffId: string
  assignmentRole?: string
  assignmentStart: string
  assignmentEnd: string
  isDriver: boolean
  sleepoverType?: SleepoverType
  shiftNotes?: string
}

export interface UpdateStaffAssignmentDto extends CreateStaffAssignmentDto {
  status: AssignmentStatus
}

// After:
export interface CreateStaffAssignmentDto {
  tripInstanceId: string
  staffId: string
  assignmentRole?: string
  assignmentStart: string
  assignmentEnd: string
  isDriver: boolean
  sleepoverType?: SleepoverType
  shiftNotes?: string
  overrideReason?: string
  acknowledgedFindingCodes?: string[]
}

export interface UpdateStaffAssignmentDto extends CreateStaffAssignmentDto {
  status: AssignmentStatus
}

/** Dry-run input for POST /staff-assignments/check — mirrors CreateStaffAssignmentDto's shape. */
export interface CheckStaffAssignmentDto {
  staffId: string
  tripInstanceId: string
  assignmentStart: string
  assignmentEnd: string
  excludeAssignmentId?: string
}
```

- [ ] **Step 2: Add `useCheckStaffAssignment`**

```ts
// Before (hooks/staff.ts:1-14):
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  StaffListDto,
  StaffDetailDto,
  CreateStaffDto,
  UpdateStaffDto,
  StaffAssignmentDto,
  CreateStaffAssignmentDto,
  UpdateStaffAssignmentDto,
  StaffAvailabilityDto,
  CreateStaffAvailabilityDto,
  UpdateStaffAvailabilityDto,
} from '../types'

// After:
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  StaffListDto,
  StaffDetailDto,
  CreateStaffDto,
  UpdateStaffDto,
  StaffAssignmentDto,
  CreateStaffAssignmentDto,
  UpdateStaffAssignmentDto,
  CheckStaffAssignmentDto,
  StaffAvailabilityDto,
  CreateStaffAvailabilityDto,
  UpdateStaffAvailabilityDto,
  RosterFindingDto,
} from '../types'
```

Add, next to `useCreateStaffAssignment`/`useUpdateStaffAssignment` (after `useTripStaff`, before
`useCreateStaffAssignment`):

```ts
/**
 * Dry-run findings for a candidate trip assignment — a POST that writes nothing. Mirrors
 * useCheckShift (rostering.ts). Used by StaffAssignModal to preview findings for the fixed
 * staff/trip pairing the modal opened with.
 */
export function useCheckStaffAssignment() {
  return useMutation({
    mutationFn: (data: CheckStaffAssignmentDto) => apiPost<RosterFindingDto[]>('/staff-assignments/check', data),
  })
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/api/types/staff.ts src/api/hooks/staff.ts
git commit -m "feat(leave): StaffAssignmentDto override fields, useCheckStaffAssignment hook

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 7: `StaffAssignModal.tsx` — live check, findings, override-reason gate

**Files:**
- Modify: `frontend/src/pages/schedule/StaffAssignModal.tsx` (full-file rewrite — every existing
  field is kept, this task only adds the check/findings/reason machinery around them)
- Modify: `frontend/src/pages/SchedulePage.tsx:53-60` (`handleStaffAssign`)
- Test: `frontend/src/pages/schedule/StaffAssignModal.test.tsx` (new)

**Interfaces:**
- Consumes: `useCheckStaffAssignment` (Task 6), `getRosterFindings` (existing,
  `frontend/src/api/hooks/rostering.ts`), `FindingsList` (existing,
  `frontend/src/pages/rostering/components/FindingsList.tsx` — already a standalone component,
  not inline in `ShiftSlideOver.tsx`, so no extraction is needed here).
- Produces: `StaffAssignModalProps.onAssign` changes from `(data) => void` to `(data) =>
  Promise<void>` so the modal can catch a 422 and re-render the returned findings.

**Ruling — no debounce, unlike `ShiftSlideOver.tsx`:** `ShiftSlideOver` debounces because its
participant/staff/date/time fields are actively edited by the coordinator. `StaffAssignModal`'s
`staff`/`trip` props are fixed for the modal's entire lifetime (set once, when `SchedulePage` opens
it) — nothing in the check's input ever changes while the modal is open, so a single un-debounced
check on mount is enough. It still never writes.

**Note — `StaffTab.tsx`'s own inline edit modal:** this task builds the findings/override-reason
JSX (below) as a block private to `StaffAssignModal.tsx`. Task 9 extracts it into a shared
`frontend/src/pages/rostering/components/RosterGateFields.tsx` component and rewires this file to
consume it (behaviour-preserving), then wires the same component into `StaffTab`'s edit modal —
the edit modal has editable Assignment Start/End dates and can trip the same gate Task 4 wires into
`Update`, so it needs the same live-check/findings/override-reason treatment `StaffAssignModal`
gets here, not just a generic error message. See Task 9's ruling for the full reasoning (this
supersedes an earlier draft of this plan that scoped the edit modal out).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/schedule/StaffAssignModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StaffAssignModal from './StaffAssignModal'
import type { ScheduleStaffDto, ScheduleTripDto } from '@/api/types'

const { mockCheckMutate, mockGetRosterFindings } = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockGetRosterFindings: vi.fn(),
}))

// Only the API layer is mocked — FindingsList is the real component, so this exercises the
// actual findings rendering + override-gate wiring (same choice ShiftSlideOver.test.tsx makes).
vi.mock('@/api/hooks', () => ({
  useCheckStaffAssignment: () => ({ mutate: mockCheckMutate }),
  getRosterFindings: mockGetRosterFindings,
}))

const staff = { id: 'staff-1', fullName: 'Alex Rivera', isDriverEligible: true } as ScheduleStaffDto
const trip = { id: 'trip-1', tripName: 'Gold Coast Beach Break', startDate: '2026-09-10', endDate: '2026-09-12', durationDays: 3 } as ScheduleTripDto

beforeEach(() => {
  mockCheckMutate.mockReset()
  mockGetRosterFindings.mockReset()
})

describe('StaffAssignModal — live conflict check (trip-side parity)', () => {
  it('renders findings returned by the live dry-run check on open', async () => {
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: "Alex Rivera's approved leave covers this window — cannot roster without a reason.", requiresReason: true }])
    })
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={vi.fn()} isLoading={false} />)

    expect(await screen.findByText(/approved leave covers this window/)).toBeInTheDocument()
  })

  it('requires a non-empty override reason before submitting when a finding requires one', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await screen.findByText('Leave overlap')
    await user.click(screen.getByRole('button', { name: /assign with override/i }))

    expect(onAssign).not.toHaveBeenCalled()
    expect(screen.getByText(/required/i)).toBeInTheDocument()
  })

  it('submits with overrideReason and acknowledgedFindingCodes once a reason is entered', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await screen.findByText('Leave overlap')
    await user.type(screen.getByPlaceholderText(/why this assignment should proceed/i), 'Covering a shortfall.')
    await user.click(screen.getByRole('button', { name: /assign with override/i }))

    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({
      overrideReason: 'Covering a shortfall.',
      acknowledgedFindingCodes: ['STAFF_ON_LEAVE'],
    }))
  })

  it('surfaces a blocking finding and disables submit', async () => {
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'WSC_EXPIRED', severity: 'Blocking', message: 'Worker screening expired.', requiresReason: false }])
    })
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={vi.fn()} isLoading={false} />)

    await screen.findByText('Worker screening expired.')
    expect(screen.getByRole('button', { name: /assign staff/i })).toBeDisabled()
  })

  it('surfaces server-rejected findings from a 422 on submit', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const serverFindings = [{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap (server)', requiresReason: true }]
    mockGetRosterFindings.mockReturnValue(serverFindings)
    const onAssign = vi.fn().mockRejectedValue(new Error('422'))
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await user.click(screen.getByRole('button', { name: /assign staff/i }))

    expect(await screen.findByText('Leave overlap (server)')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/schedule/StaffAssignModal.test.tsx`
Expected: FAIL — `StaffAssignModal` doesn't call `useCheckStaffAssignment` yet, no findings render,
`onAssign` isn't awaited/caught.

- [ ] **Step 3: Rewrite `StaffAssignModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { formatDate } from './helpers'
import { useCheckStaffAssignment, getRosterFindings } from '@/api/hooks'
import { FindingsList } from '@/pages/rostering/components/FindingsList'
import type { ScheduleStaffDto, ScheduleTripDto, CreateStaffAssignmentDto, RosterFindingDto, SleepoverType } from '@/api/types'

interface StaffAssignModalProps {
  staff: ScheduleStaffDto
  trip: ScheduleTripDto
  onClose: () => void
  onAssign: (data: CreateStaffAssignmentDto) => Promise<void>
  isLoading: boolean
}

export default function StaffAssignModal({ staff, trip, onClose, onAssign, isLoading }: StaffAssignModalProps) {
  const [role, setRole] = useState('Support Worker')
  const [isDriver, setIsDriver] = useState(false)
  const [sleepoverType, setSleepoverType] = useState<SleepoverType>('None')
  const [shiftNotes, setShiftNotes] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [findings, setFindings] = useState<RosterFindingDto[]>([])
  const [reasonRequired, setReasonRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkAssignment = useCheckStaffAssignment()

  // Live dry-run: staff and trip are fixed props for this modal's whole lifetime (no editable
  // staff/date fields here, unlike ShiftSlideOver) — one un-debounced check on mount is enough.
  // Never writes — POST /staff-assignments/check is a pure preview.
  useEffect(() => {
    checkAssignment.mutate(
      { staffId: staff.id, tripInstanceId: trip.id, assignmentStart: trip.startDate, assignmentEnd: trip.endDate },
      { onSuccess: setFindings },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff.id, trip.id, trip.startDate, trip.endDate])

  const blockingFindings = findings.filter(f => f.severity === 'Blocking')
  const requiresReasonFindings = findings.filter(f => f.requiresReason)
  const isBusy = isLoading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (blockingFindings.length > 0) return
    if (requiresReasonFindings.length > 0 && !overrideReason.trim()) {
      setReasonRequired(true)
      return
    }
    setReasonRequired(false)

    try {
      await onAssign({
        tripInstanceId: trip.id,
        staffId: staff.id,
        assignmentRole: role,
        assignmentStart: trip.startDate,
        assignmentEnd: trip.endDate,
        isDriver,
        sleepoverType,
        shiftNotes: shiftNotes || undefined,
        overrideReason: overrideReason.trim() || undefined,
        acknowledgedFindingCodes: findings.map(f => f.code),
      })
    } catch (err: unknown) {
      const serverFindings = getRosterFindings(err)
      if (serverFindings) {
        setFindings(serverFindings)
        if (serverFindings.some(f => f.requiresReason) && !overrideReason.trim()) setReasonRequired(true)
      } else {
        setError('Something went wrong assigning this staff member. Please try again.')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid rgba(195,201,181,0.25)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[var(--color-primary-fixed)]/30 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-[var(--color-primary)]" />
            </div>
            <h3 className="font-display font-bold text-base">Assign Staff</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-[var(--color-surface-container)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-[var(--color-surface-container-low)] rounded-[1rem] p-4 space-y-1">
            <div className="text-sm font-bold">{staff.fullName}</div>
            <div className="text-xs text-[var(--color-muted-foreground)]">→ {trip.tripName}</div>
            <div className="text-xs text-[var(--color-muted-foreground)]">
              {formatDate(trip.startDate)} — {formatDate(trip.endDate)} ({trip.durationDays} days)
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Assignment Role</label>
            <Dropdown
              variant="form"
              value={role}
              onChange={setRole}
              items={[
                { value: 'Support Worker', label: 'Support Worker' },
                { value: 'Senior Support Worker', label: 'Senior Support Worker' },
                { value: 'Lead Coordinator', label: 'Lead Coordinator' },
                { value: 'Team Leader', label: 'Team Leader' },
                { value: 'Senior Support / Driver', label: 'Senior Support / Driver' },
                { value: 'Driver', label: 'Driver' },
              ]}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Sleepover Type</label>
            <Dropdown
              variant="form"
              value={sleepoverType}
              onChange={(val: string) => setSleepoverType(val as SleepoverType)}
              items={[
                { value: 'None', label: 'None' },
                { value: 'ActiveNight', label: 'Active Night' },
                { value: 'PassiveNight', label: 'Passive Night' },
                { value: 'Sleepover', label: 'Sleepover' },
              ]}
            />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDriver}
              onChange={e => setIsDriver(e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--color-primary)]"
            />
            <span className="text-sm font-medium">Assigned as driver</span>
            {staff.isDriverEligible
              ? <span className="text-[10px] text-[var(--color-primary)] font-semibold">(eligible)</span>
              : <span className="text-[10px] text-[#ba1a1a] font-semibold">(not eligible)</span>
            }
          </label>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Shift Notes (optional)</label>
            <textarea
              value={shiftNotes}
              onChange={e => setShiftNotes(e.target.value)}
              rows={2}
              placeholder="E.g. arrive evening before, depart early last day..."
              className="w-full px-4 py-2.5 rounded-[1rem] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] resize-none"
            />
          </div>

          {findings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Findings</p>
              <FindingsList findings={findings} />
            </div>
          )}

          {requiresReasonFindings.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">
                Reason for override{reasonRequired && <span className="text-[#ba1a1a]"> — required</span>}
              </label>
              <textarea
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                rows={2}
                placeholder="Why this assignment should proceed despite the warnings above"
                className="w-full px-4 py-2.5 rounded-[1rem] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] resize-none"
              />
            </div>
          )}

          {blockingFindings.length > 0 && (
            <p role="alert" className="text-sm font-medium text-[#ba1a1a]">
              This assignment can't be saved while a blocking finding is open.
            </p>
          )}

          {error && (
            <div role="alert" className="rounded-[1rem] bg-[#ffdad6]/50 px-3 py-2 text-sm text-[#ba1a1a]">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-full bg-[var(--color-surface-container)] text-sm font-semibold hover:bg-[var(--color-surface-container-high)] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isBusy || blockingFindings.length > 0}
              className="flex-1 px-4 py-2.5 rounded-full bg-gradient-to-r from-[#396200] to-[#4d7c0f] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
              {isBusy ? 'Assigning...' : requiresReasonFindings.length > 0 ? 'Assign with override' : 'Assign Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `SchedulePage.tsx` — `handleStaffAssign` becomes async/throwing**

```tsx
// Before (SchedulePage.tsx:53-60):
  const handleStaffAssign = (assignData: CreateStaffAssignmentDto) => {
    staffAssign.mutate(assignData, {
      onSuccess: () => {
        setAssignModal(null)
        queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
      },
    })
  }

// After:
  const handleStaffAssign = async (assignData: CreateStaffAssignmentDto) => {
    await staffAssign.mutateAsync(assignData)
    setAssignModal(null)
    queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
  }
```

`useCreateStaffAssignment()` (from `@tanstack/react-query`'s `useMutation`) already exposes
`mutateAsync` with no hook changes needed. On a 422, `mutateAsync` rejects; `StaffAssignModal`'s own
`handleSubmit` catches that rejection (Step 3 above) and never lets it propagate further, so
`handleStaffAssign`'s `await` never needs its own `try`/`catch`.

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run src/pages/schedule/StaffAssignModal.test.tsx`
Expected: `5 passed`.

- [ ] **Step 6: Build, lint, full suite**

Run: `npm run build`
Expected: 0 TypeScript errors.

Run: `npx eslint src/pages/schedule/StaffAssignModal.tsx src/pages/SchedulePage.tsx src/pages/schedule/StaffAssignModal.test.tsx`
Expected: no NEW errors vs main.

Run: `npm test -- --run`
Expected: same or higher pass count than before this task; no new failures.

- [ ] **Step 7: Commit**

```bash
git add src/pages/schedule/StaffAssignModal.tsx src/pages/schedule/StaffAssignModal.test.tsx src/pages/SchedulePage.tsx
git commit -m "feat(leave): StaffAssignModal live conflict check + override-reason gate

Mirrors ShiftSlideOver's findings/override flow for trip assignments.
No debounce needed — staff/trip are fixed props for the modal's lifetime.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 8: `StatusBadge.tsx` — `Tentative` style + `SchedulePage.test.tsx`

**Files:**
- Modify: `frontend/src/pages/schedule/StatusBadge.tsx:5-11`
- Test: `frontend/src/pages/SchedulePage.test.tsx` (new)

**Interfaces:**
- Consumes: `ScheduleStaffTripStatusDto.status` can now be `"Tentative"` (Task 5, backend).
- Produces: `statusStyles.Tentative`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/SchedulePage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SchedulePage from './SchedulePage'
import type { ScheduleOverviewDto } from '@/api/types'

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

const overview: ScheduleOverviewDto = {
  trips: [{
    id: 'trip-1', tripName: 'Gold Coast Beach Break', tripCode: null, destination: null, region: null,
    startDate: '2026-09-10', endDate: '2026-09-12', durationDays: 3, status: 'Published',
    maxParticipants: null, currentParticipantCount: 0, minStaffRequired: null, staffRequired: 1,
    staffAssignedCount: 0, vehicleAssignedCount: 0, leadCoordinatorName: null, preferenceMatchCount: 0,
  }],
  staff: [{
    id: 'staff-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', role: 'SupportWorker',
    region: null, isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: true,
    isManualHandlingCompetent: true, isOvernightEligible: true,
    tripStatuses: [{ tripId: 'trip-1', status: 'Tentative', assignmentRole: null, assignmentStatus: null, assignmentId: null }],
    availability: [], preferredForTrips: [],
  }],
  vehicles: [],
}

vi.mock('@/api/hooks', () => ({
  useScheduleOverview: () => ({ data: overview, isLoading: false, error: null }),
  useCreateStaffAssignment: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCreateVehicleAssignment: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteStaffAssignment: () => ({ mutate: vi.fn(), isPending: false }),
}))

function renderPage() {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}><SchedulePage /></QueryClientProvider>)
}

describe('SchedulePage — Tentative badge for pending leave', () => {
  it('renders a Tentative badge for a staff/trip cell with pending leave', () => {
    renderPage()
    expect(screen.getByText('Tentative')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/SchedulePage.test.tsx`
Expected: FAIL — `StatusBadge`'s `statusStyles` has no `Tentative` entry, so it falls back to
`statusStyles.Available` and the label reads "Available", not "Tentative".

- [ ] **Step 3: Add the `Tentative` style**

```ts
// Before (StatusBadge.tsx:5-11):
export const statusStyles: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  Available:   { bg: 'bg-[var(--color-surface-container)]', dot: 'bg-[#c3c9b5]', text: 'text-[var(--color-muted-foreground)]', label: 'Available' },
  Unavailable: { bg: 'bg-[#ffdad6]/50', dot: 'bg-[#ba1a1a]', text: 'text-[#ba1a1a]', label: 'Unavailable' },
  Assigned:    { bg: 'bg-[var(--color-primary-fixed)]/25', dot: 'bg-[var(--color-primary)]', text: 'text-[var(--color-primary)]', label: 'Assigned' },
  Conflict:    { bg: 'bg-[#ffdad6]/50', dot: 'bg-[#ba1a1a]', text: 'text-[#ba1a1a]', label: 'Conflict' },
  Maintenance: { bg: 'bg-[var(--color-secondary-container)]/40', dot: 'bg-[var(--color-secondary)]', text: 'text-[var(--color-secondary)]', label: 'Maintenance' },
}

// After:
export const statusStyles: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  Available:   { bg: 'bg-[var(--color-surface-container)]', dot: 'bg-[#c3c9b5]', text: 'text-[var(--color-muted-foreground)]', label: 'Available' },
  Unavailable: { bg: 'bg-[#ffdad6]/50', dot: 'bg-[#ba1a1a]', text: 'text-[#ba1a1a]', label: 'Unavailable' },
  Tentative:   { bg: 'bg-[var(--color-warning-container)]/50', dot: 'bg-[var(--color-warning)]', text: 'text-[var(--color-warning)]', label: 'Tentative' },
  Assigned:    { bg: 'bg-[var(--color-primary-fixed)]/25', dot: 'bg-[var(--color-primary)]', text: 'text-[var(--color-primary)]', label: 'Assigned' },
  Conflict:    { bg: 'bg-[#ffdad6]/50', dot: 'bg-[#ba1a1a]', text: 'text-[#ba1a1a]', label: 'Conflict' },
  Maintenance: { bg: 'bg-[var(--color-secondary-container)]/40', dot: 'bg-[var(--color-secondary)]', text: 'text-[var(--color-secondary)]', label: 'Maintenance' },
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/pages/SchedulePage.test.tsx`
Expected: `1 passed`.

- [ ] **Step 5: Build, lint, full suite, commit**

Run: `npm run build && npm test -- --run`
Expected: 0 TypeScript errors; no new failures.

Run: `npx eslint src/pages/schedule/StatusBadge.tsx src/pages/SchedulePage.test.tsx`
Expected: no NEW errors vs main.

```bash
git add src/pages/schedule/StatusBadge.tsx src/pages/SchedulePage.test.tsx
git commit -m "feat(leave): Tentative schedule-cell style for pending leave

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 9: `StaffTab.tsx` — acknowledged-conflict marker + edit-modal live conflict gate

**Files:**
- Modify: `frontend/src/pages/trip-detail/StaffTab.tsx:1-18,50-56,103-134,212-219,298-320`
- Create: `frontend/src/pages/rostering/components/RosterGateFields.tsx`
- Modify: `frontend/src/pages/schedule/StaffAssignModal.tsx` (extract the findings/reason-field/
  blocking-message JSX Task 7 built inline into the new `RosterGateFields`, behaviour-preserving)
- Modify: `frontend/src/pages/trip-detail/StaffTab.test.tsx` (extend)

**Interfaces:**
- Consumes: `StaffAssignmentDto.overrideReason`/`acknowledgedFindingCodes` (Task 6),
  `useCheckStaffAssignment` (Task 6), `getRosterFindings` (existing,
  `frontend/src/api/hooks/rostering.ts`), `FindingsList` (existing,
  `frontend/src/pages/rostering/components/FindingsList.tsx`).
- Produces: `RosterGateFields({ findings: RosterFindingDto[]; overrideReason: string;
  onOverrideReasonChange: (value: string) => void; reasonRequired: boolean })` — a new shared
  component with exactly two consumers, `StaffAssignModal.tsx` and `StaffTab.tsx`.

**Ruling — supersedes this plan's earlier "ruling 9" (Task 7's original scoping note, which said
this edit modal would not get a live-check flow):** reading the real
`frontend/src/pages/trip-detail/StaffTab.tsx:232-325` (the `editingStaff`/`editStaffForm` modal)
confirms it has editable "Assignment Start" and "Assignment End" date inputs (real lines 264-275)
submitted via `handleUpdateStaffAssignment` → `useUpdateStaffAssignment` → `PUT
/staff-assignments/{id}`. Once Task 4 wires the gate into `Update`, moving an assignment's dates
into an approved-leave/recurring-unavailable window (or tripping any other `RequiresReason`
finding) 422s — and before this task, the only surfaced feedback was the existing generic message
at real line 307-309 ("Failed to update assignment. Please try again."), with no findings list and
no reason field. That is an incomplete implementation of spec §3's override-reason parity for this
entry point, not an acceptable gap, so this task gives the edit modal the identical live-check/
`FindingsList`/override-reason-gate treatment `StaffAssignModal` gets in Task 7 — reusing, not
duplicating, everything that treatment needs. `useCheckStaffAssignment`, `getRosterFindings`, and
`FindingsList` are already importable from anywhere (no extraction needed for those three); the one
piece that was private to `StaffAssignModal.tsx` — its findings+reason-field+blocking-message JSX —
is extracted here into `RosterGateFields` so both modals render byte-identical markup from one
source, the same behaviour-preserving pull-out this plan's own Task 2 already used for `RosterGate`.

- [ ] **Step 1: Extend `StaffTab.test.tsx`'s mocks for both this task's test groups**

The real `StaffTab.test.tsx:1-36` only mocks create/delete/staff-picker hooks and doesn't import
`StaffAssignmentDto` (needed below by both the marker tests and the new gate tests) or mock
`useCheckStaffAssignment`/`getRosterFindings` — needed because `StaffTab.tsx` will call
`useCheckStaffAssignment` unconditionally on every render once Step 8 lands, so every test in this
file (the pre-existing Add-Staff ones included) would otherwise crash with "useCheckStaffAssignment
is not a function".

```tsx
// Before (StaffTab.test.tsx:1-36):
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StaffTab from './StaffTab'
import type { TripDetailDto } from '@/api/types/trips'

const { mockCreateMutate, mockUseAvailableStaff } = vi.hoisted(() => ({
  mockCreateMutate: vi.fn(),
  mockUseAvailableStaff: vi.fn(),
}))

// Only the API layer is mocked — DataTable, ConfirmDialog are the real components, so this
// exercises the actual Add Staff picker wiring (UX-01: migrated from a native <select> to
// SearchableSelect).
vi.mock('@/api/hooks', () => ({
  useUpdateStaffAssignment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDeleteStaffAssignment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateStaffAssignment: () => ({ mutate: mockCreateMutate, isPending: false, isError: false }),
  useStaff: () => ({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-2', fullName: 'Jo Lee' },
  ] }),
  useAvailableStaff: mockUseAvailableStaff,
}))

const trip = { id: 'trip-1', startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-05T00:00:00Z' } as TripDetailDto

beforeEach(() => {
  mockCreateMutate.mockReset()
  // Both staff are available for the trip dates by default — the "(Unavailable)" suffix is
  // covered separately from the picker migration itself.
  mockUseAvailableStaff.mockReturnValue({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-2', fullName: 'Jo Lee' },
  ] })
})

// After:
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StaffTab from './StaffTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { StaffAssignmentDto } from '@/api/types/staff'

const { mockCreateMutate, mockUpdateMutate, mockCheckMutate, mockGetRosterFindings, mockUseAvailableStaff } = vi.hoisted(() => ({
  mockCreateMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockCheckMutate: vi.fn(),
  mockGetRosterFindings: vi.fn(),
  mockUseAvailableStaff: vi.fn(),
}))

// Only the API layer is mocked — DataTable, ConfirmDialog, FindingsList, RosterGateFields are the
// real components, so this exercises the actual Add Staff picker wiring (UX-01: migrated from a
// native <select> to SearchableSelect) and the actual edit-modal conflict-gate wiring (same choice
// StaffAssignModal.test.tsx makes for its own live-check tests).
vi.mock('@/api/hooks', () => ({
  useUpdateStaffAssignment: () => ({ mutate: mockUpdateMutate, isPending: false, isError: false }),
  useDeleteStaffAssignment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateStaffAssignment: () => ({ mutate: mockCreateMutate, isPending: false, isError: false }),
  useCheckStaffAssignment: () => ({ mutate: mockCheckMutate }),
  getRosterFindings: mockGetRosterFindings,
  useStaff: () => ({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-2', fullName: 'Jo Lee' },
  ] }),
  useAvailableStaff: mockUseAvailableStaff,
}))

const trip = { id: 'trip-1', startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-05T00:00:00Z' } as TripDetailDto

beforeEach(() => {
  mockCreateMutate.mockReset()
  mockUpdateMutate.mockReset()
  mockCheckMutate.mockReset()
  mockGetRosterFindings.mockReset()
  // Both staff are available for the trip dates by default — the "(Unavailable)" suffix is
  // covered separately from the picker migration itself.
  mockUseAvailableStaff.mockReturnValue({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-2', fullName: 'Jo Lee' },
  ] })
})
```

This is safe for the pre-existing Add-Staff tests: `StaffTab.tsx` doesn't call
`useCheckStaffAssignment` yet at this point in the task (that lands in Step 8), so the new mock
entries just sit unused until then.

- [ ] **Step 2: Write the failing marker tests**

Append to `frontend/src/pages/trip-detail/StaffTab.test.tsx`:

```tsx
describe('StaffTab — acknowledged-conflict marker (trip-side parity)', () => {
  it('shows the stored override reason on hover for a staff row with hasConflict', () => {
    const staffRow = {
      id: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
      staffId: 'staff-1', staffName: 'Alex Rivera', assignmentRole: 'Support Worker',
      assignmentStart: '2026-09-10', assignmentEnd: '2026-09-12', status: 'Confirmed',
      isDriver: false, sleepoverType: 'None', shiftNotes: null,
      hasConflict: true, overrideReason: 'Covering a last-minute shortfall.', acknowledgedFindingCodes: 'STAFF_ON_LEAVE',
    } as StaffAssignmentDto

    render(<StaffTab tripId="trip-1" trip={trip} staff={[staffRow]} bookings={[]} canWrite />)

    expect(screen.getByTitle('Overridden: Covering a last-minute shortfall.')).toBeInTheDocument()
  })

  it('falls back to a generic label when hasConflict is true but overrideReason is somehow absent', () => {
    const staffRow = {
      id: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
      staffId: 'staff-1', staffName: 'Alex Rivera', assignmentRole: 'Support Worker',
      assignmentStart: '2026-09-10', assignmentEnd: '2026-09-12', status: 'Confirmed',
      isDriver: false, sleepoverType: 'None', shiftNotes: null,
      hasConflict: true, overrideReason: null, acknowledgedFindingCodes: null,
    } as StaffAssignmentDto

    render(<StaffTab tripId="trip-1" trip={trip} staff={[staffRow]} bookings={[]} canWrite />)

    expect(screen.getByTitle('Conflict acknowledged')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Write the failing edit-modal gate tests**

Append to `frontend/src/pages/trip-detail/StaffTab.test.tsx`, right after the marker `describe`
block above:

```tsx
describe('StaffTab — edit modal live conflict gate (trip-side parity)', () => {
  const editableStaffRow = {
    id: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
    staffId: 'staff-1', staffName: 'Alex Rivera', assignmentRole: 'Support Worker',
    assignmentStart: '2026-09-10', assignmentEnd: '2026-09-12', status: 'Confirmed',
    isDriver: false, sleepoverType: 'None', shiftNotes: null,
    hasConflict: false, overrideReason: null, acknowledgedFindingCodes: null,
  } as StaffAssignmentDto

  it('renders findings from the live dry-run check when the edit modal opens', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: "Alex Rivera's approved leave covers this window — cannot roster without a reason.", requiresReason: true }])
    })
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))

    expect(await screen.findByText(/approved leave covers this window/)).toBeInTheDocument()
  })

  it('requires a non-empty override reason before submitting when a finding requires one', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    await screen.findByText('Leave overlap')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/required/i)).toBeInTheDocument()
  })

  it('submits with overrideReason and acknowledgedFindingCodes once a reason is entered', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    await screen.findByText('Leave overlap')
    await user.type(screen.getByPlaceholderText(/why this assignment should proceed/i), 'Covering a shortfall.')
    await user.click(screen.getByRole('button', { name: /save with override/i }))

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assign-1',
        data: expect.objectContaining({
          overrideReason: 'Covering a shortfall.',
          acknowledgedFindingCodes: ['STAFF_ON_LEAVE'],
        }),
      }),
      expect.anything(),
    )
  })

  it('surfaces server-rejected findings from a 422 on submit', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const serverFindings = [{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap (server)', requiresReason: true }]
    mockGetRosterFindings.mockReturnValue(serverFindings)
    mockUpdateMutate.mockImplementation((_vars, { onError }) => onError(new Error('422')))
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('Leave overlap (server)')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run to confirm failure**

Run: `npx vitest run src/pages/trip-detail/StaffTab.test.tsx`
Expected: FAIL — the marker tests fail because the existing `AlertTriangle` has no `title`
attribute; the gate tests fail because `StaffTab.tsx` doesn't call `useCheckStaffAssignment`, never
opens a findings/reason UI, and never sends `overrideReason`/`acknowledgedFindingCodes`.

- [ ] **Step 5: Add the marker tooltip**

```tsx
// Before (StaffTab.tsx:212-219):
            render: (s: StaffAssignmentDto) => (
              <div className="flex items-center justify-center gap-2">
                {s.hasConflict && <AlertTriangle className="w-4 h-4 text-[var(--color-warning)]" />}
                {canWrite && (

// After:
            render: (s: StaffAssignmentDto) => (
              <div className="flex items-center justify-center gap-2">
                {s.hasConflict && (
                  <span title={s.overrideReason ? `Overridden: ${s.overrideReason}` : 'Conflict acknowledged'}>
                    <AlertTriangle className="w-4 h-4 text-[var(--color-warning)]" />
                  </span>
                )}
                {canWrite && (
```

- [ ] **Step 6: Create the shared `RosterGateFields` component**

This extracts the findings/reason-field/blocking-message JSX Task 7 built inline into
`StaffAssignModal.tsx` into a standalone component both modals render — the same
behaviour-preserving pull-out this plan's own Task 2 already used to extract `RosterGate` out of
`RosteringController`.

```tsx
// frontend/src/pages/rostering/components/RosterGateFields.tsx (new file)
import { FindingsList } from './FindingsList'
import type { RosterFindingDto } from '@/api/types'

export interface RosterGateFieldsProps {
  findings: RosterFindingDto[]
  overrideReason: string
  onOverrideReasonChange: (value: string) => void
  reasonRequired: boolean
}

/**
 * The findings list + conditional override-reason textarea + blocking-finding message every
 * roster-checked write form renders around its own fields. Shared by StaffAssignModal (the
 * "Assign Staff" modal, schedule page) and StaffTab's inline "Edit Assignment" modal (trip detail
 * page) so the two forms can't drift — see
 * docs/specs/2026-09-07-staff-leave-unavailability-design.md §3.
 */
export function RosterGateFields({ findings, overrideReason, onOverrideReasonChange, reasonRequired }: RosterGateFieldsProps) {
  const requiresReasonFindings = findings.filter(f => f.requiresReason)
  const blockingFindings = findings.filter(f => f.severity === 'Blocking')

  return (
    <>
      {findings.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Findings</p>
          <FindingsList findings={findings} />
        </div>
      )}

      {requiresReasonFindings.length > 0 && (
        <div>
          <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">
            Reason for override{reasonRequired && <span className="text-[#ba1a1a]"> — required</span>}
          </label>
          <textarea
            value={overrideReason}
            onChange={e => onOverrideReasonChange(e.target.value)}
            rows={2}
            placeholder="Why this assignment should proceed despite the warnings above"
            className="w-full px-4 py-2.5 rounded-[1rem] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] resize-none"
          />
        </div>
      )}

      {blockingFindings.length > 0 && (
        <p role="alert" className="text-sm font-medium text-[#ba1a1a]">
          This assignment can't be saved while a blocking finding is open.
        </p>
      )}
    </>
  )
}
```

- [ ] **Step 7: Rewire `StaffAssignModal.tsx` to consume `RosterGateFields` (behaviour-preserving)**

The rendered markup is unchanged, so `StaffAssignModal.test.tsx` (Task 7) keeps passing unmodified.

```tsx
// Before (StaffAssignModal.tsx, as written by Task 7 — imports):
import { useEffect, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { formatDate } from './helpers'
import { useCheckStaffAssignment, getRosterFindings } from '@/api/hooks'
import { FindingsList } from '@/pages/rostering/components/FindingsList'
import type { ScheduleStaffDto, ScheduleTripDto, CreateStaffAssignmentDto, RosterFindingDto, SleepoverType } from '@/api/types'

// After:
import { useEffect, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { formatDate } from './helpers'
import { useCheckStaffAssignment, getRosterFindings } from '@/api/hooks'
import { RosterGateFields } from '@/pages/rostering/components/RosterGateFields'
import type { ScheduleStaffDto, ScheduleTripDto, CreateStaffAssignmentDto, RosterFindingDto, SleepoverType } from '@/api/types'
```

```tsx
// Before (StaffAssignModal.tsx, as written by Task 7 — the findings/reason/blocking block):
          {findings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Findings</p>
              <FindingsList findings={findings} />
            </div>
          )}

          {requiresReasonFindings.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">
                Reason for override{reasonRequired && <span className="text-[#ba1a1a]"> — required</span>}
              </label>
              <textarea
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                rows={2}
                placeholder="Why this assignment should proceed despite the warnings above"
                className="w-full px-4 py-2.5 rounded-[1rem] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] resize-none"
              />
            </div>
          )}

          {blockingFindings.length > 0 && (
            <p role="alert" className="text-sm font-medium text-[#ba1a1a]">
              This assignment can't be saved while a blocking finding is open.
            </p>
          )}

// After:
          <RosterGateFields
            findings={findings}
            overrideReason={overrideReason}
            onOverrideReasonChange={setOverrideReason}
            reasonRequired={reasonRequired}
          />
```

The local `blockingFindings`/`requiresReasonFindings` consts (used by Task 7's `handleSubmit` and
the submit button's `disabled` check) are unchanged — only the JSX rendering moved.

- [ ] **Step 8: Wire the live-check/gate into `StaffTab.tsx`**

```tsx
// Before (StaffTab.tsx:1-18):
import { useState } from 'react'
import { Plus, X, AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import {
  useUpdateStaffAssignment,
  useDeleteStaffAssignment,
  useCreateStaffAssignment,
  useStaff,
  useAvailableStaff,
} from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { formatDateAu } from '@/lib/utils'
import { ASSIGNMENT_STATUSES, SLEEPOVER_TYPES, type SleepoverType, type AssignmentStatus } from '@/api/types/enums'
import type { TripDetailDto } from '@/api/types/trips'
import type { StaffAssignmentDto, StaffListDto, UpdateStaffAssignmentDto } from '@/api/types/staff'
import type { BookingListDto } from '@/api/types/bookings'

// After:
import { useEffect, useState } from 'react'
import { Plus, X, AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import {
  useUpdateStaffAssignment,
  useDeleteStaffAssignment,
  useCreateStaffAssignment,
  useCheckStaffAssignment,
  getRosterFindings,
  useStaff,
  useAvailableStaff,
} from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { RosterGateFields } from '@/pages/rostering/components/RosterGateFields'
import { formatDateAu } from '@/lib/utils'
import { ASSIGNMENT_STATUSES, SLEEPOVER_TYPES, type SleepoverType, type AssignmentStatus } from '@/api/types/enums'
import type { TripDetailDto } from '@/api/types/trips'
import type { StaffAssignmentDto, StaffListDto, UpdateStaffAssignmentDto } from '@/api/types/staff'
import type { BookingListDto } from '@/api/types/bookings'
import type { RosterFindingDto } from '@/api/types'
```

```tsx
// Before (StaffTab.tsx:50-56):
export default function StaffTab({ tripId, trip, staff, bookings, canWrite }: StaffTabProps) {
  const updateStaffAssignment = useUpdateStaffAssignment()
  const deleteStaffAssignment = useDeleteStaffAssignment()
  const createStaffAssignment = useCreateStaffAssignment()
  const [editingStaff, setEditingStaff] = useState<StaffAssignmentDto | null>(null)
  const [editStaffForm, setEditStaffForm] = useState<StaffEditForm>({} as StaffEditForm)
  const [deletingStaff, setDeletingStaff] = useState<StaffAssignmentDto | null>(null)

// After:
export default function StaffTab({ tripId, trip, staff, bookings, canWrite }: StaffTabProps) {
  const updateStaffAssignment = useUpdateStaffAssignment()
  const deleteStaffAssignment = useDeleteStaffAssignment()
  const createStaffAssignment = useCreateStaffAssignment()
  const checkStaffAssignment = useCheckStaffAssignment()
  const [editingStaff, setEditingStaff] = useState<StaffAssignmentDto | null>(null)
  const [editStaffForm, setEditStaffForm] = useState<StaffEditForm>({} as StaffEditForm)
  const [editFindings, setEditFindings] = useState<RosterFindingDto[]>([])
  const [editOverrideReason, setEditOverrideReason] = useState('')
  const [editReasonRequired, setEditReasonRequired] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState<StaffAssignmentDto | null>(null)
```

```tsx
// Before (StaffTab.tsx:103-134):
  const openEditStaffModal = (s: StaffAssignmentDto) => {
    setEditingStaff(s)
    setEditStaffForm({
      tripInstanceId: s.tripInstanceId,
      staffId: s.staffId,
      assignmentRole: s.assignmentRole ?? '',
      assignmentStart: s.assignmentStart ?? '',
      assignmentEnd: s.assignmentEnd ?? '',
      isDriver: s.isDriver ?? false,
      sleepoverType: s.sleepoverType ?? 'None',
      shiftNotes: s.shiftNotes ?? '',
      status: s.status ?? 'Proposed',
    })
  }

  const handleUpdateStaffAssignment = () => {
    if (!editingStaff) return
    const data: UpdateStaffAssignmentDto = {
      tripInstanceId: editStaffForm.tripInstanceId,
      staffId: editStaffForm.staffId,
      assignmentRole: editStaffForm.assignmentRole || undefined,
      assignmentStart: editStaffForm.assignmentStart,
      assignmentEnd: editStaffForm.assignmentEnd,
      isDriver: editStaffForm.isDriver,
      sleepoverType: editStaffForm.sleepoverType || undefined,
      shiftNotes: editStaffForm.shiftNotes || undefined,
      status: editStaffForm.status,
    }
    updateStaffAssignment.mutate({ id: editingStaff.id, data }, {
      onSuccess: () => setEditingStaff(null),
    })
  }

// After:
  const openEditStaffModal = (s: StaffAssignmentDto) => {
    setEditingStaff(s)
    setEditStaffForm({
      tripInstanceId: s.tripInstanceId,
      staffId: s.staffId,
      assignmentRole: s.assignmentRole ?? '',
      assignmentStart: s.assignmentStart ?? '',
      assignmentEnd: s.assignmentEnd ?? '',
      isDriver: s.isDriver ?? false,
      sleepoverType: s.sleepoverType ?? 'None',
      shiftNotes: s.shiftNotes ?? '',
      status: s.status ?? 'Proposed',
    })
    setEditFindings([])
    setEditOverrideReason('')
    setEditReasonRequired(false)
  }

  // Live dry-run check for the assignment being edited — same treatment StaffAssignModal gets in
  // Task 7: a single un-debounced check fired when the modal opens (excludeAssignmentId keeps the
  // assignment's own row from double-booking against itself). Never writes.
  useEffect(() => {
    if (!editingStaff) return
    checkStaffAssignment.mutate(
      {
        staffId: editingStaff.staffId,
        tripInstanceId: editingStaff.tripInstanceId,
        assignmentStart: editingStaff.assignmentStart,
        assignmentEnd: editingStaff.assignmentEnd,
        excludeAssignmentId: editingStaff.id,
      },
      { onSuccess: setEditFindings },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingStaff?.id])

  const handleUpdateStaffAssignment = () => {
    if (!editingStaff) return
    if (editFindings.some(f => f.severity === 'Blocking')) return
    if (editFindings.some(f => f.requiresReason) && !editOverrideReason.trim()) {
      setEditReasonRequired(true)
      return
    }
    setEditReasonRequired(false)

    const data: UpdateStaffAssignmentDto = {
      tripInstanceId: editStaffForm.tripInstanceId,
      staffId: editStaffForm.staffId,
      assignmentRole: editStaffForm.assignmentRole || undefined,
      assignmentStart: editStaffForm.assignmentStart,
      assignmentEnd: editStaffForm.assignmentEnd,
      isDriver: editStaffForm.isDriver,
      sleepoverType: editStaffForm.sleepoverType || undefined,
      shiftNotes: editStaffForm.shiftNotes || undefined,
      status: editStaffForm.status,
      overrideReason: editOverrideReason.trim() || undefined,
      acknowledgedFindingCodes: editFindings.map(f => f.code),
    }
    updateStaffAssignment.mutate({ id: editingStaff.id, data }, {
      onSuccess: () => setEditingStaff(null),
      onError: (err: unknown) => {
        const serverFindings = getRosterFindings(err)
        if (serverFindings) {
          setEditFindings(serverFindings)
          if (serverFindings.some(f => f.requiresReason) && !editOverrideReason.trim()) setEditReasonRequired(true)
        }
      },
    })
  }
```

```tsx
// Before (StaffTab.tsx:298-320, inside the edit modal, Shift Notes through the Save button):
              {/* Shift Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Shift Notes</label>
                <textarea value={editStaffForm.shiftNotes} onChange={e => setEditStaffForm({ ...editStaffForm, shiftNotes: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-2xl bg-[var(--color-surface-container-low)] text-sm resize-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Error */}
              {updateStaffAssignment.isError && (
                <p className="text-sm text-[var(--color-destructive)]">Failed to update assignment. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingStaff(null)}
                  className="px-4 py-2 rounded-2xl bg-[var(--color-surface-container-low)] text-sm hover:bg-[var(--color-surface-container)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleUpdateStaffAssignment} disabled={updateStaffAssignment.isPending}
                  className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {updateStaffAssignment.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>

// After:
              {/* Shift Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Shift Notes</label>
                <textarea value={editStaffForm.shiftNotes} onChange={e => setEditStaffForm({ ...editStaffForm, shiftNotes: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-2xl bg-[var(--color-surface-container-low)] text-sm resize-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Conflict findings — same gate as StaffAssignModal, via the shared RosterGateFields */}
              <RosterGateFields
                findings={editFindings}
                overrideReason={editOverrideReason}
                onOverrideReasonChange={setEditOverrideReason}
                reasonRequired={editReasonRequired}
              />

              {/* Error */}
              {updateStaffAssignment.isError && (
                <p className="text-sm text-[var(--color-destructive)]">Failed to update assignment. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingStaff(null)}
                  className="px-4 py-2 rounded-2xl bg-[var(--color-surface-container-low)] text-sm hover:bg-[var(--color-surface-container)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleUpdateStaffAssignment} disabled={updateStaffAssignment.isPending || editFindings.some(f => f.severity === 'Blocking')}
                  className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {updateStaffAssignment.isPending ? 'Saving...' : editFindings.some(f => f.requiresReason) ? 'Save with override' : 'Save Changes'}
                </button>
              </div>
```

- [ ] **Step 9: Run to confirm pass**

Run: `npx vitest run src/pages/trip-detail/StaffTab.test.tsx`
Expected: all tests pass — the marker tests, the four new gate tests, and every pre-existing
Add-Staff test (unaffected by this change; `useCheckStaffAssignment`'s mock is simply exercised now
too, since the component calls it unconditionally on every render).

- [ ] **Step 10: Build, lint, full suite, commit**

Run: `npm run build && npm test -- --run`
Expected: 0 TypeScript errors; no new failures.

Run: `npx eslint src/pages/trip-detail/StaffTab.tsx src/pages/trip-detail/StaffTab.test.tsx src/pages/schedule/StaffAssignModal.tsx src/pages/rostering/components/RosterGateFields.tsx`
Expected: no NEW errors vs main.

```bash
git add src/pages/trip-detail/StaffTab.tsx src/pages/trip-detail/StaffTab.test.tsx src/pages/rostering/components/RosterGateFields.tsx src/pages/schedule/StaffAssignModal.tsx
git commit -m "feat(leave): StaffTab edit-modal conflict gate + acknowledged-conflict marker

Extracts RosterGateFields out of StaffAssignModal so StaffTab's inline edit
modal gets the identical live-check/findings/override-reason treatment
instead of a generic error message — the edit modal's editable
Assignment Start/End dates can trip the same gate Task 4 wires into Update.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Self-review

**(a) Spec requirement → task coverage**

| Spec requirement (§3/§4, "trip-side parity" scope) | Task |
|---|---|
| `POST /staff-assignments/check` dry-run, never writes | Task 4 |
| Create/update run the check with a participant-less `RosterCheckContext` | Task 1, Task 4 |
| `RosterConflictService` tolerates a null participant | Task 1 |
| Applicable codes: `STAFF_ON_LEAVE`/`STAFF_RECURRING_UNAVAILABLE`/`STAFF_LEAVE_PENDING`/ `STAFF_UNAVAILABLE`, double-booking codes, `WSC_EXPIRED` | Task 1 (`CheckStaffAssignment`), Task 4 (tests) |
| Blocking → 422; `RequiresReason` finding without reason → 422; codes recorded in `AcknowledgedFindingCodes` | Task 2 (`RosterGate`), Task 4 |
| Reuse — don't duplicate — the gate helper | Task 2 |
| `HasConflict`: `true` iff `OverrideReason` non-null, written by the controller | Task 4 |
| Trip windows are whole days `AssignmentStart..AssignmentEnd`; recurring rules weekday-only | Task 1 (`CheckStaffAssignment`'s window), consumed via PR 1's `IStaffUnavailabilityQuery` |
| `StaffAssignmentDto`/create-update DTOs gain `overrideReason`/`acknowledgedFindingCodes` | Task 3 (backend), Task 6 (frontend) |
| Schedule endpoint exposes enough for a `Tentative` cell, sourced from `IStaffUnavailabilityQuery` | Task 5 |
| `StaffAssignModal.tsx`: live check, `FindingsList`, override-reason gate | Task 7 |
| `SchedulePage.tsx`/`StatusBadge.tsx`: `Unavailable` for approved/legacy/recurring overlap, `Tentative` for pending, `Conflict` unchanged | Task 5 (backend), Task 8 (frontend) |
| `StaffTab.tsx`: acknowledged-conflict marker showing `overrideReason` on hover, plus edit-modal live-check/`RosterGateFields`/override-reason gate parity with `StaffAssignModal` | Task 9 |
| `Odip.Tests/Rostering/StaffAssignmentGateTests.cs` (spec's Testing section, verbatim) | Task 4 |
| Regression: 3 existing `SameTenantWritePathTests.cs` call sites still using `StaffAssignmentsController`'s old 1-arg constructor | Task 4 |

**(b) Rulings made where the spec was silent**

- Ruling: how the trip-side check reuses `Check(Shift, ...)`'s rules — extracted the WSC/
  double-booked-shift/double-booked-trip/staff-unavailable rules into `Shift`-decoupled private
  cores rather than building a fake `Shift` or duplicating the rules — because a `StaffAssignment`
  isn't a `Shift` and its window can span multiple days, which `Shift.EndsNextDay` can't represent.
  See Task 1.
- Ruling: `STAFF_ON_LEAVE`'s/`STAFF_UNAVAILABLE`'s message reference date for the trip path is
  `assignmentStart`, not a per-day date — the spec doesn't specify a reference date for a
  multi-day trip window; `assignmentStart` mirrors `Shift.ServiceDate`'s role as "the" reference
  date and keeps the Shift-path message byte-identical. See Task 1, Step 6.
- Ruling: `RosterGate.EvaluateFindings` takes an optional `subject` parameter ("shift" by default,
  "trip assignment" for `StaffAssignmentsController`) so `RosteringController`'s existing 422
  message text is preserved byte-for-byte rather than being genericised. See Task 2.
- Ruling: `CheckStaffAssignmentDto` carries `TripInstanceId` though the check logic never reads
  it — mirrors `CreateStaffAssignmentDto`'s shape per the brief's explicit request; kept for a
  self-describing dry-run request even though no rule uses it today. See Task 3.
- Ruling: `CreateStaffAssignmentDto` also gains `AcknowledgedFindingCodes` (not just
  `OverrideReason`, which is all the brief named) — `RosterGate.ComputeOverride` needs it to match
  the existing `CreateShiftDto.AcknowledgedFindingCodes` pattern exactly. See Task 3.
- Ruling: `Update`'s `HasConflict` bug (it was never recomputed at all before this PR) is fixed as
  part of wiring the gate, not treated as pre-existing/out-of-scope — there is no way to run the
  gate on `Update` without deriving `HasConflict` from its result. See Task 4.
- Ruling: legacy `StaffAvailability` `Training`-type rows now also render `"Unavailable"` on the
  schedule page (previously only `Unavailable`/`Leave` counted there) — the intended effect of
  routing through the one shared `IStaffUnavailabilityQuery` source; documented as a deliberate,
  minor behaviour change, not a regression. See Task 5.
- Ruling: `StaffAssignModal`'s live check is **not** debounced, unlike `ShiftSlideOver`'s — its
  `staff`/`trip` inputs are fixed props for the modal's lifetime, so there's nothing to debounce
  against. See Task 7.
- Ruling (revised — overturns an earlier draft of this plan): `StaffTab.tsx`'s own inline edit
  modal **does** get the same live-check/`FindingsList`/override-reason-gate treatment
  `StaffAssignModal` gets. An earlier draft scoped this out on the theory that the spec names only
  `StaffAssignModal` and `StaffTab`'s read-only marker, leaving a `RequiresReason` finding on an
  edit to surface as the form's pre-existing generic "Failed to update assignment" message. Re-
  reading the real `frontend/src/pages/trip-detail/StaffTab.tsx:232-325` (the `editingStaff`/
  `editStaffForm` modal) shows that reasoning doesn't hold: the edit modal has editable "Assignment
  Start"/"Assignment End" date inputs (real lines 264-275), submitted through the same `Update`
  endpoint Task 4 gates — so it can trip `STAFF_ON_LEAVE`/`STAFF_RECURRING_UNAVAILABLE`/any other
  `RequiresReason` finding exactly like `StaffAssignModal` can, and a generic error message with no
  findings list and no way to enter an override reason would leave the coordinator stuck with no
  path to save. That's an incomplete implementation of spec §3's override-reason parity for this
  entry point, not an acceptable, out-of-scope gap. Task 9 now extracts the findings/reason-field/
  blocking-message JSX Task 7 built into `StaffAssignModal.tsx` into a shared
  `RosterGateFields` component (mirroring how this plan's own Task 2 extracted `RosterGate` out of
  `RosteringController`) and reuses it — along with the already-shared `useCheckStaffAssignment`
  and `getRosterFindings` — in `StaffTab`'s edit modal, so the two forms can't drift.
- Ruling (cross-plan, discovered mid-exploration, not in the brief): PR 2
  (`docs/plans/2026-09-07-staff-leave-2-portal-approvals.md`) already ships
  `RosterFindingDto.requiresReason` and `LeaveBarDto.kind` on the frontend
  (`src/api/types/rostering.ts`) and updates the shared `makeFinding` fixture. This plan consumes
  those rather than redefining them — Task 6 only touches `staff.ts`'s types/hooks, never
  `rostering.ts` or `test-fixtures.ts`. Flagging this explicitly since the brief only named plan 1
  as required reading, and re-adding `requiresReason` here would have silently duplicated PR 2's
  work.

**(c) Spec items in this plan's named scope that could NOT be mapped to a task**

None. Every backend and frontend item the brief lists under "Scope = spec Delivery item 3" has a
task above. (`ShiftSlideOver.tsx`'s `reasonRequired`-keys-off-`requiresReason` change, mentioned in
the spec's §4 "Roster board" prose, is PR 2's Task 5, not this plan's — confirmed by reading PR 2,
which explicitly claims it.)
