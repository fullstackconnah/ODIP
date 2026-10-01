using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// Routine ticks, persisted: <c>POST portal/shifts/{id}/routines/{routineId}/check</c> and <c>DELETE .../check</c> on the caller's OWN InProgress
/// shift, for a routine the shift window matched. A tick used to be local state in the browser; it now lives on the active completion, is
/// audited, comes back in the shift detail and shows in the coordinator's review. Fixture: Tue 14 July 2026, shift 09:00-17:00 Sydney, clock 11:00.
/// </summary>
public class PortalRoutineChecksTests
{
    private static readonly DateTime LunchAt = new(2026, 7, 14, 12, 0, 0, DateTimeKind.Unspecified);

    private static ParticipantRoutine AddRoutine(
        ShiftPackageFixture f, string title, string? start, string? end, bool critical = false, bool active = true, Guid? participantId = null,
        Guid? tenantId = null, ParticipantRoutineDays days = ParticipantRoutineDays.All)
    {
        var routine = new ParticipantRoutine
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? f.Worker.TenantId, ParticipantId = participantId ?? f.Participant.Id, Title = title, Description = "Details",
            Days = days, IsCritical = critical, IsActive = active,
            StartTime = start is null ? null : TimeOnly.Parse(start), EndTime = end is null ? null : TimeOnly.Parse(end),
        };
        f.Db.ParticipantRoutines.Add(routine);
        f.Db.SaveChanges();
        return routine;
    }

    private static ApiResponse<PortalShiftDetailDto> Body(ActionResult<ApiResponse<PortalShiftDetailDto>> r) =>
        Assert.IsType<ApiResponse<PortalShiftDetailDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value);

    private static int Status(ActionResult<ApiResponse<PortalShiftDetailDto>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode!.Value;

    // ── ticking ──

    [Fact]
    public async Task Check_PersistsTheTick_AndTheDetailShowsWhoAndWhen()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");

        var detail = Detail(await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default));

        var routine = Assert.Single(detail.ShiftRoutines);
        Assert.True(routine.IsChecked);
        Assert.Equal("Ben Turner", routine.CheckedByName);
        Assert.Equal(f.Clock.GetUtcNow().UtcDateTime, routine.CheckedAt);
        Assert.Equal(DateTimeKind.Utc, routine.CheckedAt!.Value.Kind);
        var row = await f.Db.ShiftRoutineChecks.SingleAsync();
        Assert.Equal(f.Completion!.Id, row.ShiftCompletionId);
        Assert.Equal(lunch.Id, row.ParticipantRoutineId);
        Assert.Equal(LunchAt, row.ScheduledAt);   // the occurrence the routine matched, provider-local
        Assert.Equal(f.Worker.Id, row.CheckedByUserId);
        // It survives a fresh read of the shift (a reload no longer loses it).
        Assert.True(Assert.Single(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).ShiftRoutines).IsChecked);
    }

    [Fact]
    public async Task AnUntickedRoutine_ReadsAsNotChecked_WithExplicitNullWhoAndWhen()
    {
        var f = Create();
        AddRoutine(f, "Lunch", "12:00", "13:00");

        var routine = Assert.Single(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).ShiftRoutines);

        Assert.False(routine.IsChecked);
        Assert.Null(routine.CheckedAt);
        Assert.Null(routine.CheckedByName);
    }

    [Fact]
    public async Task Check_IsIdempotent_TickingAgainKeepsTheFirstWhoAndWhen()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        var first = Assert.Single(Detail(await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default)).ShiftRoutines).CheckedAt;

        f.Advance(TimeSpan.FromMinutes(30));
        var second = Detail(await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default));

        Assert.Equal(first, Assert.Single(second.ShiftRoutines).CheckedAt);
        Assert.Single(await f.Db.ShiftRoutineChecks.ToListAsync());
    }

    [Fact]
    public async Task Uncheck_RemovesTheTick_AndUnticking_WhatIsNotTicked_IsAnIdempotentNoOp()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);

        var unticked = Detail(await f.Controller.UncheckRoutine(f.Shift.Id, lunch.Id, default));
        var again = Detail(await f.Controller.UncheckRoutine(f.Shift.Id, lunch.Id, default));

        Assert.False(Assert.Single(unticked.ShiftRoutines).IsChecked);
        Assert.False(Assert.Single(again.ShiftRoutines).IsChecked);
        Assert.Empty(await f.Db.ShiftRoutineChecks.ToListAsync());
    }

    [Fact]
    public async Task AnUntimedCriticalRoutine_CanBeTicked_ItsOccurrenceIsNull_AndTheTickIsStillUnique()
    {
        var f = Create();
        var allergyCheck = AddRoutine(f, "Allergy check before any food", null, null, critical: true);

        await f.Controller.CheckRoutine(f.Shift.Id, allergyCheck.Id, default);
        await f.Controller.CheckRoutine(f.Shift.Id, allergyCheck.Id, default);

        var row = await f.Db.ShiftRoutineChecks.SingleAsync();   // NULL ScheduledAt does not let a second tick in
        Assert.Null(row.ScheduledAt);
        Assert.True(Assert.Single(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).ShiftRoutines).IsChecked);
    }

    [Fact]
    public async Task AnAfterMidnightRoutine_OnAnOvernightShift_IsTickedAtItsOwnOccurrence()
    {
        var f = Create(endsNextDay: true, start: new TimeOnly(22, 0), end: new TimeOnly(6, 0));
        var nightCheck = AddRoutine(f, "Night check", "02:00", "02:30");

        var detail = Detail(await f.Controller.CheckRoutine(f.Shift.Id, nightCheck.Id, default));

        Assert.True(Assert.Single(detail.ShiftRoutines).IsChecked);
        Assert.Equal(new DateTime(2026, 7, 15, 2, 0, 0), (await f.Db.ShiftRoutineChecks.SingleAsync()).ScheduledAt);
    }

    [Fact]
    public async Task Ticking_OneRoutine_DoesNotTickAnother()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        AddRoutine(f, "Afternoon walk", "13:30", "14:30");

        var detail = Detail(await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default));

        Assert.Equal(["Lunch"], detail.ShiftRoutines.Where(r => r.IsChecked).Select(r => r.Title));
        Assert.Equal(["Afternoon walk"], detail.ShiftRoutines.Where(r => !r.IsChecked).Select(r => r.Title));
    }

    // ── scoping ──

    [Theory]
    [InlineData(ShiftStatus.Published, ShiftErrorCodes.ShiftNotInProgress)]
    [InlineData(ShiftStatus.PendingReview, ShiftErrorCodes.ShiftAlreadyFinished)]
    [InlineData(ShiftStatus.Completed, ShiftErrorCodes.ShiftAlreadyCompleted)]
    [InlineData(ShiftStatus.Cancelled, ShiftErrorCodes.ShiftCancelled)]
    [InlineData(ShiftStatus.Draft, ShiftErrorCodes.ShiftNotPublished)]
    public async Task OnlyWhileTheShiftIsInProgress_BothTickAndUntick_Are409(ShiftStatus status, string code)
    {
        var f = Create(status);
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");

        var tick = await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);
        var untick = await f.Controller.UncheckRoutine(f.Shift.Id, lunch.Id, default);

        Assert.Equal(409, Status(tick));
        Assert.Equal(code, Body(tick).Code);
        Assert.Equal(409, Status(untick));
        Assert.Empty(await f.Db.ShiftRoutineChecks.ToListAsync());
    }

    [Fact]
    public async Task AnotherWorkersShift_Is404_ForTickAndUntick()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        var stranger = f.ControllerFor(f.AddWorker().Id);

        Assert.Equal(404, Status(await stranger.CheckRoutine(f.Shift.Id, lunch.Id, default)));
        Assert.Equal(404, Status(await stranger.UncheckRoutine(f.Shift.Id, lunch.Id, default)));
        Assert.Empty(await f.Db.ShiftRoutineChecks.ToListAsync());
    }

    [Fact]
    public async Task ARoutineThatIsNotInTheShiftsWindow_Is404RoutineNotFound()
    {
        var f = Create();
        var evening = AddRoutine(f, "Dinner", "18:00", "19:00");                       // after the 09:00-17:00 shift
        var inactive = AddRoutine(f, "Retired", "12:00", "13:00", active: false);
        var otherParticipant = new Participant { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, FirstName = "Mia", LastName = "Chen", IsActive = true };
        f.Db.Participants.Add(otherParticipant);
        f.Db.SaveChanges();
        var foreign = AddRoutine(f, "Someone else's lunch", "12:00", "13:00", participantId: otherParticipant.Id);

        foreach (var routineId in new[] { evening.Id, inactive.Id, foreign.Id, Guid.NewGuid() })
        {
            var result = await f.Controller.CheckRoutine(f.Shift.Id, routineId, default);
            Assert.Equal(404, Status(result));
            Assert.Equal(ShiftErrorCodes.ShiftRoutineNotFound, Body(result).Code);
        }
        Assert.Empty(await f.Db.ShiftRoutineChecks.ToListAsync());
    }

    [Fact]
    public async Task ARoutineOwnedByAnotherTenant_Is404_TheTenantFilterHidesIt()
    {
        var tenantA = Guid.NewGuid();
        var f = Create(tenantId: tenantA);
        var foreign = AddRoutine(f, "Lunch", "12:00", "13:00", tenantId: Guid.NewGuid());   // same participant id, another tenant's row

        var result = await f.Controller.CheckRoutine(f.Shift.Id, foreign.Id, default);

        Assert.Equal(404, Status(result));
        Assert.Equal(ShiftErrorCodes.ShiftRoutineNotFound, Body(result).Code);
        Assert.Empty(await f.Db.ShiftRoutineChecks.IgnoreQueryFilters().ToListAsync());
    }

    // ── history, audit, review ──

    [Fact]
    public async Task TheTicksBelongToTheActiveCompletion_AReturnedShiftStartsAfresh()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);

        // A Return archives the completion; the resubmitting worker has a NEW active one.
        f.Completion!.IsActive = false;
        f.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = f.Shift.Id, ActualStart = ActualStartUtc, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = f.Worker.Id, StartedAt = ActualStartUtc, IsActive = true,
        });
        f.Db.SaveChanges();

        Assert.False(Assert.Single(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).ShiftRoutines).IsChecked);
        Assert.Single(await f.Db.ShiftRoutineChecks.ToListAsync());   // the archived completion keeps its history
    }

    [Fact]
    public async Task TicksAndUnticksAreAudited()
    {
        var f = Create(withAuditing: true);
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);
        var tickId = (await f.Db.ShiftRoutineChecks.SingleAsync()).Id;
        await f.Controller.UncheckRoutine(f.Shift.Id, lunch.Id, default);

        var actions = await f.Db.AuditLogs.Where(a => a.EntityType == nameof(ShiftRoutineCheck) && a.EntityId == tickId).Select(a => a.Action).ToListAsync();

        Assert.Contains(AuditAction.Created, actions);
        Assert.Contains(AuditAction.Deleted, actions);
        Assert.Contains(typeof(ShiftRoutineCheck), AuditedEntities.Types);
    }

    [Fact]
    public async Task TheDetailAfterFinish_StillShowsTheTicks_ForTheWorkersOwnSummary()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);
        f.Db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = f.Shift.Id, AuthorUserId = f.Worker.Id, AuthorName = "Ben", Body = "ok" });
        f.Db.SaveChanges();

        var finished = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default));

        Assert.Equal(ShiftStatus.PendingReview, finished.Status);
        Assert.True(Assert.Single(finished.ShiftRoutines).IsChecked);
    }
}
