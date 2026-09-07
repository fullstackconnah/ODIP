# Staff Leave + Recurring Unavailability — Backend Implementation Plan (PR 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the entire backend surface for staff self-service leave/recurring-unavailability requests with coordinator approval — domain model, migration, the shared `StaffUnavailabilityQuery` conflict source, `RosterConflictService`'s three new finding codes plus the `RequiresReason` gate, and the `LeaveController`/`PortalController` API — in one PR that builds and tests green on its own, with no frontend changes.

**Architecture:** Two new tenant-scoped entities (`LeaveRequest`, `RecurringUnavailability`) replace `StaffAvailability`'s `Leave` rows as the source of truth for staff time off; a new `RecurringUnavailabilityExpander` (mirrors `ShiftPatternExpander`) turns a weekly rule into concrete dates. A new Infrastructure service, `StaffUnavailabilityQuery`, unions all three unavailability sources (leave, recurring rules, legacy `StaffAvailability` rows) into a single `UnavailabilityWindow` list tagged by `UnavailabilityKind`, replacing the duplicated `LeaveTypes`/`UnavailableTypes` constants in `RosteringController` and `RosterConflictService`. `RosterConflictService` gains a `RequiresReason` flag on `RosterFinding` and three new codes driven by `UnavailabilityKind`; `RosteringController.EvaluateFindings` is rewritten to gate on `RequiresReason` instead of "any Warning present." `LeaveController` (coordinator) and new `PortalController` actions (staff self-service) share the same `LeaveStatus` state machine and DTOs.

**Tech Stack:** .NET 8, EF Core 8 + Npgsql, xUnit + Moq + EF InMemory, ASP.NET Core MVC.

**Spec:** `docs/specs/2026-09-07-staff-leave-unavailability-design.md` — read it first; this plan argues from it.

## Global Constraints

- Run all backend commands from `odip-prototype/odip/backend`. Repo root for `git` is `F:\Projects\personal\ODIP`.
- Never touch `bin/`, `obj/`, `_to_delete/`, `odip-prototype.zip`, `docs/superpowers/`, `.claude/worktrees/`, `docs/specs/odip-updates-2026-09/`.
- **Migrations:** ADD only. Never rename, reorder or edit an existing migration file — `Program.cs` has raw-SQL `__EFMigrationsHistory` self-healing pinned to specific migration IDs. This PR's migration is the single, purely additive `AddStaffLeaveAndRecurringUnavailability` — it also adds `StaffAssignments.OverrideReason`/`AcknowledgedFindingCodes` and the leave-data backfill, per the orchestrator's ruling that everything additive lands in one migration.
- **No MediatR handlers, no AutoMapper profiles** — both packages are referenced but unused by design.
- Enums are plain int-backed EF columns (repo default) — do not add `HasConversion<string>()` for `LeaveType`/`LeaveStatus`/`UnavailabilityKind` without a concrete reason; none exists here.
- `DateOnly`/`TimeOnly` for date-only/time-only fields on the two new entities, matching `Shift`/`ShiftPattern`/`StaffAssignment` convention — never `DateTime` (that is `StaffAvailability`'s older, now-superseded pattern).
- `ITenantEntity` on both new entities; `OdipDbContext.SaveChangesAsync` auto-populates `TenantId` from `ICurrentTenant` — never set it manually in a controller.
- DTOs: `namespace Odip.Application.DTOs;`, `public record`, `{ get; init; }`, feature-named file (`LeaveDTOs.cs`). Property names are the camelCase wire contract — `RosteringDTOs.cs`'s own header comment states the discipline this file joins.
- 404-never-403 idiom on every `PortalController` action: a portal caller can never learn that a leave/unavailability row exists for someone else. Every write there resolves the caller's own id via `ResolveCurrentStaffIdAsync` first.
- Blocking/Warning/override gate (extended this PR): any `Severity == Blocking` finding refuses the write regardless of reason; any finding with `RequiresReason == true` needs a non-empty `overrideReason`; codes are recorded in `AcknowledgedFindingCodes` whenever any finding fired, reason-required or not.
- Tests: xUnit, `Mock<ICurrentTenant>` into `OdipDbContext`, controllers constructed directly with `new`, fixtures inline per file — copy the scaffold in `Odip.Tests/Rostering/RosteringControllerTests.cs` (EF InMemory + Moq) and `Odip.Tests/Rostering/RosteringAuditTests.cs` (adds `AuditInterceptor` + a `ClaimsPrincipal`-bearing `IHttpContextAccessor`), and `Odip.Tests/Portal/PortalControllerTests.cs` (adds a `NameIdentifier` claim on `ControllerContext.HttpContext.User`).
- Gates before every commit: `dotnet build` (0 errors) and `dotnet test` (0 failed).
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  ```

---

## File Structure

| File | Responsibility |
|---|---|
| Create `Odip.Domain/Rostering/LeaveEntities.cs` | `LeaveType`, `LeaveStatus`, `LeaveRequest`, `RecurringUnavailability` |
| Create `Odip.Domain/Rostering/Services/RecurringUnavailabilityExpander.cs` | Rule → concrete `DateOnly` occurrences |
| Create `Odip.Domain/Rostering/Services/UnavailabilityWindow.cs` | `UnavailabilityKind`, `UnavailabilityWindow` (see Task 2 for why this lives in Domain, not Infrastructure as the spec's file list literally states) |
| Modify `Odip.Domain/Rostering/Services/RosterConflictService.cs` | `RosterFinding.RequiresReason`; `RosterCheckContext.Availability` retyped to `UnavailabilityWindow`; `CheckStaffUnavailable` rewritten; 3 new codes |
| Modify `Odip.Tests/Rostering/RosterConflictServiceTests.cs` | Existing `StaffAvailability`-based fixtures converted to `UnavailabilityWindow`; new tests for the 3 codes + `RequiresReason` |
| Modify `Odip.Domain/Entities/StaffAssignment.cs` | `OverrideReason`, `AcknowledgedFindingCodes` (PR 3 wires the gate; this PR only adds the columns per the migration ruling) |
| Modify `Odip.Infrastructure/Data/OdipDbContext.cs` | 2 new `DbSet`s, `OnModelCreating` config + query filters, `StaffAssignment` property config |
| Create migration `AddStaffLeaveAndRecurringUnavailability` | Schema + leave-data backfill (see Task 3) |
| Modify `Odip.Infrastructure/Audit/AuditedEntities.cs` | Add `LeaveRequest`, `RecurringUnavailability`, `StaffAvailability` |
| Create `Odip.Infrastructure/Rostering/StaffUnavailabilityQuery.cs` | `IStaffUnavailabilityQuery`/`StaffUnavailabilityQuery` |
| Create `Odip.Tests/Leave/StaffUnavailabilityQueryTests.cs` | EF InMemory union tests |
| Create `Odip.Tests/Leave/RecurringUnavailabilityExpanderTests.cs` | Pure unit tests |
| Modify `Odip.Api/Program.cs` | DI registration for `IStaffUnavailabilityQuery` |
| Modify `Odip.Api/Controllers/RosteringController.cs` | Consumes `IStaffUnavailabilityQuery`; `EvaluateFindings` gate rewrite; `LeaveTypes` constant removed |
| Modify `Odip.Application/DTOs/RosteringDTOs.cs` | `RosterFindingDto.RequiresReason`; `LeaveBarDto` gains `Kind` + nullable `StartTime`/`EndTime` (keeps `AvailabilityType`/`Notes`, now nullable) |
| Modify `Odip.Tests/Rostering/RosteringControllerTests.cs` | Constructor call sites updated (22 occurrences); gate + board tests added |
| Create `Odip.Application/DTOs/LeaveDTOs.cs` | All leave/unavailability DTOs |
| Create `Odip.Api/Controllers/LeaveController.cs` | `api/v1/leave` — coordinator surface |
| Create `Odip.Tests/Leave/LeaveControllerTests.cs` | |
| Modify `Odip.Api/Controllers/PortalController.cs` | 5 new leave/unavailability actions |
| Create `Odip.Tests/Portal/PortalLeaveTests.cs` | |
| Create `Odip.Tests/Leave/LeaveAuditTests.cs` | Mirrors `RosteringAuditTests.cs` |

---

## Task 1: Domain — `LeaveType`/`LeaveStatus`, `LeaveRequest`/`RecurringUnavailability`, `RecurringUnavailabilityExpander`

**Files:**
- Create: `Odip.Domain/Rostering/LeaveEntities.cs`
- Create: `Odip.Domain/Rostering/Services/RecurringUnavailabilityExpander.cs`
- Test: `Odip.Tests/Leave/RecurringUnavailabilityExpanderTests.cs`

**Interfaces:**
- Produces: `LeaveType { Annual, Sick, Personal, Other }` (int-backed, in that ordinal order); `LeaveStatus { Pending, Approved, Declined, Cancelled }` (int-backed, in that ordinal order — the EF InMemory/Postgres storage order, load-bearing for the migration's data-backfill step in Task 3); `LeaveRequest`, `RecurringUnavailability` (both `ITenantEntity`); `public sealed class RecurringUnavailabilityExpander { public IReadOnlyList<DateOnly> Occurrences(RecurringUnavailability rule, DateOnly from, DateOnly to); }`.

- [ ] **Step 1: Write the entities and enums**

```csharp
// Odip.Domain/Rostering/LeaveEntities.cs
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>Kind of date-range leave. Ordinal order is stable — used as a plain int EF column.</summary>
public enum LeaveType { Annual, Sick, Personal, Other }

/// <summary>
/// Shared lifecycle for both <see cref="LeaveRequest"/> and <see cref="RecurringUnavailability"/>.
/// Ordinal order is stable — used as a plain int EF column, and the migration's leave-data
/// backfill (Task 3) writes the literal value 1 (Approved) for legacy rows.
/// State-transition matrix: Pending -> Approved (coordinator) | Declined (coordinator, note
/// required) | Cancelled (staff, own, or coordinator). Approved -> Cancelled (coordinator only).
/// Declined and Cancelled are terminal. An on-behalf coordinator entry starts directly at
/// Approved — not a transition, the initial state.
/// </summary>
public enum LeaveStatus { Pending, Approved, Declined, Cancelled }

/// <summary>
/// A staff member's date-range leave request (Annual/Sick/Personal/Other), whole days only.
/// Tenant-scoped directly (unlike the <see cref="Entities.StaffAvailability"/> rows it
/// supersedes) to match the newer rostering entities' convention. See
/// docs/specs/2026-09-07-staff-leave-unavailability-design.md §1.
/// </summary>
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

/// <summary>
/// A staff member's weekly-recurring unavailability window (day of week + same-day time range,
/// effective date range) — the true recurrence <see cref="Entities.StaffAvailability"/>'s unused
/// <c>IsRecurring</c>/<c>RecurrenceNotes</c> pair never implemented. Structurally mirrors
/// <see cref="ShiftPattern"/>; no overnight windows (EndTime must be after StartTime), no
/// monthly/nth-weekday recurrence — weekly only, same as <see cref="ShiftPatternExpander"/>.
/// </summary>
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

- [ ] **Step 2: Write the expander**

```csharp
// Odip.Domain/Rostering/Services/RecurringUnavailabilityExpander.cs
namespace Odip.Domain.Rostering.Services;

/// <summary>
/// Materialises a <see cref="RecurringUnavailability"/> rule into the concrete dates it covers
/// in a given window. Mirrors <see cref="ShiftPatternExpander.Occurrences"/> exactly, minus the
/// <c>IsActive</c> check — this entity has no such flag; a rule is either not yet decided
/// (Pending, and callers must filter that out themselves — this type does no status filtering)
/// or decided.
/// </summary>
public sealed class RecurringUnavailabilityExpander
{
    /// <summary>
    /// Every date matching <paramref name="rule"/>'s <see cref="RecurringUnavailability.DayOfWeek"/>
    /// inside the intersection of [<paramref name="from"/>, <paramref name="to"/>] and
    /// [<see cref="RecurringUnavailability.EffectiveFrom"/>, <see cref="RecurringUnavailability.EffectiveTo"/>].
    /// </summary>
    public IReadOnlyList<DateOnly> Occurrences(RecurringUnavailability rule, DateOnly from, DateOnly to)
    {
        ArgumentNullException.ThrowIfNull(rule);

        var results = new List<DateOnly>();
        if (from > to)
            return results;

        var rangeStart = from > rule.EffectiveFrom ? from : rule.EffectiveFrom;
        var rangeEnd = rule.EffectiveTo.HasValue && rule.EffectiveTo.Value < to ? rule.EffectiveTo.Value : to;

        if (rangeStart > rangeEnd)
            return results;

        var offsetToFirstMatch = ((int)rule.DayOfWeek - (int)rangeStart.DayOfWeek + 7) % 7;
        var current = rangeStart.AddDays(offsetToFirstMatch);

        while (current <= rangeEnd)
        {
            results.Add(current);
            current = current.AddDays(7);
        }

        return results;
    }
}
```

- [ ] **Step 3: Write the failing tests**

```csharp
// Odip.Tests/Leave/RecurringUnavailabilityExpanderTests.cs
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.Leave;

public class RecurringUnavailabilityExpanderTests
{
    private static RecurringUnavailability Rule(
        DayOfWeek dayOfWeek, DateOnly effectiveFrom, DateOnly? effectiveTo = null) => new()
    {
        Id = Guid.NewGuid(), UserId = Guid.NewGuid(), DayOfWeek = dayOfWeek,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
        EffectiveFrom = effectiveFrom, EffectiveTo = effectiveTo,
    };

    [Fact]
    public void Matches_every_occurrence_of_the_weekday_in_range()
    {
        var rule = Rule(DayOfWeek.Wednesday, new DateOnly(2026, 9, 1));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Equal(
            new[] { new DateOnly(2026, 9, 2), new DateOnly(2026, 9, 9), new DateOnly(2026, 9, 16), new DateOnly(2026, 9, 23), new DateOnly(2026, 9, 30) },
            occurrences);
    }

    [Fact]
    public void Clips_to_effective_from_when_the_range_starts_earlier()
    {
        var rule = Rule(DayOfWeek.Monday, new DateOnly(2026, 9, 14));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Equal(new[] { new DateOnly(2026, 9, 14), new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 28) }, occurrences);
    }

    [Fact]
    public void Clips_to_effective_to_when_set()
    {
        var rule = Rule(DayOfWeek.Friday, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 18));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Equal(new[] { new DateOnly(2026, 9, 4), new DateOnly(2026, 9, 11), new DateOnly(2026, 9, 18) }, occurrences);
    }

    [Fact]
    public void Open_ended_effective_to_does_not_clip()
    {
        var rule = Rule(DayOfWeek.Tuesday, new DateOnly(2026, 1, 1), effectiveTo: null);
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Equal(new[] { new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 8), new DateOnly(2026, 9, 15), new DateOnly(2026, 9, 22), new DateOnly(2026, 9, 29) }, occurrences);
    }

    [Fact]
    public void Range_entirely_before_effective_from_returns_nothing()
    {
        var rule = Rule(DayOfWeek.Monday, new DateOnly(2026, 10, 1));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Empty(occurrences);
    }

    [Fact]
    public void Range_entirely_after_effective_to_returns_nothing()
    {
        var rule = Rule(DayOfWeek.Monday, new DateOnly(2026, 1, 1), new DateOnly(2026, 8, 1));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Empty(occurrences);
    }

    [Fact]
    public void From_after_to_returns_nothing()
    {
        var rule = Rule(DayOfWeek.Monday, new DateOnly(2026, 1, 1));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 30), new DateOnly(2026, 9, 1));

        Assert.Empty(occurrences);
    }
}
```

- [ ] **Step 4: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~RecurringUnavailabilityExpanderTests"`
Expected: build error — `RecurringUnavailability`/`RecurringUnavailabilityExpander` do not exist (before Step 1/2's files exist; if run after Steps 1-2 are already written, skip straight to Step 5).

- [ ] **Step 5: Run to confirm pass**

Run: `dotnet test --filter "FullyQualifiedName~RecurringUnavailabilityExpanderTests"`
Expected: `Passed: 7, Failed: 0`.

- [ ] **Step 6: Build, full suite, commit**

Run: `dotnet build` → 0 errors. Run: `dotnet test` → 0 failed (this task adds no other test-visible surface yet).

```bash
git add Odip.Domain/Rostering/LeaveEntities.cs Odip.Domain/Rostering/Services/RecurringUnavailabilityExpander.cs Odip.Tests/Leave/RecurringUnavailabilityExpanderTests.cs
git commit -m "feat(leave): LeaveRequest/RecurringUnavailability entities and the recurrence expander

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 2: Domain — `RosterConflictService`: `RequiresReason` + `UnavailabilityWindow`-based unavailability checking

**Files:**
- Create: `Odip.Domain/Rostering/Services/UnavailabilityWindow.cs`
- Modify: `Odip.Domain/Rostering/Services/RosterConflictService.cs`
- Modify: `Odip.Tests/Rostering/RosterConflictServiceTests.cs`

**Interfaces:**
- Consumes: nothing new (pure domain).
- Produces: `UnavailabilityKind { ApprovedLeave, PendingLeave, RecurringRule, Legacy }`; `public sealed record UnavailabilityWindow(Guid UserId, DateTime Start, DateTime End, UnavailabilityKind Kind);`; `RosterFinding` gains a 4th positional member `bool RequiresReason = false`; `RosterCheckContext.Availability` is now `IReadOnlyList<UnavailabilityWindow>` (was `IReadOnlyList<StaffAvailability>`); new codes `RosterConflictService.StaffOnLeave = "STAFF_ON_LEAVE"`, `.StaffRecurringUnavailable = "STAFF_RECURRING_UNAVAILABLE"`, `.StaffLeavePending = "STAFF_LEAVE_PENDING"`.

**Ruling — where `UnavailabilityWindow`/`UnavailabilityKind` live:** the spec's §3 code block places them in `Odip.Infrastructure/Rostering/StaffUnavailabilityQuery.cs`, but `RosterConflictService` — which the same section requires to consume `UnavailabilityWindow` — lives in `Odip.Domain`, and `Odip.Domain.csproj` has **zero** `ProjectReference`s (confirmed by reading the csproj): Domain cannot depend on Infrastructure. This plan defines both types in `Odip.Domain/Rostering/Services/UnavailabilityWindow.cs` instead, and `Odip.Infrastructure/Rostering/StaffUnavailabilityQuery.cs` (Task 4) references them from there — the same interface-in-Infrastructure/shapes-in-Domain split already used for `IHolidayProvider`/`NagerHolidayProvider` (interface and impl both in `Odip.Infrastructure.Services`) alongside `RosterFinding` itself (a Domain-defined shape Infrastructure code already produces via `RosterConflictService`).

**Ruling — `STAFF_ON_LEAVE`'s message drops the specific leave type:** the spec's message template is `"{Name}'s leave ({LeaveType}) covers this window — cannot roster without a reason."`, but `UnavailabilityWindow` — the spec's own fixed 4-field record — carries no `LeaveType`, and `RosterConflictService` is deliberately pure (no I/O, so it cannot look the type up). The message says `"{Name}'s approved leave covers this window — cannot roster without a reason."` instead. The exact leave type remains visible on the leave list and at approve-time.

**Ruling — `UnavailabilityWindow` carries optional legacy sub-type/notes fields:** the orchestrator rejected an earlier draft ruling that would have had `LeaveBarDto` (Task 5) drop `AvailabilityType`/`Notes` outright because `UnavailabilityWindow` couldn't supply them. Instead, `LeaveBarDto` keeps both fields (nullable) — see Task 5 — which means `UnavailabilityWindow` itself must be able to carry a `Legacy` window's original `AvailabilityType` and `Notes` through from `StaffUnavailabilityQuery` (Task 4). Two optional trailing positional members, `LegacySourceType`/`LegacyNotes`, do this without disturbing the 4-argument construction every other call site (including every test in this task) already uses. `StartTime`/`EndTime` on `LeaveBarDto` need no `UnavailabilityWindow` change at all — Task 5 derives them directly from `Start.TimeOfDay`/`End.TimeOfDay` when `Kind == RecurringRule`, since a `RecurringRule` window is already one concrete occurrence's date + time-of-day.

- [ ] **Step 1: Write `UnavailabilityWindow`**

```csharp
// Odip.Domain/Rostering/Services/UnavailabilityWindow.cs
using Odip.Domain.Enums;

namespace Odip.Domain.Rostering.Services;

/// <summary>
/// Which of the three unavailability sources <see cref="Infrastructure.Rostering.StaffUnavailabilityQuery"/>
/// (see that type's remarks for why the interface lives in Infrastructure while this shape lives
/// here) tagged a given <see cref="UnavailabilityWindow"/> with. Only <c>Approved</c>
/// <see cref="RecurringUnavailability"/> rules ever produce a <see cref="RecurringRule"/> window —
/// a Pending rule raises nothing, per docs/specs/2026-09-07-staff-leave-unavailability-design.md §3.
/// </summary>
public enum UnavailabilityKind
{
    ApprovedLeave,
    PendingLeave,
    RecurringRule,
    Legacy
}

/// <summary>
/// One concrete time window a staff member is unavailable for, from whichever of the three
/// sources produced it. <see cref="Start"/>/<see cref="End"/> are always a concrete
/// <see cref="DateTime"/> pair — for a <see cref="UnavailabilityKind.RecurringRule"/> window this
/// is one specific occurrence's date + time-of-day, already expanded by
/// <see cref="RecurringUnavailabilityExpander"/>, never the raw weekly rule.
/// <see cref="LegacySourceType"/>/<see cref="LegacyNotes"/> are populated only for
/// <see cref="UnavailabilityKind.Legacy"/> windows (the source <see cref="Entities.StaffAvailability"/>
/// row's own <c>AvailabilityType</c>/<c>Notes</c>) — <see cref="RosteringDTOs.LeaveBarDto"/> (Task 5)
/// surfaces them on the roster board; <see cref="RosterConflictService"/> itself never reads either.
/// </summary>
public sealed record UnavailabilityWindow(
    Guid UserId, DateTime Start, DateTime End, UnavailabilityKind Kind,
    AvailabilityType? LegacySourceType = null, string? LegacyNotes = null);
```

- [ ] **Step 2: Rewrite `RosterFinding`, `RosterCheckContext.Availability`, and `CheckStaffUnavailable`**

Modify `Odip.Domain/Rostering/Services/RosterConflictService.cs`:

```csharp
// Before (line 8):
public sealed record RosterFinding(string Code, RosterFindingSeverity Severity, string Message);

// After:
/// <summary>
/// One finding produced by <see cref="RosterConflictService"/> against a single candidate shift.
/// <see cref="RequiresReason"/> — new this feature — is true for a finding the Blocking/Warning
/// gate demands a non-empty override reason for; false means the finding still gets recorded in
/// AcknowledgedFindingCodes when the write saves, but no reason is required (e.g. a merely
/// pending leave request is a softer signal than an already-approved one).
/// </summary>
public sealed record RosterFinding(string Code, RosterFindingSeverity Severity, string Message, bool RequiresReason = false);
```

```csharp
// Before (param doc + record, lines 20/29):
/// <param name="Availability">This staff member's availability records relevant to the candidate's window.</param>
...
    IReadOnlyList<StaffAvailability> Availability,

// After:
/// <param name="Availability">This staff member's unavailability windows (leave, recurring rules, legacy StaffAvailability rows) relevant to the candidate's window — see <see cref="Infrastructure.Rostering.StaffUnavailabilityQuery"/>.</param>
...
    IReadOnlyList<UnavailabilityWindow> Availability,
```

```csharp
// Before (lines 51-60):
    public const string StaffUnavailable = "STAFF_UNAVAILABLE";
    public const string CompatibilityExcluded = "COMPATIBILITY_EXCLUDED";
    public const string CredentialExpired = "CREDENTIAL_EXPIRED";
    public const string CompetencyMissing = "COMPETENCY_MISSING";
    public const string RatioShortfall = "RATIO_SHORTFALL";
    public const string OverHours = "OVER_HOURS";

    /// <summary>Availability types that make a staff member unavailable to roster, as opposed to merely non-preferred.</summary>
    private static readonly AvailabilityType[] UnavailableTypes =
        { AvailabilityType.Unavailable, AvailabilityType.Leave, AvailabilityType.Training };

// After:
    public const string StaffUnavailable = "STAFF_UNAVAILABLE";
    public const string StaffOnLeave = "STAFF_ON_LEAVE";
    public const string StaffRecurringUnavailable = "STAFF_RECURRING_UNAVAILABLE";
    public const string StaffLeavePending = "STAFF_LEAVE_PENDING";
    public const string CompatibilityExcluded = "COMPATIBILITY_EXCLUDED";
    public const string CredentialExpired = "CREDENTIAL_EXPIRED";
    public const string CompetencyMissing = "COMPETENCY_MISSING";
    public const string RatioShortfall = "RATIO_SHORTFALL";
    public const string OverHours = "OVER_HOURS";
```

(The `UnavailableTypes` constant and its `AvailabilityType[]` are removed outright — `StaffUnavailabilityQuery`, Task 4, is now the single place that decides which `StaffAvailability` rows count.)

```csharp
// Before (CheckStaffUnavailable, lines 138-153):
    private static void CheckStaffUnavailable(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);

        foreach (var availability in ctx.Availability)
        {
            if (!UnavailableTypes.Contains(availability.AvailabilityType))
                continue;

            if (availability.StartDateTime < candidateWindow.End && candidateWindow.Start < availability.EndDateTime)
            {
                findings.Add(new RosterFinding(StaffUnavailable, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} is marked {availability.AvailabilityType} for part of {Fmt(candidate.ServiceDate)}."));
            }
        }
    }

// After:
    /// <summary>
    /// One finding per overlapping <see cref="UnavailabilityWindow"/>, discriminated on
    /// <see cref="UnavailabilityKind"/>: an already-Approved leave request or recurring rule is a
    /// hard Warning that demands a reason (STAFF_ON_LEAVE / STAFF_RECURRING_UNAVAILABLE); a
    /// merely Pending leave request is a softer signal that needs none (STAFF_LEAVE_PENDING); a
    /// legacy StaffAvailability Unavailable/Training row keeps the original STAFF_UNAVAILABLE
    /// code and reason-not-required behaviour, unchanged from before this feature.
    /// </summary>
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
```

`AvailabilityType` is no longer referenced anywhere in this file — remove the now-unused `using Odip.Domain.Enums;` only if the compiler flags it (`CheckCompetencyMissing` etc. still use other `Odip.Domain.Enums` members like `OvernightSupportType`, so the `using` almost certainly stays; verify with `dotnet build`, don't remove speculatively).

- [ ] **Step 3: Run to confirm the existing suite breaks at compile time**

Run: `dotnet build`
Expected: compile errors in `Odip.Tests/Rostering/RosterConflictServiceTests.cs` — `CompliantContext`'s `availability` parameter and 3 call sites still pass `StaffAvailability`, which no longer matches `RosterCheckContext.Availability`'s new `IReadOnlyList<UnavailabilityWindow>` type.

- [ ] **Step 4: Fix the existing test file's fixtures**

In `Odip.Tests/Rostering/RosterConflictServiceTests.cs`:

```csharp
// Before (CompliantContext helper):
    private static RosterCheckContext CompliantContext(
        User staff,
        Participant participant,
        IReadOnlyList<Shift>? staffShiftsInWeek = null,
        IReadOnlyList<Shift>? participantShiftsOnDate = null,
        IReadOnlyList<StaffAssignment>? tripAssignments = null,
        IReadOnlyList<StaffAvailability>? availability = null,
        CompatibilityLevel compatibility = CompatibilityLevel.Allowed,
        decimal weeklyHoursThreshold = RosterConflictService.DefaultWeeklyHoursThreshold) => new(
        Staff: staff,
        Participant: participant,
        StaffShiftsInWeek: staffShiftsInWeek ?? Array.Empty<Shift>(),
        ParticipantShiftsOnDate: participantShiftsOnDate ?? Array.Empty<Shift>(),
        TripAssignments: tripAssignments ?? Array.Empty<StaffAssignment>(),
        Availability: availability ?? Array.Empty<StaffAvailability>(),
        Compatibility: compatibility,
        WeeklyHoursThreshold: weeklyHoursThreshold);

// After:
    private static RosterCheckContext CompliantContext(
        User staff,
        Participant participant,
        IReadOnlyList<Shift>? staffShiftsInWeek = null,
        IReadOnlyList<Shift>? participantShiftsOnDate = null,
        IReadOnlyList<StaffAssignment>? tripAssignments = null,
        IReadOnlyList<UnavailabilityWindow>? availability = null,
        CompatibilityLevel compatibility = CompatibilityLevel.Allowed,
        decimal weeklyHoursThreshold = RosterConflictService.DefaultWeeklyHoursThreshold) => new(
        Staff: staff,
        Participant: participant,
        StaffShiftsInWeek: staffShiftsInWeek ?? Array.Empty<Shift>(),
        ParticipantShiftsOnDate: participantShiftsOnDate ?? Array.Empty<Shift>(),
        TripAssignments: tripAssignments ?? Array.Empty<StaffAssignment>(),
        Availability: availability ?? Array.Empty<UnavailabilityWindow>(),
        Compatibility: compatibility,
        WeeklyHoursThreshold: weeklyHoursThreshold);
```

In `Worker_screening_expired_is_the_only_blocking_finding_the_engine_can_ever_emit`:

```csharp
// Before:
        var availability = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, User = staff,
            AvailabilityType = AvailabilityType.Unavailable,
            StartDateTime = ServiceDate.ToDateTime(new TimeOnly(8, 0)),
            EndDateTime = ServiceDate.ToDateTime(new TimeOnly(12, 0)),
        };

        var findings = new RosterConflictService().Check(candidate, CompliantContext(
            staff, participant,
            staffShiftsInWeek: new[] { otherShift, overlapping },
            tripAssignments: new[] { assignment },
            availability: new[] { availability },
            compatibility: CompatibilityLevel.Excluded,
            weeklyHoursThreshold: 1m));

// After:
        var availability = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(8, 0)), ServiceDate.ToDateTime(new TimeOnly(12, 0)),
            UnavailabilityKind.Legacy);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(
            staff, participant,
            staffShiftsInWeek: new[] { otherShift, overlapping },
            tripAssignments: new[] { assignment },
            availability: new[] { availability },
            compatibility: CompatibilityLevel.Excluded,
            weeklyHoursThreshold: 1m));
```

In `Unavailable_record_overlapping_the_shift_window_fires_staff_unavailable`:

```csharp
// Before:
        var availability = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, User = staff,
            AvailabilityType = AvailabilityType.Unavailable,
            StartDateTime = ServiceDate.ToDateTime(new TimeOnly(8, 0)),
            EndDateTime = ServiceDate.ToDateTime(new TimeOnly(12, 0)),
        };

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { availability }));

        Assert.True(HasCode(findings, RosterConflictService.StaffUnavailable));

// After:
        var availability = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(8, 0)), ServiceDate.ToDateTime(new TimeOnly(12, 0)),
            UnavailabilityKind.Legacy);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { availability }));

        Assert.True(HasCode(findings, RosterConflictService.StaffUnavailable));
        Assert.False(findings.Single(f => f.Code == RosterConflictService.StaffUnavailable).RequiresReason);
```

`Available_record_does_not_fire_staff_unavailable` (the "Available" case) is deleted outright — `UnavailabilityWindow` has no "Available" concept; the source (`StaffAvailability` rows of type `Available`) is simply never turned into a window by `StaffUnavailabilityQuery` at all, so there is nothing left for this test to exercise. Its intent (an `Available`-type row never produces a finding) is now proven at the `StaffUnavailabilityQueryTests` level (Task 4), where such rows are confirmed to yield zero windows.

- [ ] **Step 5: Add the new tests**

Append to `Odip.Tests/Rostering/RosterConflictServiceTests.cs`:

```csharp
    // ── STAFF_ON_LEAVE / STAFF_RECURRING_UNAVAILABLE / STAFF_LEAVE_PENDING ──

    [Fact]
    public void Approved_leave_window_fires_staff_on_leave_and_requires_a_reason()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(0, 0)), ServiceDate.AddDays(1).ToDateTime(new TimeOnly(0, 0)),
            UnavailabilityKind.ApprovedLeave);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffOnLeave);
        Assert.True(finding.RequiresReason);
        Assert.Equal(RosterFindingSeverity.Warning, finding.Severity);
        Assert.False(HasCode(findings, RosterConflictService.StaffUnavailable));
    }

    [Fact]
    public void Pending_leave_window_fires_staff_leave_pending_and_does_not_require_a_reason()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(0, 0)), ServiceDate.AddDays(1).ToDateTime(new TimeOnly(0, 0)),
            UnavailabilityKind.PendingLeave);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffLeavePending);
        Assert.False(finding.RequiresReason);
    }

    [Fact]
    public void Approved_recurring_window_fires_staff_recurring_unavailable_and_requires_a_reason()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(8, 0)), ServiceDate.ToDateTime(new TimeOnly(12, 0)),
            UnavailabilityKind.RecurringRule);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffRecurringUnavailable);
        Assert.True(finding.RequiresReason);
        Assert.Contains("Monday", finding.Message); // ServiceDate (2026-08-24) is a Monday
    }

    [Fact]
    public void Non_overlapping_unavailability_window_fires_nothing()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(12, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(13, 0)), ServiceDate.ToDateTime(new TimeOnly(17, 0)),
            UnavailabilityKind.ApprovedLeave);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        Assert.False(HasCode(findings, RosterConflictService.StaffOnLeave));
    }

    [Fact]
    public void Legacy_window_still_fires_staff_unavailable_without_requiring_a_reason()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(8, 0)), ServiceDate.ToDateTime(new TimeOnly(12, 0)),
            UnavailabilityKind.Legacy);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffUnavailable);
        Assert.False(finding.RequiresReason);
    }

    [Fact]
    public void Every_other_finding_still_defaults_RequiresReason_to_false()
    {
        var staff = CompliantStaff();
        staff.WorkerScreeningExpiryDate = null; // WSC_MISSING
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.All(findings, f => Assert.False(f.RequiresReason));
    }
```

- [ ] **Step 6: Run to confirm pass**

Run: `dotnet test --filter "FullyQualifiedName~RosterConflictServiceTests"`
Expected: `Passed: 33, Failed: 0` (28 pre-existing `[Fact]`/`[Theory]` methods, minus 1 deleted in Step 4, plus 6 new in Step 5 — 28-1+6 = 33; recount against the actual file before asserting the number if it drifts, the point is `Failed: 0`).

- [ ] **Step 7: Build, full suite, commit**

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0` (other suites still reference the old 3-arg `RosterFinding`/`StaffAvailability`-typed context only in `RosteringControllerTests.cs`, fixed in Task 5 — if `dotnet build` fails there now, that is expected and resolved in Task 5, not here; run `dotnet test --filter "FullyQualifiedName~RosterConflictServiceTests"` alone if the full build doesn't yet compile).

```bash
git add Odip.Domain/Rostering/Services/UnavailabilityWindow.cs Odip.Domain/Rostering/Services/RosterConflictService.cs Odip.Tests/Rostering/RosterConflictServiceTests.cs
git commit -m "feat(rostering): RequiresReason gate + UnavailabilityWindow-based unavailability checking

STAFF_ON_LEAVE, STAFF_RECURRING_UNAVAILABLE, STAFF_LEAVE_PENDING join
STAFF_UNAVAILABLE, discriminated by UnavailabilityKind. RosterCheckContext.Availability
is now sourced from StaffUnavailabilityQuery (Task 4) instead of raw StaffAvailability rows.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 3: `OdipDbContext` wiring, `StaffAssignment` override fields, `AddStaffLeaveAndRecurringUnavailability` migration

**Files:**
- Modify: `Odip.Domain/Entities/StaffAssignment.cs`
- Modify: `Odip.Infrastructure/Data/OdipDbContext.cs`
- Modify: `Odip.Infrastructure/Audit/AuditedEntities.cs`
- Create: `Odip.Infrastructure/Migrations/<timestamp>_AddStaffLeaveAndRecurringUnavailability.cs` + `.Designer.cs` (generated) + `OdipDbContextModelSnapshot.cs` (modified by the tool)

**Interfaces:**
- Produces: `db.LeaveRequests`, `db.RecurringUnavailabilities` DbSets; `StaffAssignment.OverrideReason`/`AcknowledgedFindingCodes` (string?, unused by any controller yet — PR 3 wires the gate); `LeaveRequest`/`RecurringUnavailability`/`StaffAvailability` registered in `AuditedEntities.Types`.

`dotnet-ef` is available globally (`dotnet tool list -g` confirms `dotnet-ef 10.0.5`), and `Odip.Infrastructure/Data/OdipDbContextFactory.cs` already exists (added by the caregiver-form migration) — no new design-time factory is needed. The preferred path below is generate via CLI, then hand-add the raw-SQL data step; this task also shows the exact expected generated shape (matching the most recent real migration, `AddCaregiverProfileSubmissions`) so the step is checkable without re-deriving EF's codegen conventions from scratch.

- [ ] **Step 1: `StaffAssignment` gains the two override fields**

```csharp
// Odip.Domain/Entities/StaffAssignment.cs — add after HasConflict:
    public bool HasConflict { get; set; }
    /// <summary>Why the coordinator accepted a Warning finding when creating/updating this trip assignment. Wired by PR 3 (StaffAssignmentsController); the column and property land now so the migration stays single and additive.</summary>
    public string? OverrideReason { get; set; }
    /// <summary>Comma-separated RosterFinding.Code values the coordinator acknowledged. Wired by PR 3.</summary>
    public string? AcknowledgedFindingCodes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
```

- [ ] **Step 2: `OdipDbContext` — DbSets**

In `OdipDbContext.cs`, next to the Rostering `DbSet`s (~line 96-99):

```csharp
    // Rostering (M4)
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<ShiftPattern> ShiftPatterns => Set<ShiftPattern>();
    public DbSet<StaffParticipantCompatibility> StaffParticipantCompatibilities => Set<StaffParticipantCompatibility>();
    public DbSet<ShiftNote> ShiftNotes => Set<ShiftNote>();
    /// <summary>Staff leave + recurring unavailability: see <see cref="Entities.User"/>-scoped <see cref="LeaveRequest"/>.</summary>
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<RecurringUnavailability> RecurringUnavailabilities => Set<RecurringUnavailability>();
```

- [ ] **Step 3: `OdipDbContext` — entity configuration**

After the `ShiftNote` block in `OnModelCreating` (~line 1097-1115+, right after the existing rostering entity configs):

```csharp
        // ── LeaveRequest ─────────────────────────────────────────
        modelBuilder.Entity<LeaveRequest>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Reason).HasMaxLength(2000);
            entity.Property(e => e.DecisionNote).HasMaxLength(2000);

            // Restrict: same idiom as Shift -> User — a staff member with leave history must not
            // be silently cascade-deleted out from under it.
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // Coordinator list filters by status/user; StaffUnavailabilityQuery filters by
            // user + status + date range.
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.StartDate, e.EndDate });
        });

        // ── RecurringUnavailability ──────────────────────────────
        modelBuilder.Entity<RecurringUnavailability>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.DecisionNote).HasMaxLength(2000);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => new { e.TenantId, e.UserId, e.Status });
        });

        // ── StaffAssignment override fields (PR 3 wires the gate; columns land now) ──
        modelBuilder.Entity<StaffAssignment>(entity =>
        {
            entity.Property(e => e.OverrideReason).HasMaxLength(2000);
            entity.Property(e => e.AcknowledgedFindingCodes).HasMaxLength(500);
        });
```

Then, alongside the existing Rostering tenant query filters block (~line 1476-1495):

```csharp
        modelBuilder.Entity<LeaveRequest>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<LeaveRequest>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<RecurringUnavailability>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<RecurringUnavailability>()
            .HasIndex(e => e.TenantId);
```

`StaffAssignment` is not `ITenantEntity` (it has no direct `TenantId` — tenant scope comes from its `TripInstance`/`User` FKs, unchanged by this PR), so it gets no new query filter, only the two property configs above.

- [ ] **Step 4: `AuditedEntities.Types`**

```csharp
// Odip.Infrastructure/Audit/AuditedEntities.cs — add inside the Types HashSet initializer,
// after the existing CaregiverProfileSubmission entry:
        typeof(CaregiverProfileSubmission),

        // Staff leave + recurring unavailability: a coordinator's approve/decline decision and
        // note, and every subsequent field change, must be recoverable — same reasoning as
        // Shift.OverrideReason above. StaffAvailability is added here too (it was conspicuously
        // absent before this feature, per the design spec's Context section): its remaining
        // Unavailable/Training/Preferred/Available rows now get history from this point forward,
        // even though the entity itself is otherwise unchanged by this PR.
        typeof(LeaveRequest),
        typeof(RecurringUnavailability),
        typeof(StaffAvailability),
    };
```

(`StaffAvailability` is in `Odip.Domain.Entities`, already `using`d at the top of this file; `LeaveRequest`/`RecurringUnavailability` are in `Odip.Domain.Rostering`, also already `using`d — this file's existing `using Odip.Domain.Rostering;` covers `Shift`/`ShiftPattern` already.)

- [ ] **Step 5: Build**

Run: `dotnet build`
Expected: 0 errors. (This also resolves the `RosteringControllerTests.cs` build break left over from Task 2's `StaffAvailability`→`UnavailabilityWindow` retype — no, it does not; that break is independent and is fixed in Task 5. If `dotnet build` still fails here, confirm every failure is confined to `Odip.Tests/Rostering/RosteringControllerTests.cs`, `Odip.Api/Controllers/RosteringController.cs`, and `Odip.Application/DTOs/RosteringDTOs.cs` — the three files Task 5 fixes — before proceeding; anything else is a real regression from this task.)

- [ ] **Step 6: Generate the migration**

```bash
POSTGRES_CONNECTION_STRING="Host=localhost;Database=odip_design;Username=x;Password=x" \
dotnet ef migrations add AddStaffLeaveAndRecurringUnavailability --project Odip.Infrastructure --startup-project Odip.Api
```

- [ ] **Step 7: Inspect the generated schema migration, then hand-add the data step**

Open the new `Odip.Infrastructure/Migrations/<timestamp>_AddStaffLeaveAndRecurringUnavailability.cs`. Confirm `Up()` contains two `CreateTable` calls (`LeaveRequests`, `RecurringUnavailabilities`) and two `AddColumn` calls against `StaffAssignments` (`OverrideReason`, `AcknowledgedFindingCodes`), matching this shape (column types confirmed against the real `AddRosteringSchema`/`AddCaregiverProfileSubmissions` migrations — `TimeOnly` → `"time without time zone"`, `DateOnly` → `"date"`, enum → `"integer"`, `Guid` → `"uuid"`):

```csharp
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddStaffLeaveAndRecurringUnavailability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OverrideReason",
                table: "StaffAssignments",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AcknowledgedFindingCodes",
                table: "StaffAssignments",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "LeaveRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaveType = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    DecisionNote = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeaveRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LeaveRequests_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RecurringUnavailabilities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DayOfWeek = table.Column<int>(type: "integer", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    EffectiveTo = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    DecisionNote = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecurringUnavailabilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecurringUnavailabilities_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_TenantId",
                table: "LeaveRequests",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_TenantId_StartDate_EndDate",
                table: "LeaveRequests",
                columns: new[] { "TenantId", "StartDate", "EndDate" });

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_TenantId_UserId_Status",
                table: "LeaveRequests",
                columns: new[] { "TenantId", "UserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_UserId",
                table: "LeaveRequests",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringUnavailabilities_TenantId",
                table: "RecurringUnavailabilities",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringUnavailabilities_TenantId_UserId_Status",
                table: "RecurringUnavailabilities",
                columns: new[] { "TenantId", "UserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_RecurringUnavailabilities_UserId",
                table: "RecurringUnavailabilities",
                column: "UserId");

            // ── Data step (hand-added, not generated): migrate legacy Leave-type
            // StaffAvailability rows into LeaveRequest, then delete the source rows. Approved
            // (LeaveStatus = 1), LeaveType.Other (3) — a coordinator-entered legacy row carries
            // no distinction finer than "leave", and Other is the correct bucket for that.
            // TenantId comes from the row's User (StaffAvailability itself is not tenant-scoped).
            // RequestedAt/RequestedByUserId are backfilled from the row itself (CreatedAt, UserId)
            // since there is no real "who requested this" data pre-migration — every legacy row
            // was coordinator-entered, so the staff member "requesting" their own past entry is
            // the closest available fact. AvailabilityType = 2 is Leave (Available=0, Unavailable=1,
            // Leave=2, Training=3, Preferred=4, Tentative=5 — Odip.Domain.Enums.AvailabilityType).
            migrationBuilder.Sql(
                """
                INSERT INTO "LeaveRequests"
                    ("Id", "TenantId", "UserId", "LeaveType", "StartDate", "EndDate", "Status",
                     "Reason", "RequestedByUserId", "RequestedAt", "DecidedByUserId", "DecidedAt",
                     "DecisionNote", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), u."TenantId", sa."UserId", 3,
                       sa."StartDateTime"::date, sa."EndDateTime"::date, 1,
                       sa."Notes", sa."UserId", sa."CreatedAt", NULL, NULL, NULL,
                       sa."CreatedAt", sa."UpdatedAt"
                FROM "StaffAvailabilities" sa
                JOIN "Users" u ON u."Id" = sa."UserId"
                WHERE sa."AvailabilityType" = 2;

                DELETE FROM "StaffAvailabilities" WHERE "AvailabilityType" = 2;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Data step reversal: re-create the StaffAvailability rows this migration deleted,
            // sourced from the LeaveRequest rows it just inserted. Identifying those rows needs
            // FOUR conditions, not three: LeaveType = 3/Other AND Status = 1/Approved (Up() always
            // writes both) AND DecidedByUserId IS NULL AND DecisionNote IS NULL. Status = 1 is
            // load-bearing — without it this filter also matches a staff member's own Pending
            // "Other" leave request submitted through PortalController.CreateMyLeaveRequest (Task
            // 8) after this migration ran, since a fresh portal submission carries the identical
            // LeaveType/DecidedByUserId/DecisionNote signature (Pending, undecided, no note) as a
            // migrated row. Without Status = 1, running this Down() against a database that has
            // taken real staff leave submissions since Up() ran would silently vacuum any such
            // pending request back into the legacy StaffAvailability table as a fabricated
            // historical Unavailable row, with no error. A real coordinator-entered Other leave
            // request via LeaveController also carries a DecidedByUserId (on-behalf entries land
            // Approved with the coordinator recorded as decider), so it is excluded by the
            // DecidedByUserId check regardless. This is still a best-effort reversal for local/dev
            // rollback, not a guarantee for a database that has taken live writes since — same
            // caveat as every other one-way data migration in this codebase (see
            // BackfillParticipantIntakeCompletedAt's Down()).
            migrationBuilder.Sql(
                """
                INSERT INTO "StaffAvailabilities"
                    ("Id", "UserId", "StartDateTime", "EndDateTime", "AvailabilityType",
                     "IsRecurring", "RecurrenceNotes", "Notes", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), "UserId", "StartDate"::timestamp, "EndDate"::timestamp, 2,
                       false, NULL, "Reason", "CreatedAt", "UpdatedAt"
                FROM "LeaveRequests"
                WHERE "LeaveType" = 3 AND "Status" = 1 AND "DecidedByUserId" IS NULL AND "DecisionNote" IS NULL;
                """);

            migrationBuilder.DropTable(name: "RecurringUnavailabilities");
            migrationBuilder.DropTable(name: "LeaveRequests");
            migrationBuilder.DropColumn(name: "AcknowledgedFindingCodes", table: "StaffAssignments");
            migrationBuilder.DropColumn(name: "OverrideReason", table: "StaffAssignments");
        }
    }
}
```

If the tool-generated file differs in index names or ordering, keep the tool's output — it is authoritative; this block is a checkable reference for the schema shape and is where the hand-added `migrationBuilder.Sql(...)` data step goes (append it as the last statement inside the generated `Up()`, and its reversal as the first statement inside `Down()`, before the generated `DropTable`/`DropColumn` calls).

- [ ] **Step 8: Confirm nothing else changed**

Run: `git status --short Odip.Infrastructure/Migrations/`
Expected: two new files (the migration + its `.Designer.cs`) and one modified file (`OdipDbContextModelSnapshot.cs`). Nothing else — if any other existing migration file shows as modified, stop and investigate before continuing; do not proceed with a migration history rewrite.

- [ ] **Step 9: Render and eyeball the SQL**

```bash
POSTGRES_CONNECTION_STRING="Host=localhost;Database=x;Username=x;Password=x" \
dotnet ef migrations script AddCaregiverProfileSubmissions AddStaffLeaveAndRecurringUnavailability --project Odip.Infrastructure --startup-project Odip.Api --no-build --idempotent
```

Confirm the two `CREATE TABLE` statements, the two `ALTER TABLE "StaffAssignments" ADD "..."` statements, and the `INSERT INTO "LeaveRequests" ... SELECT ... FROM "StaffAvailabilities"` / `DELETE FROM "StaffAvailabilities"` pair all appear, in that order (columns and data step after table creation).

- [ ] **Step 10: Build, full suite (the parts that compile), commit**

Run: `dotnet build`
Expected: 0 errors for everything except the `RosteringController`/`RosteringDTOs`/`RosteringControllerTests` trio still pending Task 5's fixes (see Step 5's note) — if unrelated files fail, stop.

```bash
git add Odip.Domain/Entities/StaffAssignment.cs Odip.Infrastructure/Data/OdipDbContext.cs Odip.Infrastructure/Audit/AuditedEntities.cs Odip.Infrastructure/Migrations/
git commit -m "feat(leave): OdipDbContext wiring + AddStaffLeaveAndRecurringUnavailability migration

Single additive migration: LeaveRequests + RecurringUnavailabilities tables,
StaffAssignments.OverrideReason/AcknowledgedFindingCodes columns, and a data
step migrating StaffAvailability's Leave-type rows into LeaveRequest before
deleting them. LeaveRequest/RecurringUnavailability/StaffAvailability added
to AuditedEntities.Types.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 4: `StaffUnavailabilityQuery`

**Files:**
- Create: `Odip.Infrastructure/Rostering/StaffUnavailabilityQuery.cs`
- Modify: `Odip.Api/Program.cs`
- Test: `Odip.Tests/Leave/StaffUnavailabilityQueryTests.cs`

**Interfaces:**
- Consumes: `Odip.Domain.Rostering.Services.UnavailabilityWindow`/`UnavailabilityKind` (Task 2), `LeaveRequest`/`RecurringUnavailability`/`RecurringUnavailabilityExpander` (Task 1), `Odip.Domain.Entities.StaffAvailability`/`Odip.Domain.Enums.AvailabilityType` (existing).
- Produces: `public interface IStaffUnavailabilityQuery { Task<IReadOnlyList<UnavailabilityWindow>> GetWindowsAsync(IReadOnlyList<Guid> userIds, DateOnly from, DateOnly to, CancellationToken ct); }`, DI-registered as scoped — the exact type Task 5 (`RosteringController`) and Task 7 (`LeaveController`'s approve overlap check, indirectly) consume.

- [ ] **Step 1: Write the failing tests**

```csharp
// Odip.Tests/Leave/StaffUnavailabilityQueryTests.cs
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Leave;

public class StaffUnavailabilityQueryTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedUser(OdipDbContext db)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task Approved_leave_produces_an_ApprovedLeave_window_spanning_the_whole_days()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 12),
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var window = Assert.Single(windows);
        Assert.Equal(UnavailabilityKind.ApprovedLeave, window.Kind);
        Assert.Equal(new DateOnly(2026, 9, 10).ToDateTime(TimeOnly.MinValue), window.Start);
        Assert.Equal(new DateOnly(2026, 9, 13).ToDateTime(TimeOnly.MinValue), window.End); // inclusive end-date, so the window runs to the START of the following day
    }

    [Fact]
    public async Task Pending_leave_produces_a_PendingLeave_window()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Sick,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 10),
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Equal(UnavailabilityKind.PendingLeave, Assert.Single(windows).Kind);
    }

    [Theory]
    [InlineData(LeaveStatus.Declined)]
    [InlineData(LeaveStatus.Cancelled)]
    public async Task Declined_or_cancelled_leave_produces_no_window(LeaveStatus status)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 10),
            Status = status, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task Approved_recurring_rule_expands_to_one_window_per_occurrence()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), Status = LeaveStatus.Approved,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.All(windows, w => Assert.Equal(UnavailabilityKind.RecurringRule, w.Kind));
        Assert.Equal(5, windows.Count); // 5 Wednesdays in Sept 2026
        var first = windows.OrderBy(w => w.Start).First();
        Assert.Equal(new DateTime(2026, 9, 2, 9, 0, 0), first.Start);
        Assert.Equal(new DateTime(2026, 9, 2, 12, 0, 0), first.End);
    }

    [Fact]
    public async Task Pending_recurring_rule_produces_no_window()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), Status = LeaveStatus.Pending,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Theory]
    [InlineData(AvailabilityType.Unavailable)]
    [InlineData(AvailabilityType.Training)]
    public async Task Legacy_unavailable_or_training_rows_produce_a_Legacy_window(AvailabilityType type)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, AvailabilityType = type, Notes = "Doctor's appointment",
            StartDateTime = new DateTime(2026, 9, 10, 8, 0, 0), EndDateTime = new DateTime(2026, 9, 10, 12, 0, 0),
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var window = Assert.Single(windows);
        Assert.Equal(UnavailabilityKind.Legacy, window.Kind);
        Assert.Equal(type, window.LegacySourceType);
        Assert.Equal("Doctor's appointment", window.LegacyNotes);
    }

    [Theory]
    [InlineData(AvailabilityType.Available)]
    [InlineData(AvailabilityType.Preferred)]
    [InlineData(AvailabilityType.Tentative)]
    public async Task Legacy_rows_of_other_types_produce_no_window(AvailabilityType type)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, AvailabilityType = type,
            StartDateTime = new DateTime(2026, 9, 10, 8, 0, 0), EndDateTime = new DateTime(2026, 9, 10, 12, 0, 0),
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task A_window_entirely_outside_the_requested_range_is_excluded()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 10, 1), EndDate = new DateOnly(2026, 10, 2),
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task Windows_from_a_user_not_in_the_requested_list_are_excluded()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var otherUser = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = otherUser.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 10),
            Status = LeaveStatus.Approved, RequestedByUserId = otherUser.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task Empty_userIds_list_short_circuits_to_no_query()
    {
        using var db = CreateDb();
        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(Array.Empty<Guid>(), new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task Unions_all_three_sources_at_once()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 5), EndDate = new DateOnly(2026, 9, 5),
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), EffectiveTo = new DateOnly(2026, 9, 2), Status = LeaveStatus.Approved,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, AvailabilityType = AvailabilityType.Training,
            StartDateTime = new DateTime(2026, 9, 20, 8, 0, 0), EndDateTime = new DateTime(2026, 9, 20, 12, 0, 0),
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Equal(3, windows.Count);
        Assert.Contains(windows, w => w.Kind == UnavailabilityKind.ApprovedLeave);
        Assert.Contains(windows, w => w.Kind == UnavailabilityKind.RecurringRule);
        Assert.Contains(windows, w => w.Kind == UnavailabilityKind.Legacy);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~StaffUnavailabilityQueryTests"`
Expected: build error — `Odip.Infrastructure.Rostering` namespace / `StaffUnavailabilityQuery` does not exist.

- [ ] **Step 3: Implement**

```csharp
// Odip.Infrastructure/Rostering/StaffUnavailabilityQuery.cs
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// The single source every unavailability-aware caller (RosteringController's board and shift
/// checks, LeaveController's approve-time overlap search, and PR 3's StaffAssignmentsController)
/// goes through, replacing the RosteringController.LeaveTypes / RosterConflictService.UnavailableTypes
/// duplicated constants this feature retires. Unions three sources into one tagged
/// UnavailabilityWindow list — see UnavailabilityKind (Odip.Domain.Rostering.Services) for why
/// the window shape itself lives in Domain rather than here.
/// </summary>
public interface IStaffUnavailabilityQuery
{
    /// <summary>
    /// Every unavailability window for any of <paramref name="userIds"/> overlapping
    /// [<paramref name="from"/>, <paramref name="to"/>] (inclusive both ends): Approved + Pending
    /// LeaveRequest rows (whole-day windows), Approved RecurringUnavailability rows (expanded via
    /// RecurringUnavailabilityExpander — a Pending rule yields nothing), and legacy
    /// StaffAvailability Unavailable/Training rows (Leave-type rows no longer exist post the
    /// AddStaffLeaveAndRecurringUnavailability migration's data step).
    /// </summary>
    Task<IReadOnlyList<UnavailabilityWindow>> GetWindowsAsync(
        IReadOnlyList<Guid> userIds, DateOnly from, DateOnly to, CancellationToken ct);
}

public sealed class StaffUnavailabilityQuery : IStaffUnavailabilityQuery
{
    private readonly OdipDbContext _db;
    private readonly RecurringUnavailabilityExpander _expander = new();

    public StaffUnavailabilityQuery(OdipDbContext db) => _db = db;

    public async Task<IReadOnlyList<UnavailabilityWindow>> GetWindowsAsync(
        IReadOnlyList<Guid> userIds, DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (userIds.Count == 0)
            return Array.Empty<UnavailabilityWindow>();

        var windows = new List<UnavailabilityWindow>();
        var rangeStart = from.ToDateTime(TimeOnly.MinValue);
        var rangeEndExclusive = to.AddDays(1).ToDateTime(TimeOnly.MinValue);

        // ── Leave: Approved + Pending, whole-day windows ──
        var leaveRequests = await _db.LeaveRequests
            .Where(l => userIds.Contains(l.UserId)
                        && (l.Status == LeaveStatus.Approved || l.Status == LeaveStatus.Pending))
            .ToListAsync(ct);
        foreach (var l in leaveRequests)
        {
            var start = l.StartDate.ToDateTime(TimeOnly.MinValue);
            var end = l.EndDate.AddDays(1).ToDateTime(TimeOnly.MinValue); // inclusive end date -> exclusive end-of-day
            if (start >= rangeEndExclusive || rangeStart >= end)
                continue;
            windows.Add(new UnavailabilityWindow(l.UserId, start, end,
                l.Status == LeaveStatus.Approved ? UnavailabilityKind.ApprovedLeave : UnavailabilityKind.PendingLeave));
        }

        // ── Recurring unavailability: Approved only, expanded to concrete occurrences ──
        var rules = await _db.RecurringUnavailabilities
            .Where(r => userIds.Contains(r.UserId) && r.Status == LeaveStatus.Approved)
            .ToListAsync(ct);
        foreach (var rule in rules)
        {
            foreach (var date in _expander.Occurrences(rule, from, to))
            {
                windows.Add(new UnavailabilityWindow(
                    rule.UserId, date.ToDateTime(rule.StartTime), date.ToDateTime(rule.EndTime),
                    UnavailabilityKind.RecurringRule));
            }
        }

        // ── Legacy StaffAvailability: Unavailable/Training rows only. Leave-type rows no longer
        // exist after the migration's data step; Available/Preferred/Tentative never counted as
        // unavailability (matches the retired RosterConflictService.UnavailableTypes set, minus
        // Leave, which is now sourced from LeaveRequest above instead). ──
        var legacy = await _db.StaffAvailabilities
            .Where(a => userIds.Contains(a.UserId)
                        && (a.AvailabilityType == AvailabilityType.Unavailable || a.AvailabilityType == AvailabilityType.Training)
                        && a.StartDateTime < rangeEndExclusive && a.EndDateTime > rangeStart)
            .ToListAsync(ct);
        foreach (var a in legacy)
            windows.Add(new UnavailabilityWindow(a.UserId, a.StartDateTime, a.EndDateTime, UnavailabilityKind.Legacy,
                LegacySourceType: a.AvailabilityType, LegacyNotes: a.Notes));

        return windows;
    }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `dotnet test --filter "FullyQualifiedName~StaffUnavailabilityQueryTests"`
Expected: `Passed: 13, Failed: 0`.

- [ ] **Step 5: DI registration**

```csharp
// Odip.Api/Program.cs — add next to the StaffCompatibilityLinkService registration (~line 171):
builder.Services.AddScoped<Odip.Infrastructure.Services.StaffCompatibilityLinkService>();
builder.Services.AddScoped<Odip.Infrastructure.Rostering.IStaffUnavailabilityQuery, Odip.Infrastructure.Rostering.StaffUnavailabilityQuery>();
```

- [ ] **Step 6: Build, full suite (parts that compile), commit**

Run: `dotnet build`
Expected: 0 errors outside the `RosteringController`/`RosteringDTOs`/`RosteringControllerTests` trio (fixed next, in Task 5).

```bash
git add Odip.Infrastructure/Rostering/StaffUnavailabilityQuery.cs Odip.Tests/Leave/StaffUnavailabilityQueryTests.cs Odip.Api/Program.cs
git commit -m "feat(leave): StaffUnavailabilityQuery unions leave, recurring rules, and legacy availability

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 5: `RosteringController` wiring — consume `StaffUnavailabilityQuery`, `RequiresReason` gate, `LeaveBarDto.Kind`

**Files:**
- Modify: `Odip.Application/DTOs/RosteringDTOs.cs`
- Modify: `Odip.Api/Controllers/RosteringController.cs`
- Modify: `Odip.Tests/Rostering/RosteringControllerTests.cs`

**Interfaces:**
- Consumes: `IStaffUnavailabilityQuery` (Task 4).
- Produces: `RosterFindingDto.RequiresReason` (bool); `LeaveBarDto { StartDate, EndDate, Kind, AvailabilityType?, Notes?, StartTime?, EndTime? }`.

**Ruling (orchestrator-directed) — `LeaveBarDto` keeps `AvailabilityType`/`Notes` (nullable) and gains `Kind` plus nullable `StartTime`/`EndTime`:** an earlier draft of this plan had `LeaveBarDto` drop `AvailabilityType`/`Notes` outright on the theory that `UnavailabilityWindow` couldn't supply them. The orchestrator rejected that: the frontend (PR 2) needs `AvailabilityType`/`Notes` preserved for a `Legacy` bar (so `LeaveBar.tsx` doesn't lose today's rendering for `Unavailable`/`Training` rows) and needs `StartTime`/`EndTime` added so a `RecurringRule` bar can be drawn as a partial-day bar rather than spanning the full day. Task 2's `UnavailabilityWindow` now carries the two extra `Legacy`-only fields (`LegacySourceType`/`LegacyNotes`) this requires; `StartTime`/`EndTime` need no `UnavailabilityWindow` change, since a `RecurringRule` window's `Start`/`End` already carry the occurrence's time-of-day directly. All four new/kept fields are populated only for the `Kind` they're relevant to and `null` otherwise (see Step 3's `myLeave` mapping) — never a value that could be misread as meaningful for a kind it doesn't apply to.

- [ ] **Step 1: `RosteringDTOs.cs` — `RosterFindingDto.RequiresReason`, `LeaveBarDto.Kind`**

```csharp
// Before:
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// After:
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;

namespace Odip.Application.DTOs;
```

```csharp
// Before:
public record RosterFindingDto
{
    public string Code { get; init; } = string.Empty;
    public RosterFindingSeverity Severity { get; init; }
    public string Message { get; init; } = string.Empty;
}

// After:
public record RosterFindingDto
{
    public string Code { get; init; } = string.Empty;
    public RosterFindingSeverity Severity { get; init; }
    public string Message { get; init; } = string.Empty;
    /// <summary>True when this finding demands a non-empty override reason before the write can save — see RosteringController.EvaluateFindings.</summary>
    public bool RequiresReason { get; init; }
}
```

```csharp
// Before:
public record LeaveBarDto
{
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public AvailabilityType AvailabilityType { get; init; }
    public string? Notes { get; init; }
}

// After:
/// <summary>
/// One bar on the roster board's staff-grouped view. Sourced from IStaffUnavailabilityQuery
/// (approved + pending leave, approved recurring occurrences, legacy StaffAvailability rows) —
/// see UnavailabilityKind for what Kind discriminates. AvailabilityType/Notes are populated only
/// for Kind == Legacy (the source StaffAvailability row's own values, carried through
/// UnavailabilityWindow.LegacySourceType/LegacyNotes); StartTime/EndTime are populated only for
/// Kind == RecurringRule (so the frontend can draw a partial-day bar instead of a full-day one).
/// Every field not relevant to a given row's Kind is left null, never a default/zero value that
/// could be misread as meaningful.
/// </summary>
public record LeaveBarDto
{
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public UnavailabilityKind Kind { get; init; }
    /// <summary>Legacy only — the source StaffAvailability row's AvailabilityType (Unavailable or Training).</summary>
    public AvailabilityType? AvailabilityType { get; init; }
    /// <summary>Legacy only — the source StaffAvailability row's free-text Notes.</summary>
    public string? Notes { get; init; }
    /// <summary>RecurringRule only — the occurrence's time-of-day start. Serialises the same way ShiftPatternDto.StartTime does (built-in System.Text.Json TimeOnly support, no custom converter).</summary>
    public TimeOnly? StartTime { get; init; }
    /// <summary>RecurringRule only — the occurrence's time-of-day end.</summary>
    public TimeOnly? EndTime { get; init; }
}
```

- [ ] **Step 2: `RosteringController` — inject `IStaffUnavailabilityQuery`, remove `LeaveTypes`**

```csharp
// Before:
public class RosteringController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly RosterConflictService _conflictService = new();
    private readonly ShiftPatternExpander _expander = new();
    private readonly StaffCompatibilityLinkService _compatLink;

    /// <summary>Availability types that render as a leave/unavailable bar on the board (matches <see cref="RosterConflictService"/>'s own STAFF_UNAVAILABLE set).</summary>
    private static readonly AvailabilityType[] LeaveTypes =
        { AvailabilityType.Unavailable, AvailabilityType.Leave, AvailabilityType.Training };

    public RosteringController(OdipDbContext db, StaffCompatibilityLinkService compatLink)
    {
        _db = db;
        _compatLink = compatLink;
    }

// After:
public class RosteringController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly RosterConflictService _conflictService = new();
    private readonly ShiftPatternExpander _expander = new();
    private readonly StaffCompatibilityLinkService _compatLink;
    private readonly IStaffUnavailabilityQuery _unavailabilityQuery;

    public RosteringController(OdipDbContext db, StaffCompatibilityLinkService compatLink, IStaffUnavailabilityQuery unavailabilityQuery)
    {
        _db = db;
        _compatLink = compatLink;
        _unavailabilityQuery = unavailabilityQuery;
    }
```

Add `using Odip.Infrastructure.Rostering;` to the top of the file (alongside the existing `using Odip.Infrastructure.Services;`).

- [ ] **Step 3: `GetBoard` — replace the raw `StaffAvailability` query with `_unavailabilityQuery`**

```csharp
// Before (lines ~98-102):
        var startDt = start.ToDateTime(TimeOnly.MinValue);
        var endDt = end.ToDateTime(TimeOnly.MaxValue);
        var weekAvailability = await _db.StaffAvailabilities
            .Where(a => staffIds.Contains(a.UserId) && a.StartDateTime < endDt && a.EndDateTime > startDt)
            .ToListAsync(ct);

// After:
        var weekWindows = await _unavailabilityQuery.GetWindowsAsync(staffIds, start, end, ct);
```

```csharp
// Before (inside FindingsFor, ~line 143):
            var availability = weekAvailability.Where(a => a.UserId == shift.UserId).ToList();

// After:
            var availability = weekWindows.Where(w => w.UserId == shift.UserId).ToList();
```

```csharp
// Before (staff-mode board rows, ~lines 254-260):
                var myLeave = weekAvailability
                    .Where(a => a.UserId == staff.Id && LeaveTypes.Contains(a.AvailabilityType))
                    .Select(a => new LeaveBarDto
                    {
                        StartDate = DateOnly.FromDateTime(a.StartDateTime), EndDate = DateOnly.FromDateTime(a.EndDateTime),
                        AvailabilityType = a.AvailabilityType, Notes = a.Notes
                    }).ToList();

// After:
                var myLeave = weekWindows
                    .Where(w => w.UserId == staff.Id)
                    .Select(w => new LeaveBarDto
                    {
                        StartDate = DateOnly.FromDateTime(w.Start), EndDate = DateOnly.FromDateTime(w.End), Kind = w.Kind,
                        AvailabilityType = w.Kind == UnavailabilityKind.Legacy ? w.LegacySourceType : null,
                        Notes = w.Kind == UnavailabilityKind.Legacy ? w.LegacyNotes : null,
                        StartTime = w.Kind == UnavailabilityKind.RecurringRule ? TimeOnly.FromDateTime(w.Start) : null,
                        EndTime = w.Kind == UnavailabilityKind.RecurringRule ? TimeOnly.FromDateTime(w.End) : null,
                    }).ToList();
```

- [ ] **Step 4: `CheckAsync` — replace the raw `StaffAvailability` query**

```csharp
// Before (~lines 761-765):
        var dayStart = candidate.ServiceDate.ToDateTime(TimeOnly.MinValue);
        var dayEnd = (candidate.EndsNextDay ? candidate.ServiceDate.AddDays(1) : candidate.ServiceDate).ToDateTime(TimeOnly.MaxValue);
        var availability = await _db.StaffAvailabilities
            .Where(a => a.UserId == candidate.UserId.Value && a.StartDateTime < dayEnd && a.EndDateTime > dayStart)
            .ToListAsync(ct);

// After:
        var toDate = candidate.EndsNextDay ? candidate.ServiceDate.AddDays(1) : candidate.ServiceDate;
        var availability = await _unavailabilityQuery.GetWindowsAsync(
            new[] { candidate.UserId.Value }, candidate.ServiceDate, toDate, ct);
```

- [ ] **Step 5: `ToFindingDto` — map `RequiresReason`**

```csharp
// Before:
    private static RosterFindingDto ToFindingDto(RosterFinding f) => new() { Code = f.Code, Severity = f.Severity, Message = f.Message };

// After:
    private static RosterFindingDto ToFindingDto(RosterFinding f) => new() { Code = f.Code, Severity = f.Severity, Message = f.Message, RequiresReason = f.RequiresReason };
```

- [ ] **Step 6: `EvaluateFindings` — gate on `RequiresReason` instead of "any Warning present"**

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

        if (string.IsNullOrWhiteSpace(overrideReason))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, "This shift has warnings that must be acknowledged with an override reason before it can be saved.");
        }

        return null;
    }

// After:
    /// <summary>
    /// The Blocking/RequiresReason/override gate every roster write runs through: any Blocking
    /// finding rejects the write regardless of <paramref name="overrideReason"/>; any finding
    /// with RequiresReason true needs a non-empty reason; a write whose findings are all
    /// RequiresReason == false may proceed with no reason at all (ApplyOverride still records
    /// their codes in AcknowledgedFindingCodes — see that method — so the board can show why a
    /// cell looks tentative without ever having asked for input). Returns the 422 response body
    /// to return, or null when the write may proceed.
    /// </summary>
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
```

`ApplyOverride` (a few lines below `EvaluateFindings`) is unchanged — it already sets `AcknowledgedFindingCodes` from every current finding's code whenever `findings.Count > 0`, regardless of whether a reason was required, and already tolerates `overrideReason` being null/empty when no reason was needed. Confirm this by reading it; do not edit it.

- [ ] **Step 7: Run to confirm the controller compiles, then fix `RosteringControllerTests.cs`'s 22 call sites**

Run: `dotnet build`
Expected: 0 errors in `RosteringController.cs`/`RosteringDTOs.cs`. `RosteringControllerTests.cs` still fails — every `new RosteringController(db, new StaffCompatibilityLinkService(db))` call is now missing the 3rd constructor argument.

```bash
sed -i 's/new StaffCompatibilityLinkService(db))/new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))/g' Odip.Tests/Rostering/RosteringControllerTests.cs
```

Add `using Odip.Infrastructure.Rostering;` to `RosteringControllerTests.cs`'s usings (alongside the existing `using Odip.Infrastructure.Services;`).

- [ ] **Step 8: Run to confirm the whole suite compiles and passes**

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0`. Every pre-existing `RosteringControllerTests` test (board, shift CRUD, pattern CRUD, compatibility) still passes unchanged — the sed edit only threaded a new constructor argument through, it did not change any test's assertions.

- [ ] **Step 9: Add board/gate tests for the new behaviour**

Append to `Odip.Tests/Rostering/RosteringControllerTests.cs` (reuse whatever seed helpers the file already has for `User`/`Participant`/`Shift`; add a small `SeedApprovedLeave`/`SeedPendingLeave` helper alongside them):

```csharp
    private static LeaveRequest SeedLeave(OdipDbContext db, Guid userId, LeaveStatus status, DateOnly? start = null, DateOnly? end = null)
    {
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual,
            StartDate = start ?? ServiceDate, EndDate = end ?? ServiceDate, Status = status,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        db.SaveChanges();
        return leave;
    }

    [Fact]
    public async Task CreateShift_AgainstApprovedLeave_RequiresAnOverrideReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Approved);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var withoutReason = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);
        Assert.IsType<UnprocessableEntityObjectResult>(withoutReason.Result);

        var withReason = await controller.CreateShift(
            CleanCreateDto(participant.Id, staff.Id, overrideReason: "Covering an urgent gap; staff member agreed to work despite approved leave."),
            CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(withReason.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.Contains("STAFF_ON_LEAVE", body.Data!.OverrideReason is null ? "" : "STAFF_ON_LEAVE"); // sanity: reason path succeeded
    }

    [Fact]
    public async Task CreateShift_AgainstPendingLeave_SavesWithNoReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Pending);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.Contains(body.Data!.Findings, f => f.Code == "STAFF_LEAVE_PENDING");
    }

    [Fact]
    public async Task CreateShift_WithOnlyReasonNotRequiredFindings_StillRecordsAcknowledgedFindingCodes()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        SeedLeave(db, staff.Id, LeaveStatus.Pending);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.CreateShift(CleanCreateDto(participant.Id, staff.Id), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var shift = await db.Shifts.SingleAsync();
        Assert.Contains("STAFF_LEAVE_PENDING", shift.AcknowledgedFindingCodes);
        Assert.Null(shift.OverrideReason);
    }

    [Fact]
    public async Task GetBoard_StaffMode_LeaveBarReflectsApprovedLeaveKind()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        SeedLeave(db, staff.Id, LeaveStatus.Approved);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);
        var row = body.Data!.StaffRows!.Single(r => r.StaffId == staff.Id);
        var bar = Assert.Single(row.Leave);
        Assert.Equal(UnavailabilityKind.ApprovedLeave, bar.Kind);
    }

    [Fact]
    public async Task GetBoard_StaffMode_LeaveBarPopulatesKindSpecificFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var legacyStaff = SeedStaff(db, firstName: "Cara");
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = legacyStaff.Id, AvailabilityType = AvailabilityType.Training,
            Notes = "First aid refresher", StartDateTime = ServiceDate.ToDateTime(new TimeOnly(9, 0)),
            EndDateTime = ServiceDate.ToDateTime(new TimeOnly(12, 0)),
        });
        var recurringStaff = SeedStaff(db, firstName: "Dev", lastName: "Patel");
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = recurringStaff.Id, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = ServiceDate,
            Status = LeaveStatus.Approved, RequestedByUserId = recurringStaff.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.GetBoard(ServiceDate, "staff", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(ok.Value);

        var legacyBar = Assert.Single(body.Data!.StaffRows!.Single(r => r.StaffId == legacyStaff.Id).Leave);
        Assert.Equal(UnavailabilityKind.Legacy, legacyBar.Kind);
        Assert.Equal(AvailabilityType.Training, legacyBar.AvailabilityType);
        Assert.Equal("First aid refresher", legacyBar.Notes);
        Assert.Null(legacyBar.StartTime);

        var recurringBar = Assert.Single(body.Data!.StaffRows!.Single(r => r.StaffId == recurringStaff.Id).Leave);
        Assert.Equal(UnavailabilityKind.RecurringRule, recurringBar.Kind);
        Assert.Equal(new TimeOnly(9, 0), recurringBar.StartTime);
        Assert.Equal(new TimeOnly(12, 0), recurringBar.EndTime);
        Assert.Null(recurringBar.AvailabilityType);
    }
```

Adjust `CleanCreateDto`'s call signature to whatever the existing helper actually accepts for `overrideReason` (it already has an `overrideReason` optional parameter per the file's own helper defined near the top — confirm before assuming the exact parameter name matches this snippet's `overrideReason:`).

- [ ] **Step 10: Run to confirm pass, full suite, commit**

Run: `dotnet test --filter "FullyQualifiedName~RosteringControllerTests"` → `Failed: 0`.
Run: `dotnet build && dotnet test` → 0 errors, `Failed: 0`.

```bash
git add Odip.Application/DTOs/RosteringDTOs.cs Odip.Api/Controllers/RosteringController.cs Odip.Tests/Rostering/RosteringControllerTests.cs
git commit -m "feat(rostering): RosteringController consumes StaffUnavailabilityQuery; RequiresReason gate

LeaveTypes constant removed. RosterFindingDto.RequiresReason; LeaveBarDto gains
Kind + nullable StartTime/EndTime, keeps AvailabilityType/Notes (now nullable).
EvaluateFindings now gates on RequiresReason instead of 'any Warning present.'

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 6: `LeaveDTOs.cs`

**Files:**
- Create: `Odip.Application/DTOs/LeaveDTOs.cs`

**Interfaces:**
- Produces every DTO `LeaveController` (Task 7) and `PortalController`'s new actions (Task 8) use. Field names are the wire contract for PR 2's frontend.

- [ ] **Step 1: Write the file**

```csharp
using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// LEAVE + RECURRING UNAVAILABILITY DTOs
// docs/specs/2026-09-07-staff-leave-unavailability-design.md §2
// leaveType/status/dayOfWeek serialise as string enum names ("Annual", "Pending", "Monday"),
// matching how RosteringDTOs.cs already renders its own enums (Program.cs's
// JsonStringEnumConverter, registered globally in AddJsonOptions).
// ══════════════════════════════════════════════════════════════

public record LeaveRequestDto
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string UserFullName { get; init; } = string.Empty;
    public LeaveType LeaveType { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public LeaveStatus Status { get; init; }
    public string? Reason { get; init; }
    public Guid RequestedByUserId { get; init; }
    public DateTime RequestedAt { get; init; }
    public Guid? DecidedByUserId { get; init; }
    public DateTime? DecidedAt { get; init; }
    public string? DecisionNote { get; init; }
}

public record CreateLeaveRequestDto
{
    public LeaveType LeaveType { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public string? Reason { get; init; }
    /// <summary>Ignored on the portal path (always the caller's own id). Required on POST /leave — 400 if missing.</summary>
    public Guid? UserId { get; init; }
}

public record LeaveDecisionDto
{
    /// <summary>Required (400 if blank) on decline. Unused on approve/cancel.</summary>
    public string? DecisionNote { get; init; }
}

public record RecurringUnavailabilityDto
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string UserFullName { get; init; } = string.Empty;
    public DayOfWeek DayOfWeek { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public DateOnly EffectiveFrom { get; init; }
    public DateOnly? EffectiveTo { get; init; }
    public string? Notes { get; init; }
    public LeaveStatus Status { get; init; }
    public Guid RequestedByUserId { get; init; }
    public DateTime RequestedAt { get; init; }
    public Guid? DecidedByUserId { get; init; }
    public DateTime? DecidedAt { get; init; }
    public string? DecisionNote { get; init; }
}

public record CreateRecurringUnavailabilityDto
{
    public DayOfWeek DayOfWeek { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public DateOnly EffectiveFrom { get; init; }
    public DateOnly? EffectiveTo { get; init; }
    public string? Notes { get; init; }
    /// <summary>Ignored on the portal path (always the caller's own id). Required on POST /leave/unavailability — 400 if missing.</summary>
    public Guid? UserId { get; init; }
}

/// <summary>POST /leave/{id}/approve response — the approved row plus any overlapping Published shifts/Confirmed trip assignments the coordinator should see before confirming. Approval itself is never blocked by these.</summary>
public record LeaveApprovalResultDto
{
    public LeaveRequestDto Leave { get; init; } = null!;
    public List<RosterFindingDto> Overlaps { get; init; } = new();
}

/// <summary>POST /leave/unavailability/{id}/approve response — same shape as <see cref="LeaveApprovalResultDto"/>.</summary>
public record RecurringUnavailabilityApprovalResultDto
{
    public RecurringUnavailabilityDto Unavailability { get; init; } = null!;
    public List<RosterFindingDto> Overlaps { get; init; } = new();
}

/// <summary>GET /portal/leave response.</summary>
public record PortalLeaveResponseDto
{
    public List<LeaveRequestDto> Leave { get; init; } = new();
    public List<RecurringUnavailabilityDto> Unavailability { get; init; } = new();
}
```

- [ ] **Step 2: Build, commit**

Run: `dotnet build` → 0 errors.

```bash
git add Odip.Application/DTOs/LeaveDTOs.cs
git commit -m "feat(leave): DTOs for the coordinator and portal leave/unavailability surfaces

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 7: `LeaveController` (coordinator surface — leave + recurring unavailability)

**Files:**
- Create: `Odip.Api/Controllers/LeaveController.cs`
- Test: `Odip.Tests/Leave/LeaveControllerTests.cs`

**Interfaces:**
- Consumes: `LeaveRequest`/`RecurringUnavailability`/`RecurringUnavailabilityExpander` (Task 1), `LeaveDTOs.cs` (Task 6).
- Produces: `api/v1/leave` — every route the spec's §2 coordinator table names.

**Ruling — coordinator-cancel vs. portal-cancel error wording:** the spec's error table gives one message for a staff self-withdraw on a non-Pending request ("Only pending requests can be withdrawn.") and a separate generic one for "approve/decline/cancel on an already-decided request" ("This request has already been decided."). Applying the state-transition matrix directly: a coordinator's cancel is valid from `Pending` *or* `Approved` (the matrix's own two "Coordinator (cancel)" cells) and 409s with the generic message from `Declined`/`Cancelled`; a portal cancel (Task 8) is valid from `Pending` only and 409s with the staff-specific wording from every other status. This task implements the coordinator half; Task 8 implements the portal half.

- [ ] **Step 1: Write the failing tests**

```csharp
// Odip.Tests/Leave/LeaveControllerTests.cs
using Microsoft.AspNetCore.Authorization;
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
using Xunit;

namespace Odip.Tests.Leave;

public class LeaveControllerTests
{
    private static readonly DateOnly Today = new(2026, 9, 7);

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static LeaveController MakeController(OdipDbContext db, Guid? callerId = null)
    {
        var identity = new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, (callerId ?? Guid.NewGuid()).ToString())], "Test");
        return new LeaveController(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(identity) }
            }
        };
    }

    private static User SeedUser(OdipDbContext db)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static LeaveRequest SeedLeave(OdipDbContext db, Guid userId, LeaveStatus status = LeaveStatus.Pending, DateOnly? start = null, DateOnly? end = null)
    {
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual,
            StartDate = start ?? Today, EndDate = end ?? Today, Status = status,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        db.SaveChanges();
        return leave;
    }

    private static RecurringUnavailability SeedRule(OdipDbContext db, Guid userId, LeaveStatus status = LeaveStatus.Pending) =>
        SeedRuleInternal(db, userId, status, new TimeOnly(9, 0), new TimeOnly(12, 0));

    private static RecurringUnavailability SeedRuleInternal(OdipDbContext db, Guid userId, LeaveStatus status, TimeOnly start, TimeOnly end)
    {
        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = userId, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = start, EndTime = end, EffectiveFrom = Today, Status = status,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        db.SaveChanges();
        return rule;
    }

    [Fact]
    public void Controller_is_gated_to_SuperAdmin_Admin_Coordinator()
    {
        var attr = typeof(LeaveController).GetCustomAttributes(typeof(AuthorizeAttribute), false)
            .Cast<AuthorizeAttribute>().Single();
        Assert.Equal("SuperAdmin,Admin,Coordinator", attr.Roles);
    }

    // ── Leave: create ──

    [Fact]
    public async Task CreateLeave_MissingUserId_Returns400()
    {
        using var db = CreateDb();
        var result = await MakeController(db).CreateLeave(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateLeave_EndBeforeStart_Returns400()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeController(db).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today.AddDays(-1) },
            CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateLeave_Duplicate_Returns409()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        SeedLeave(db, user.Id, LeaveStatus.Approved);
        var result = await MakeController(db).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateLeave_Valid_LandsApprovedWithRequesterAsDecider()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var callerId = Guid.NewGuid();
        var result = await MakeController(db, callerId).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today.AddDays(2) },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Approved, body.Data!.Status);
        Assert.Equal(callerId, body.Data.RequestedByUserId);
        Assert.Equal(callerId, body.Data.DecidedByUserId);
    }

    // ── Leave: approve/decline/cancel ──

    [Fact]
    public async Task ApproveLeave_UnknownId_Returns404()
    {
        using var db = CreateDb();
        var result = await MakeController(db).ApproveLeave(Guid.NewGuid(), CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task ApproveLeave_NotPending_Returns409()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, LeaveStatus.Approved);
        var result = await MakeController(db).ApproveLeave(leave.Id, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task ApproveLeave_ReturnsOverlappingPublishedShiftsAndConfirmedTrips()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, LeaveStatus.Pending, Today, Today.AddDays(2));
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = user.Id, ServiceDate = Today.AddDays(1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        });
        var trip = new TripInstance { Id = Guid.NewGuid(), TripCode = "T1", TripName = "Beach Trip", StartDate = Today, DurationDays = 3 };
        db.TripInstances.Add(trip);
        db.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = user.Id,
            AssignmentStart = Today, AssignmentEnd = Today.AddDays(2), Status = AssignmentStatus.Confirmed,
        });
        await db.SaveChangesAsync();

        var result = await MakeController(db).ApproveLeave(leave.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveApprovalResultDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Approved, body.Data!.Leave.Status);
        Assert.Contains(body.Data.Overlaps, o => o.Code == "SHIFT_OVERLAP");
        Assert.Contains(body.Data.Overlaps, o => o.Code == "TRIP_OVERLAP");
    }

    [Fact]
    public async Task DeclineLeave_NoNote_Returns400()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id);
        var result = await MakeController(db).DeclineLeave(leave.Id, new LeaveDecisionDto(), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task DeclineLeave_WithNote_SetsDeclinedAndNote()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id);
        var result = await MakeController(db).DeclineLeave(
            leave.Id, new LeaveDecisionDto { DecisionNote = "No cover available that week." }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Declined, body.Data!.Status);
        Assert.Equal("No cover available that week.", body.Data.DecisionNote);
    }

    [Theory]
    [InlineData(LeaveStatus.Pending)]
    [InlineData(LeaveStatus.Approved)]
    public async Task CancelLeave_FromPendingOrApproved_Succeeds(LeaveStatus status)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, status);
        var result = await MakeController(db).CancelLeave(leave.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Cancelled, body.Data!.Status);
    }

    [Theory]
    [InlineData(LeaveStatus.Declined)]
    [InlineData(LeaveStatus.Cancelled)]
    public async Task CancelLeave_FromDeclinedOrCancelled_Returns409(LeaveStatus status)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, status);
        var result = await MakeController(db).CancelLeave(leave.Id, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    // ── Leave: list filters ──

    [Fact]
    public async Task GetLeave_FiltersByStatusAndUserId()
    {
        using var db = CreateDb();
        var user1 = SeedUser(db);
        var user2 = SeedUser(db);
        SeedLeave(db, user1.Id, LeaveStatus.Pending);
        SeedLeave(db, user1.Id, LeaveStatus.Approved, Today.AddDays(10), Today.AddDays(10));
        SeedLeave(db, user2.Id, LeaveStatus.Pending);

        var result = await MakeController(db).GetLeave(LeaveStatus.Pending, user1.Id, null, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<LeaveRequestDto>>>(ok.Value);
        var row = Assert.Single(body.Data!);
        Assert.Equal(user1.Id, row.UserId);
        Assert.Equal(LeaveStatus.Pending, row.Status);
    }

    // ── Recurring unavailability: mirrors the leave tests above ──

    [Fact]
    public async Task CreateUnavailability_StartTimeNotBeforeEndTime_Returns400()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(9, 0), EffectiveFrom = Today },
            CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateUnavailability_EffectiveToBeforeEffectiveFrom_Returns400()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today, EffectiveTo = Today.AddDays(-1) },
            CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateUnavailability_Duplicate_Returns409()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        SeedRule(db, user.Id, LeaveStatus.Approved);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today },
            CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateUnavailability_Valid_LandsApproved()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Approved, body.Data!.Status);
    }

    [Fact]
    public async Task ApproveUnavailability_ReturnsOverlappingPublishedShift()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var rule = SeedRule(db, user.Id); // Wednesday 09:00-12:00, effective from Today
        var wednesday = Today.DayOfWeek == DayOfWeek.Wednesday ? Today : Today.AddDays(((int)DayOfWeek.Wednesday - (int)Today.DayOfWeek + 7) % 7);
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = user.Id, ServiceDate = wednesday,
            StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        });
        await db.SaveChangesAsync();

        var result = await MakeController(db).ApproveUnavailability(rule.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityApprovalResultDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Approved, body.Data!.Unavailability.Status);
        Assert.Contains(body.Data.Overlaps, o => o.Code == "SHIFT_OVERLAP");
    }

    [Fact]
    public async Task DeclineUnavailability_NoNote_Returns400()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var rule = SeedRule(db, user.Id);
        var result = await MakeController(db).DeclineUnavailability(rule.Id, new LeaveDecisionDto(), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Theory]
    [InlineData(LeaveStatus.Pending)]
    [InlineData(LeaveStatus.Approved)]
    public async Task CancelUnavailability_FromPendingOrApproved_Succeeds(LeaveStatus status)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var rule = SeedRule(db, user.Id, status);
        var result = await MakeController(db).CancelUnavailability(rule.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Cancelled, body.Data!.Status);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~LeaveControllerTests"`
Expected: build error — `LeaveController` does not exist.

- [ ] **Step 3: Implement**

```csharp
// Odip.Api/Controllers/LeaveController.cs
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Coordinator surface for staff leave and recurring unavailability: list, on-behalf entry
/// (lands Approved directly), and the approve/decline/cancel lifecycle. Gated to the same
/// tier as RosteringController — SuperAdmin/Admin/Coordinator — since this is coordinator work
/// with the same access-control shape (see that controller's own remarks on why the whole
/// controller, not just writes, is gated). Staff self-service lives on PortalController instead.
/// See docs/specs/2026-09-07-staff-leave-unavailability-design.md §2.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/leave")]
public class LeaveController : ControllerBase
{
    private readonly OdipDbContext _db;
    public LeaveController(OdipDbContext db) => _db = db;

    // ══════════════════════════════════════════════════════════════
    // LEAVE
    // ══════════════════════════════════════════════════════════════

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<LeaveRequestDto>>>> GetLeave(
        [FromQuery] LeaveStatus? status, [FromQuery] Guid? userId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var query = _db.LeaveRequests.Include(l => l.User).AsQueryable();
        if (status.HasValue) query = query.Where(l => l.Status == status.Value);
        if (userId.HasValue) query = query.Where(l => l.UserId == userId.Value);
        if (from.HasValue) query = query.Where(l => l.EndDate >= from.Value);
        if (to.HasValue) query = query.Where(l => l.StartDate <= to.Value);

        var rows = await query.OrderByDescending(l => l.RequestedAt).ToListAsync(ct);
        return Ok(ApiResponse<List<LeaveRequestDto>>.Ok(rows.Select(ToDto).ToList()));
    }

    /// <summary>On-behalf entry: lands Approved directly, with the coordinator recorded as both requester and decider — the initial state per the spec's state-transition matrix, not a transition.</summary>
    [HttpPost]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CreateLeave([FromBody] CreateLeaveRequestDto dto, CancellationToken ct)
    {
        if (dto.UserId is null)
            return BadRequest(ApiResponse<LeaveRequestDto>.Fail("A staff member is required."));
        var validationError = ValidateLeaveDates(dto.StartDate, dto.EndDate);
        if (validationError != null) return BadRequest(ApiResponse<LeaveRequestDto>.Fail(validationError));
        if (!await _db.Users.AnyAsync(u => u.Id == dto.UserId.Value && u.IsActive, ct))
            return BadRequest(ApiResponse<LeaveRequestDto>.Fail("Staff member not found."));
        if (await HasDuplicateLeaveAsync(dto.UserId.Value, dto.LeaveType, dto.StartDate, dto.EndDate, ct))
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("An identical request already exists."));

        var callerId = ResolveCallerId();
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = dto.UserId.Value, LeaveType = dto.LeaveType,
            StartDate = dto.StartDate, EndDate = dto.EndDate, Reason = dto.Reason,
            Status = LeaveStatus.Approved, RequestedByUserId = callerId, RequestedAt = DateTime.UtcNow,
            DecidedByUserId = callerId, DecidedAt = DateTime.UtcNow,
        };
        _db.LeaveRequests.Add(leave);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(await LoadLeaveDtoAsync(leave.Id, ct)));
    }

    [HttpPost("{id:guid}/approve")]
    public async Task<ActionResult<ApiResponse<LeaveApprovalResultDto>>> ApproveLeave(Guid id, CancellationToken ct)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveApprovalResultDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<LeaveApprovalResultDto>.Fail("This request has already been decided."));

        leave.Status = LeaveStatus.Approved;
        leave.DecidedByUserId = ResolveCallerId();
        leave.DecidedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var overlaps = await FindLeaveOverlapsAsync(leave.UserId, leave.StartDate, leave.EndDate, ct);
        return Ok(ApiResponse<LeaveApprovalResultDto>.Ok(new LeaveApprovalResultDto
        {
            Leave = await LoadLeaveDtoAsync(leave.Id, ct), Overlaps = overlaps,
        }));
    }

    [HttpPost("{id:guid}/decline")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> DeclineLeave(Guid id, [FromBody] LeaveDecisionDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.DecisionNote))
            return BadRequest(ApiResponse<LeaveRequestDto>.Fail("A decline reason is required."));

        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("This request has already been decided."));

        leave.Status = LeaveStatus.Declined;
        leave.DecidedByUserId = ResolveCallerId();
        leave.DecidedAt = DateTime.UtcNow;
        leave.DecisionNote = dto.DecisionNote.Trim();
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(await LoadLeaveDtoAsync(leave.Id, ct)));
    }

    /// <summary>Coordinator cancel: valid from Pending OR Approved (the matrix's two "Coordinator (cancel)" cells). See this task's ruling for why this differs from the portal cancel's error wording.</summary>
    [HttpPost("{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CancelLeave(Guid id, CancellationToken ct)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending && leave.Status != LeaveStatus.Approved)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("This request has already been decided."));

        leave.Status = LeaveStatus.Cancelled;
        leave.DecidedByUserId = ResolveCallerId();
        leave.DecidedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(await LoadLeaveDtoAsync(leave.Id, ct)));
    }

    // ══════════════════════════════════════════════════════════════
    // RECURRING UNAVAILABILITY (mirrors LEAVE above, same shape)
    // ══════════════════════════════════════════════════════════════

    [HttpGet("unavailability")]
    public async Task<ActionResult<ApiResponse<List<RecurringUnavailabilityDto>>>> GetUnavailability(
        [FromQuery] LeaveStatus? status, [FromQuery] Guid? userId, CancellationToken ct)
    {
        var query = _db.RecurringUnavailabilities.Include(r => r.User).AsQueryable();
        if (status.HasValue) query = query.Where(r => r.Status == status.Value);
        if (userId.HasValue) query = query.Where(r => r.UserId == userId.Value);

        var rows = await query.OrderByDescending(r => r.RequestedAt).ToListAsync(ct);
        return Ok(ApiResponse<List<RecurringUnavailabilityDto>>.Ok(rows.Select(ToDto).ToList()));
    }

    [HttpPost("unavailability")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CreateUnavailability(
        [FromBody] CreateRecurringUnavailabilityDto dto, CancellationToken ct)
    {
        if (dto.UserId is null)
            return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail("A staff member is required."));
        var validationError = ValidateRecurringWindow(dto.StartTime, dto.EndTime, dto.EffectiveFrom, dto.EffectiveTo);
        if (validationError != null) return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail(validationError));
        if (!await _db.Users.AnyAsync(u => u.Id == dto.UserId.Value && u.IsActive, ct))
            return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail("Staff member not found."));
        if (await HasDuplicateUnavailabilityAsync(dto.UserId.Value, dto.DayOfWeek, dto.StartTime, dto.EndTime, dto.EffectiveFrom, dto.EffectiveTo, ct))
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("An identical request already exists."));

        var callerId = ResolveCallerId();
        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = dto.UserId.Value, DayOfWeek = dto.DayOfWeek,
            StartTime = dto.StartTime, EndTime = dto.EndTime, EffectiveFrom = dto.EffectiveFrom,
            EffectiveTo = dto.EffectiveTo, Notes = dto.Notes,
            Status = LeaveStatus.Approved, RequestedByUserId = callerId, RequestedAt = DateTime.UtcNow,
            DecidedByUserId = callerId, DecidedAt = DateTime.UtcNow,
        };
        _db.RecurringUnavailabilities.Add(rule);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(await LoadUnavailabilityDtoAsync(rule.Id, ct)));
    }

    [HttpPost("unavailability/{id:guid}/approve")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityApprovalResultDto>>> ApproveUnavailability(Guid id, CancellationToken ct)
    {
        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail("This request has already been decided."));

        rule.Status = LeaveStatus.Approved;
        rule.DecidedByUserId = ResolveCallerId();
        rule.DecidedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var overlaps = await FindRecurringOverlapsAsync(rule, ct);
        return Ok(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Ok(new RecurringUnavailabilityApprovalResultDto
        {
            Unavailability = await LoadUnavailabilityDtoAsync(rule.Id, ct), Overlaps = overlaps,
        }));
    }

    [HttpPost("unavailability/{id:guid}/decline")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> DeclineUnavailability(
        Guid id, [FromBody] LeaveDecisionDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.DecisionNote))
            return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail("A decline reason is required."));

        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("This request has already been decided."));

        rule.Status = LeaveStatus.Declined;
        rule.DecidedByUserId = ResolveCallerId();
        rule.DecidedAt = DateTime.UtcNow;
        rule.DecisionNote = dto.DecisionNote.Trim();
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(await LoadUnavailabilityDtoAsync(rule.Id, ct)));
    }

    [HttpPost("unavailability/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CancelUnavailability(Guid id, CancellationToken ct)
    {
        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending && rule.Status != LeaveStatus.Approved)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("This request has already been decided."));

        rule.Status = LeaveStatus.Cancelled;
        rule.DecidedByUserId = ResolveCallerId();
        rule.DecidedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(await LoadUnavailabilityDtoAsync(rule.Id, ct)));
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    private Guid ResolveCallerId() =>
        Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : Guid.Empty;

    internal static string? ValidateLeaveDates(DateOnly start, DateOnly end) =>
        end < start ? "End date must be on or after the start date." : null;

    internal static string? ValidateRecurringWindow(TimeOnly start, TimeOnly end, DateOnly effectiveFrom, DateOnly? effectiveTo)
    {
        if (start >= end) return "Start time must be before end time.";
        if (effectiveTo.HasValue && effectiveTo.Value < effectiveFrom) return "Effective-to must be on or after effective-from.";
        return null;
    }

    private Task<bool> HasDuplicateLeaveAsync(Guid userId, LeaveType leaveType, DateOnly start, DateOnly end, CancellationToken ct) =>
        _db.LeaveRequests.AnyAsync(l =>
            l.UserId == userId && l.LeaveType == leaveType && l.StartDate == start && l.EndDate == end
            && l.Status != LeaveStatus.Cancelled, ct);

    private Task<bool> HasDuplicateUnavailabilityAsync(
        Guid userId, DayOfWeek dayOfWeek, TimeOnly start, TimeOnly end, DateOnly effectiveFrom, DateOnly? effectiveTo, CancellationToken ct) =>
        _db.RecurringUnavailabilities.AnyAsync(r =>
            r.UserId == userId && r.DayOfWeek == dayOfWeek && r.StartTime == start && r.EndTime == end
            && r.EffectiveFrom == effectiveFrom && r.EffectiveTo == effectiveTo
            && r.Status != LeaveStatus.Cancelled, ct);

    /// <summary>Overlapping Published shifts / Confirmed trip assignments for the just-approved leave window — informational only, approval is never blocked by this. See spec §3 "Reverse direction."</summary>
    private async Task<List<RosterFindingDto>> FindLeaveOverlapsAsync(Guid userId, DateOnly startDate, DateOnly endDate, CancellationToken ct)
    {
        var overlaps = new List<RosterFindingDto>();

        var shifts = await _db.Shifts
            .Where(s => s.UserId == userId && s.Status == ShiftStatus.Published
                        && s.ServiceDate >= startDate && s.ServiceDate <= endDate)
            .ToListAsync(ct);
        overlaps.AddRange(shifts.Select(s => new RosterFindingDto
        {
            Code = "SHIFT_OVERLAP", Severity = RosterFindingSeverity.Warning,
            Message = $"A published shift on {s.ServiceDate:d MMM yyyy} overlaps this leave.",
        }));

        var trips = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.UserId == userId && a.Status == AssignmentStatus.Confirmed
                        && a.AssignmentStart <= endDate && a.AssignmentEnd >= startDate)
            .ToListAsync(ct);
        overlaps.AddRange(trips.Select(a => new RosterFindingDto
        {
            Code = "TRIP_OVERLAP", Severity = RosterFindingSeverity.Warning,
            Message = $"A confirmed trip assignment ({a.TripInstance?.TripName}) overlaps this leave.",
        }));

        return overlaps;
    }

    /// <summary>
    /// Same idea as <see cref="FindLeaveOverlapsAsync"/> for a recurring rule: expands the rule
    /// over a bounded look-ahead (today..EffectiveTo, or today+84 days/12 weeks when open-ended —
    /// see this task's file-structure note; the spec does not bound this and an unbounded
    /// expansion is not safe for an indefinite rule) and checks each occurrence's date/time
    /// against Published shifts and Confirmed trip assignments.
    /// </summary>
    private async Task<List<RosterFindingDto>> FindRecurringOverlapsAsync(RecurringUnavailability rule, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var horizonStart = today > rule.EffectiveFrom ? today : rule.EffectiveFrom;
        var horizonEnd = rule.EffectiveTo ?? today.AddDays(84);
        var occurrences = new RecurringUnavailabilityExpander().Occurrences(rule, horizonStart, horizonEnd).ToHashSet();
        if (occurrences.Count == 0) return new List<RosterFindingDto>();

        var overlaps = new List<RosterFindingDto>();

        var shifts = await _db.Shifts
            .Where(s => s.UserId == rule.UserId && s.Status == ShiftStatus.Published
                        && s.ServiceDate >= horizonStart && s.ServiceDate <= horizonEnd
                        && s.StartTime < rule.EndTime && rule.StartTime < s.EndTime)
            .ToListAsync(ct);
        overlaps.AddRange(shifts.Where(s => occurrences.Contains(s.ServiceDate)).Select(s => new RosterFindingDto
        {
            Code = "SHIFT_OVERLAP", Severity = RosterFindingSeverity.Warning,
            Message = $"A published shift on {s.ServiceDate:d MMM yyyy} overlaps this recurring window.",
        }));

        var trips = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.UserId == rule.UserId && a.Status == AssignmentStatus.Confirmed
                        && a.AssignmentStart <= horizonEnd && a.AssignmentEnd >= horizonStart)
            .ToListAsync(ct);
        overlaps.AddRange(trips
            .Where(a => Enumerable.Range(0, a.AssignmentEnd.DayNumber - a.AssignmentStart.DayNumber + 1)
                .Select(offset => a.AssignmentStart.AddDays(offset))
                .Any(occurrences.Contains))
            .Select(a => new RosterFindingDto
            {
                Code = "TRIP_OVERLAP", Severity = RosterFindingSeverity.Warning,
                Message = $"A confirmed trip assignment ({a.TripInstance?.TripName}) overlaps this recurring window.",
            }));

        return overlaps;
    }

    private static LeaveRequestDto ToDto(LeaveRequest l) => new()
    {
        Id = l.Id, UserId = l.UserId, UserFullName = l.User?.FullName ?? string.Empty, LeaveType = l.LeaveType,
        StartDate = l.StartDate, EndDate = l.EndDate, Status = l.Status, Reason = l.Reason,
        RequestedByUserId = l.RequestedByUserId, RequestedAt = l.RequestedAt,
        DecidedByUserId = l.DecidedByUserId, DecidedAt = l.DecidedAt, DecisionNote = l.DecisionNote,
    };

    private static RecurringUnavailabilityDto ToDto(RecurringUnavailability r) => new()
    {
        Id = r.Id, UserId = r.UserId, UserFullName = r.User?.FullName ?? string.Empty, DayOfWeek = r.DayOfWeek,
        StartTime = r.StartTime, EndTime = r.EndTime, EffectiveFrom = r.EffectiveFrom, EffectiveTo = r.EffectiveTo,
        Notes = r.Notes, Status = r.Status, RequestedByUserId = r.RequestedByUserId, RequestedAt = r.RequestedAt,
        DecidedByUserId = r.DecidedByUserId, DecidedAt = r.DecidedAt, DecisionNote = r.DecisionNote,
    };

    private async Task<LeaveRequestDto> LoadLeaveDtoAsync(Guid id, CancellationToken ct) =>
        ToDto(await _db.LeaveRequests.Include(l => l.User).FirstAsync(l => l.Id == id, ct));

    private async Task<RecurringUnavailabilityDto> LoadUnavailabilityDtoAsync(Guid id, CancellationToken ct) =>
        ToDto(await _db.RecurringUnavailabilities.Include(r => r.User).FirstAsync(r => r.Id == id, ct));
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `dotnet test --filter "FullyQualifiedName~LeaveControllerTests"`
Expected: `Passed: 20, Failed: 0`.

- [ ] **Step 5: Build, full suite, commit**

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0`.

```bash
git add Odip.Api/Controllers/LeaveController.cs Odip.Tests/Leave/LeaveControllerTests.cs
git commit -m "feat(leave): LeaveController — coordinator leave + recurring unavailability lifecycle

GET/POST list/create/approve/decline/cancel for both LeaveRequest and
RecurringUnavailability, mirroring the state-transition matrix from
docs/specs/2026-09-07-staff-leave-unavailability-design.md.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 8: `PortalController` — staff self-service leave/unavailability

**Files:**
- Modify: `Odip.Api/Controllers/PortalController.cs`
- Test: `Odip.Tests/Portal/PortalLeaveTests.cs`

**Interfaces:**
- Consumes: `ResolveCurrentStaffIdAsync` (existing private helper, `PortalController.cs:409`); `LeaveDTOs.cs` (Task 6); `LeaveRequest`/`RecurringUnavailability` (Task 1).
- Produces: `GET /portal/leave`, `POST /portal/leave`, `POST /portal/leave/{id}/cancel`, `POST /portal/unavailability`, `POST /portal/unavailability/{id}/cancel` — every route the spec's §2 portal table names.

- [ ] **Step 1: Write the failing tests**

```csharp
// Odip.Tests/Portal/PortalLeaveTests.cs
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
using Xunit;

namespace Odip.Tests.Portal;

public class PortalLeaveTests
{
    private static readonly DateOnly Today = new(2026, 9, 7);

    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid? viewAsUserId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        tenant.Setup(t => t.ViewAsUserId).Returns(viewAsUserId);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static PortalController MakeController(OdipDbContext db, ICurrentTenant tenant, Guid callerUserId)
    {
        var identity = new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
        return new PortalController(db, tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(identity) }
            }
        };
    }

    private static User SeedUser(OdipDbContext db, string firstName = "Ben", string lastName = "Turner")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = firstName, LastName = lastName, Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task PostLeave_Valid_LandsPendingWithSelfAsRequester()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today.AddDays(1) },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Pending, body.Data!.Status);
        Assert.Equal(user.Id, body.Data.UserId);
        Assert.Equal(user.Id, body.Data.RequestedByUserId);
        Assert.Null(body.Data.DecidedByUserId);
    }

    [Fact]
    public async Task PostLeave_IgnoresAnySuppliedUserId_AlwaysUsesTheCaller()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var someoneElse = SeedUser(db, "Amy", "Ng");
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today, UserId = someoneElse.Id },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(user.Id, body.Data!.UserId);
    }

    [Fact]
    public async Task PostLeave_EndBeforeStart_Returns400()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today.AddDays(-1) },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task PostLeave_Duplicate_Returns409()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task CancelMyLeave_OwnPendingRequest_Succeeds()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyLeaveRequest(leave.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Cancelled, body.Data!.Status);
    }

    [Fact]
    public async Task CancelMyLeave_AnotherUsersRequest_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var someoneElse = SeedUser(db, "Amy", "Ng");
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = someoneElse.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = someoneElse.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyLeaveRequest(leave.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var reloaded = await db.LeaveRequests.SingleAsync(l => l.Id == leave.Id);
        Assert.Equal(LeaveStatus.Pending, reloaded.Status); // never mutated
    }

    [Fact]
    public async Task CancelMyLeave_AlreadyApproved_Returns409WithWithdrawWording()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyLeaveRequest(leave.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(conflict.Value);
        Assert.Contains("Only pending requests can be withdrawn.", body.Errors!);
    }

    [Fact]
    public async Task GetMyLeave_ReturnsOnlyTheCallersOwnLeaveAndUnavailability()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var someoneElse = SeedUser(db, "Amy", "Ng");
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = someoneElse.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = someoneElse.Id, RequestedAt = DateTime.UtcNow,
        });
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(12, 0), EffectiveFrom = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.GetMyLeave(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalLeaveResponseDto>>(ok.Value);
        var leaveRow = Assert.Single(body.Data!.Leave);
        Assert.Equal(user.Id, leaveRow.UserId);
        Assert.Single(body.Data.Unavailability);
    }

    [Fact]
    public async Task PostUnavailability_StartTimeNotBeforeEndTime_Returns400()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyUnavailability(
            new CreateRecurringUnavailabilityDto { DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(9, 0), EffectiveFrom = Today },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CancelMyUnavailability_OwnPendingRule_Succeeds()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(12, 0), EffectiveFrom = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyUnavailability(rule.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Cancelled, body.Data!.Status);
    }

    [Fact]
    public async Task CancelMyUnavailability_UnknownId_Returns404()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyUnavailability(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~PortalLeaveTests"`
Expected: build error — `PortalController` has no `GetMyLeave`/`CreateMyLeaveRequest`/`CancelMyLeaveRequest`/`CreateMyUnavailability`/`CancelMyUnavailability` members.

- [ ] **Step 3: Implement**

Insert into `Odip.Api/Controllers/PortalController.cs`, immediately before the `// HELPERS` banner (`PortalController.cs:398`, right after the closing brace of the last witness action):

```csharp
    // ══════════════════════════════════════════════════════════════
    // LEAVE + RECURRING UNAVAILABILITY (staff self-service)
    // ══════════════════════════════════════════════════════════════

    /// <summary>The caller's own leave requests and recurring unavailability rules, every status — the staff member's submission history, not just pending ones.</summary>
    [HttpGet("leave")]
    public async Task<ActionResult<ApiResponse<PortalLeaveResponseDto>>> GetMyLeave(CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return Ok(ApiResponse<PortalLeaveResponseDto>.Ok(new PortalLeaveResponseDto()));

        var leave = await _db.LeaveRequests.Include(l => l.User)
            .Where(l => l.UserId == staffId.Value).OrderByDescending(l => l.RequestedAt).ToListAsync(ct);
        var unavailability = await _db.RecurringUnavailabilities.Include(r => r.User)
            .Where(r => r.UserId == staffId.Value).OrderByDescending(r => r.RequestedAt).ToListAsync(ct);

        return Ok(ApiResponse<PortalLeaveResponseDto>.Ok(new PortalLeaveResponseDto
        {
            Leave = leave.Select(ToLeaveDto).ToList(),
            Unavailability = unavailability.Select(ToUnavailabilityDto).ToList(),
        }));
    }

    /// <summary>Any supplied <see cref="CreateLeaveRequestDto.UserId"/> is ignored — always the caller's own id. Lands Pending — the initial state, not the on-behalf shortcut LeaveController's coordinator-side POST /leave uses.</summary>
    [HttpPost("leave")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CreateMyLeaveRequest([FromBody] CreateLeaveRequestDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Staff record not found."));

        var validationError = dto.EndDate < dto.StartDate ? "End date must be on or after the start date." : null;
        if (validationError != null) return BadRequest(ApiResponse<LeaveRequestDto>.Fail(validationError));

        var duplicate = await _db.LeaveRequests.AnyAsync(l =>
            l.UserId == staffId.Value && l.LeaveType == dto.LeaveType && l.StartDate == dto.StartDate
            && l.EndDate == dto.EndDate && l.Status != LeaveStatus.Cancelled, ct);
        if (duplicate) return Conflict(ApiResponse<LeaveRequestDto>.Fail("An identical request already exists."));

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staffId.Value, LeaveType = dto.LeaveType,
            StartDate = dto.StartDate, EndDate = dto.EndDate, Reason = dto.Reason,
            Status = LeaveStatus.Pending, RequestedByUserId = staffId.Value, RequestedAt = DateTime.UtcNow,
        };
        _db.LeaveRequests.Add(leave);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(leave).Reference(l => l.User).LoadAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(ToLeaveDto(leave)));
    }

    /// <summary>Withdraw the caller's own leave request. 404 (never 403) if the id doesn't exist or belongs to someone else — same idiom as every other portal read/write.</summary>
    [HttpPost("leave/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CancelMyLeaveRequest(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));

        var leave = await _db.LeaveRequests.Include(l => l.User)
            .FirstOrDefaultAsync(l => l.Id == id && l.UserId == staffId.Value, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("Only pending requests can be withdrawn."));

        leave.Status = LeaveStatus.Cancelled;
        leave.DecidedByUserId = staffId.Value;
        leave.DecidedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(ToLeaveDto(leave)));
    }

    [HttpPost("unavailability")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CreateMyUnavailability(
        [FromBody] CreateRecurringUnavailabilityDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Staff record not found."));

        if (dto.StartTime >= dto.EndTime)
            return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail("Start time must be before end time."));
        if (dto.EffectiveTo.HasValue && dto.EffectiveTo.Value < dto.EffectiveFrom)
            return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail("Effective-to must be on or after effective-from."));

        var duplicate = await _db.RecurringUnavailabilities.AnyAsync(r =>
            r.UserId == staffId.Value && r.DayOfWeek == dto.DayOfWeek && r.StartTime == dto.StartTime
            && r.EndTime == dto.EndTime && r.EffectiveFrom == dto.EffectiveFrom && r.EffectiveTo == dto.EffectiveTo
            && r.Status != LeaveStatus.Cancelled, ct);
        if (duplicate) return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("An identical request already exists."));

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staffId.Value, DayOfWeek = dto.DayOfWeek,
            StartTime = dto.StartTime, EndTime = dto.EndTime, EffectiveFrom = dto.EffectiveFrom,
            EffectiveTo = dto.EffectiveTo, Notes = dto.Notes,
            Status = LeaveStatus.Pending, RequestedByUserId = staffId.Value, RequestedAt = DateTime.UtcNow,
        };
        _db.RecurringUnavailabilities.Add(rule);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(rule).Reference(r => r.User).LoadAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(ToUnavailabilityDto(rule)));
    }

    [HttpPost("unavailability/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CancelMyUnavailability(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));

        var rule = await _db.RecurringUnavailabilities.Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Id == id && r.UserId == staffId.Value, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("Only pending requests can be withdrawn."));

        rule.Status = LeaveStatus.Cancelled;
        rule.DecidedByUserId = staffId.Value;
        rule.DecidedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(ToUnavailabilityDto(rule)));
    }
```

And two small mapping helpers alongside the file's existing `private static ... To...Dto(...)` helpers (e.g. next to `ToSummaryDto`):

```csharp
    private static LeaveRequestDto ToLeaveDto(LeaveRequest l) => new()
    {
        Id = l.Id, UserId = l.UserId, UserFullName = l.User?.FullName ?? string.Empty, LeaveType = l.LeaveType,
        StartDate = l.StartDate, EndDate = l.EndDate, Status = l.Status, Reason = l.Reason,
        RequestedByUserId = l.RequestedByUserId, RequestedAt = l.RequestedAt,
        DecidedByUserId = l.DecidedByUserId, DecidedAt = l.DecidedAt, DecisionNote = l.DecisionNote,
    };

    private static RecurringUnavailabilityDto ToUnavailabilityDto(RecurringUnavailability r) => new()
    {
        Id = r.Id, UserId = r.UserId, UserFullName = r.User?.FullName ?? string.Empty, DayOfWeek = r.DayOfWeek,
        StartTime = r.StartTime, EndTime = r.EndTime, EffectiveFrom = r.EffectiveFrom, EffectiveTo = r.EffectiveTo,
        Notes = r.Notes, Status = r.Status, RequestedByUserId = r.RequestedByUserId, RequestedAt = r.RequestedAt,
        DecidedByUserId = r.DecidedByUserId, DecidedAt = r.DecidedAt, DecisionNote = r.DecisionNote,
    };
```

(These duplicate `LeaveController`'s own `ToDto` overloads rather than sharing them — matches the codebase's existing precedent of small per-controller mapping/validation helpers, e.g. `IsValidStaffRefAsync` duplicated across `StaffAvailabilityController`/`StaffAssignmentsController`, rather than introducing a shared service the spec doesn't call for.)

- [ ] **Step 4: Run to confirm pass**

Run: `dotnet test --filter "FullyQualifiedName~PortalLeaveTests"`
Expected: `Passed: 12, Failed: 0`.

- [ ] **Step 5: Build, full suite, commit**

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0`.

```bash
git add Odip.Api/Controllers/PortalController.cs Odip.Tests/Portal/PortalLeaveTests.cs
git commit -m "feat(leave): portal self-service leave + recurring unavailability actions

GET/POST /portal/leave, POST /portal/leave/{id}/cancel, POST
/portal/unavailability, POST /portal/unavailability/{id}/cancel — 404
(never 403) on any id not belonging to the caller, matching every other
PortalController action.

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Task 9: `LeaveAuditTests` + full-suite verification

**Files:**
- Create: `Odip.Tests/Leave/LeaveAuditTests.cs`

**Interfaces:**
- Consumes: `AuditInterceptor`, `AuditLog`, `AuditAction` (existing) — copies the `Odip.Tests/Rostering/RosteringAuditTests.cs` scaffold exactly (EF InMemory + `AuditInterceptor` attached via `AddInterceptors` + a `ClaimsPrincipal`-bearing `IHttpContextAccessor`).

- [ ] **Step 1: Write the failing tests**

```csharp
// Odip.Tests/Leave/LeaveAuditTests.cs
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Leave;

/// <summary>
/// Confirms LeaveRequest/RecurringUnavailability/StaffAvailability — all three added to
/// AuditedEntities.Types this feature (Task 3) — actually produce AuditLog rows via
/// AuditInterceptor, in particular that a coordinator's decline note and a staff member's
/// withdrawal are recoverable from the audit trail. Mirrors
/// Odip.Tests/Rostering/RosteringAuditTests.cs's scaffold exactly.
/// </summary>
public class LeaveAuditTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly Today = new(2026, 9, 7);

    private static OdipDbContext CreateDb(Guid actingUserId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, actingUserId.ToString()),
                new Claim("fullName", "Jane Coordinator")
            ],
            "Test");
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static User NewStaff() => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Ben", LastName = "Turner",
        Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    };

    [Fact]
    public async Task CreateLeaveRequest_WritesCreatedAuditLog()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = Today, EndDate = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(LeaveRequest)).ToList());
        Assert.Equal(leave.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
        Assert.Equal("Jane Coordinator", log.ChangedByName);
    }

    [Fact]
    public async Task DeclineLeaveRequest_WritesAuditLogWithTheDecisionNote()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = Today, EndDate = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();

        leave.Status = LeaveStatus.Declined;
        leave.DecidedByUserId = actingUserId;
        leave.DecidedAt = DateTime.UtcNow;
        leave.DecisionNote = "No cover available that week.";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(LeaveRequest) && a.EntityId == leave.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("DecisionNote", updateLog.Changes);
        Assert.Contains("No cover available that week.", updateLog.Changes);
        Assert.Contains("Status", updateLog.Changes);
    }

    [Fact]
    public async Task CreateRecurringUnavailability_WritesCreatedAuditLog()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = staff.Id, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(RecurringUnavailability)).ToList());
        Assert.Equal(rule.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
    }

    [Fact]
    public async Task ApproveRecurringUnavailability_WritesAuditLogWithStatusChange()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = staff.Id, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        await db.SaveChangesAsync();

        rule.Status = LeaveStatus.Approved;
        rule.DecidedByUserId = actingUserId;
        rule.DecidedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(RecurringUnavailability) && a.EntityId == rule.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("Status", updateLog.Changes);
    }

    [Fact]
    public async Task CreateStaffAvailability_NowWritesCreatedAuditLog()
    {
        // StaffAvailability was conspicuously absent from AuditedEntities.Types before this
        // feature (see the spec's Context section) — Task 3 adds it. This proves the remaining
        // Unavailable/Training/Preferred/Available rows get history from this point forward,
        // even though the entity itself is otherwise untouched by this PR.
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var availability = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, AvailabilityType = AvailabilityType.Unavailable,
            StartDateTime = Today.ToDateTime(new TimeOnly(8, 0)), EndDateTime = Today.ToDateTime(new TimeOnly(12, 0)),
        };
        db.StaffAvailabilities.Add(availability);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(StaffAvailability)).ToList());
        Assert.Equal(availability.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~LeaveAuditTests"`
Expected: build error before Task 3 lands (`db.LeaveRequests`/`db.RecurringUnavailabilities` don't exist yet) — since Task 3 has already run by this point in the plan, expect instead every assertion to fail with an empty `AuditLogs` set (the entities aren't yet in `AuditedEntities.Types`) if this task were run before Task 3's Step 4; run this task's tests only after confirming Task 3 is committed.

- [ ] **Step 3: Run to confirm pass**

Run: `dotnet test --filter "FullyQualifiedName~LeaveAuditTests"`
Expected: `Passed: 5, Failed: 0`.

- [ ] **Step 4: Full-suite regression run**

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0`. This is the final task in the plan — every prior task's tests, plus these, all pass together in one run.

- [ ] **Step 5: Commit**

```bash
git add Odip.Tests/Leave/LeaveAuditTests.cs
git commit -m "test(leave): audit coverage for LeaveRequest, RecurringUnavailability, StaffAvailability

Co-Authored-By: Claude Code <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH"
```

---

## Self-review

**1. Spec coverage — requirement → task:**

| Spec requirement | Task |
|---|---|
| §1 `LeaveType`/`LeaveStatus` enums, `LeaveRequest`/`RecurringUnavailability` entities | Task 1 |
| §1 `RecurringUnavailabilityExpander` | Task 1 |
| §1 Both entities + `StaffAvailability` in `AuditedEntities.Types` | Task 3 |
| §1 `StaffAvailability`'s `Leave` rows migrated into `LeaveRequest`, source rows deleted | Task 3 (migration data step) |
| §1 One additive migration | Task 3 |
| §1 Enums plain int-backed | Task 1 (no `HasConversion`) |
| §2 `LeaveDTOs.cs`, all DTOs from the spec table incl. nullable `userId` on the two create DTOs | Task 6 |
| §2 Portal endpoints: `GET/POST /portal/leave`, `POST /portal/leave/{id}/cancel`, `POST /portal/unavailability`, `POST /portal/unavailability/{id}/cancel` | Task 8 |
| §2 Coordinator endpoints: `GET/POST /leave`, approve/decline/cancel, and the `unavailability/...` mirror set | Task 7 |
| §2 Validation rules (date ordering, time ordering, effective-range ordering, duplicate detection) | Tasks 7 + 8 |
| §2 `permissions.ts`/`PageKey` additions, pending-count badge | Out of scope (PR 2) |
| §3 `IStaffUnavailabilityQuery`/`StaffUnavailabilityQuery`, DI-registered | Task 4 |
| §3 `UnavailabilityKind`/`UnavailabilityWindow` | Task 2 (relocated to Domain — see that task's ruling) |
| §3 `RosterFinding.RequiresReason` | Task 2 |
| §3 3 new finding codes, discriminated correctly (Approved requires reason, Pending doesn't, only Approved recurring rules feed a code at all) | Task 2 |
| §3 `RosterConflictService` consumes `UnavailabilityWindow`s; duplicated `LeaveTypes`/`UnavailableTypes` constants removed | Tasks 2 + 5 |
| §3 `EvaluateFindings` gate: Blocking refuses; `RequiresReason` findings need a reason; codes always recorded | Task 5 |
| §3 Trip-side `StaffAssignment.OverrideReason`/`AcknowledgedFindingCodes` columns (gate itself is PR 3) | Task 3 |
| §3 `RosterCheckContext` tolerating a null `Participant` | NOT done — see gap list below |
| §3 Reverse-direction overlap query on approve, for both leave and recurring unavailability | Task 7 |
| §4 `LeaveBarDto` gains `Kind` | Task 5 |
| §4 Roster board leave bars sourced from `StaffUnavailabilityQuery` | Task 5 |
| §4 Frontend UI (`PortalLeavePage`, `LeaveApprovalsPage`, `LeaveBar.tsx` rendering, `AvailabilityEditor.tsx` dropdown change) | Out of scope (PR 2) |
| Error-handling table: every row | Tasks 7 + 8 |
| State-transition matrix | Tasks 7 + 8 |
| Testing section: `RecurringUnavailabilityExpanderTests`, `StaffUnavailabilityQueryTests`, `RosterConflictServiceTests` extended, `LeaveControllerTests`/`PortalLeaveTests`, `StaffAssignmentGateTests`, `LeaveAuditTests` | Tasks 1, 4, 2, 7, 8, — (`StaffAssignmentGateTests` is PR 3, see gap list), 9 |

**2. Rulings made where the spec was silent or self-contradictory:**

- Ruling: `UnavailabilityWindow`/`UnavailabilityKind` are defined in `Odip.Domain/Rostering/Services/UnavailabilityWindow.cs`, not `Odip.Infrastructure/Rostering/StaffUnavailabilityQuery.cs` as the spec's file list literally states — `RosterConflictService` (Domain, zero project references) must consume `UnavailabilityWindow` per spec §3, and Domain cannot depend on Infrastructure. See Task 2.
- Ruling: `STAFF_ON_LEAVE`'s finding message drops the specific `LeaveType` the spec's template shows in parentheses — `UnavailabilityWindow`'s fixed 4-field shape (the spec's own record) carries no `LeaveType`, and `RosterConflictService` is deliberately I/O-free. See Task 2.
- Ruling (orchestrator-directed): `LeaveBarDto` keeps `AvailabilityType`/`Notes` (both now nullable) and gains `Kind` plus nullable `StartTime`/`EndTime` — an earlier draft of this plan had it drop `AvailabilityType`/`Notes` outright, which the orchestrator rejected as losing information the frontend (PR 2) needs to keep rendering a `Legacy` bar the way it does today, and to draw a `RecurringRule` bar as partial-day rather than full-day. `UnavailabilityWindow` (Task 2) gained two optional `Legacy`-only fields, `LegacySourceType`/`LegacyNotes`, to carry the first pair through; `StartTime`/`EndTime` need no `UnavailabilityWindow` change since a `RecurringRule` window's `Start`/`End` already carry the occurrence's time-of-day. See Tasks 2 and 5.
- Ruling: `RosterCheckContext`'s `Participant` stays non-nullable in this PR — the spec's own text explicitly permits deferring this to PR 3 if not cheap ("otherwise state it as PR 3 work"), and making it nullable is not cheap: `CheckCompatibility`, `CheckCompetencyMissing`, and `CheckRatioShortfall` all dereference `ctx.Participant` directly, and which participant-scoped rules should silently no-op for a null participant is a PR 3 (trip-side) design decision, not a PR 1 one. Task 2.
- Ruling: coordinator-cancel (`LeaveController`, Task 7) and portal-cancel (`PortalController`, Task 8) use different 409 wording, derived directly from combining the spec's state-transition matrix (coordinator can cancel from Pending or Approved) with its error table (a distinct staff-facing "withdrawn" message). Documented in Task 7.
- Ruling: recurring-unavailability approve-time overlap search (`FindRecurringOverlapsAsync`, Task 7) uses a 12-week look-ahead when `EffectiveTo` is null — the spec does not bound this, and an unbounded expansion of an indefinite rule is unsafe.
- Ruling: pending-count support (per the shared brief) is the existing `GET /leave?status=Pending` list, unchanged — no separate count endpoint was added; the coordinator-side list response is not large enough to justify one.
- Ruling: `LeaveController`/`PortalController` duplicate their own small validation/mapping helpers (`ValidateLeaveDates`, `ToDto`/`ToLeaveDto`, etc.) rather than sharing a service — matches the codebase's existing precedent (`IsValidStaffRefAsync` duplicated across `StaffAvailabilityController`/`StaffAssignmentsController`) rather than introducing a shared abstraction the spec doesn't call for.
- Ruling: the reverse-direction overlap response (spec §3, `POST /leave/{id}/approve` and `POST /leave/unavailability/{id}/approve`) uses two ad-hoc wire codes, `"SHIFT_OVERLAP"` and `"TRIP_OVERLAP"`, that are NOT `RosterConflictService` constants — they're literal strings local to `LeaveController.FindLeaveOverlapsAsync`/`FindRecurringOverlapsAsync` (Task 7), since the spec only says "return them as `overlaps: RosterFindingDto[]`" without naming codes and these findings never go through `RosterConflictService.Check`. Both approve paths return them: `ApproveLeave` calls `FindLeaveOverlapsAsync` (overlapping Published shifts + Confirmed trip assignments in the leave's date range), and `ApproveUnavailability` calls `FindRecurringOverlapsAsync` (the same two sources, matched against the rule's expanded occurrences) — see Task 7. PR 2's approvals UI matches against these two literal strings.

**3. Spec requirements this plan could NOT map to a task, and why:**

- **`RosterCheckContext` tolerating a null `Participant`** (spec §3): explicitly deferred to PR 3 per the ruling above and the spec's own permission to do so.
- **`StaffAssignmentGateTests`** (spec's Testing section): tests `StaffAssignmentsController`'s create/update gate, which is entirely PR 3 scope (`POST /staff-assignments/check`, the controller gate itself, `HasConflict` derivation) — the brief's "Out of scope for this plan" section explicitly excludes this controller. Only the two new columns it will eventually populate (`StaffAssignment.OverrideReason`/`AcknowledgedFindingCodes`) land in this PR, via Task 3's migration.
- **Frontend**: every UI surface (§4, the two new pages, `LeaveBar.tsx`, `permissions.ts`, sidebar badge) is PR 2/PR 3 per the spec's own Delivery section and the shared brief's scope line ("Any frontend file" is explicitly out of scope for this plan).
- **Notifications**: explicitly out of scope in the spec itself ("Out of scope / explicitly deferred") — no task needed.

