using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
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

    // ── a tick is found by routine whatever is edited afterwards, and its snapshot outlives the routine (review 3 finding m3) ──

    private static async Task<ShiftCompletionReviewDto> ReviewOf(ShiftPackageFixture f)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test");
        var rostering = new RosteringController(f.Db, new StaffCompatibilityLinkService(f.Db), new StaffUnavailabilityQuery(f.Db))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
        var result = await rostering.GetShiftCompletionReview(f.Shift.Id, default);
        return Assert.IsType<ApiResponse<ShiftCompletionReviewDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    [Fact]
    public async Task TheTick_StoresASnapshot_TheRoutinesTitleAndTheOccurrenceItMatched()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");

        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);

        var row = await f.Db.ShiftRoutineChecks.SingleAsync();
        Assert.Equal("Lunch", row.RoutineTitle);
        Assert.Equal(LunchAt, row.ScheduledAt);
    }

    [Fact]
    public async Task EditingTheRoutinesTime_AfterItWasTicked_DoesNotHideTheTick_AndTickingAgainMakesNoSecondRow()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);
        var firstCheckedAt = (await f.Db.ShiftRoutineChecks.SingleAsync()).CheckedAt;
        f.Advance(TimeSpan.FromMinutes(20));

        // A coordinator moves lunch to 12:30 (still inside the shift) while the shift is running. The stored occurrence (12:00) no longer equals the
        // recomputed one (12:30): the tick used to read as NOT done, and ticking again created a second row.
        lunch.StartTime = new TimeOnly(12, 30);
        lunch.EndTime = new TimeOnly(13, 30);
        f.Db.SaveChanges();

        var detail = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));
        var review = await ReviewOf(f);
        var again = Detail(await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default));

        var routine = Assert.Single(detail.ShiftRoutines);
        Assert.True(routine.IsChecked);
        Assert.Equal(new DateTime(2026, 7, 14, 12, 30, 0), routine.OccursAt);   // the live definition, as before
        var reviewed = Assert.Single(review.Routines);
        Assert.True(reviewed.IsChecked);
        Assert.False(reviewed.FromTickSnapshot);   // it still applies in the window, so it is a normal row
        Assert.True(Assert.Single(again.ShiftRoutines).IsChecked);
        var row = Assert.Single(await f.Db.ShiftRoutineChecks.ToListAsync());   // still ONE row, with the first who and when
        Assert.Equal(firstCheckedAt, row.CheckedAt);
        Assert.Equal(LunchAt, row.ScheduledAt);
    }

    [Fact]
    public async Task UntickingAfterTheRoutinesTimeWasEdited_StillRemovesTheTick()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);
        lunch.StartTime = new TimeOnly(12, 30);
        lunch.EndTime = new TimeOnly(13, 30);
        f.Db.SaveChanges();

        var unticked = Detail(await f.Controller.UncheckRoutine(f.Shift.Id, lunch.Id, default));

        Assert.False(Assert.Single(unticked.ShiftRoutines).IsChecked);
        Assert.Empty(await f.Db.ShiftRoutineChecks.ToListAsync());
    }

    [Fact]
    public async Task ARoutineEditedOutOfTheWindow_AfterItWasTicked_IsStillOnTheReview_FromItsSnapshot_AndNotOnTheWorkersList()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00", critical: true);
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);
        // Moved to 20:00 (after the shift ends) and renamed.
        lunch.StartTime = new TimeOnly(20, 0);
        lunch.EndTime = new TimeOnly(21, 0);
        lunch.Title = "Evening snack";
        f.Db.SaveChanges();

        var detail = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));
        var review = await ReviewOf(f);

        Assert.Empty(detail.ShiftRoutines);   // the worker's list is the live definitions only
        var row = Assert.Single(review.Routines);
        Assert.True(row.FromTickSnapshot);
        Assert.True(row.IsChecked);
        Assert.Equal("Lunch", row.Title);   // as it was when ticked, not "Evening snack"
        Assert.Equal(LunchAt, row.OccursAt);
        Assert.Equal("Ben Turner", row.CheckedByName);
        Assert.True(row.IsCritical);   // the critical flag and the category come from the routine row, which still exists
        Assert.Equal(lunch.Id, row.Id);
    }

    [Fact]
    public async Task ADeletedRoutine_IsRetired_SoItsTicksSurviveOnTheCompletion_AndTheReviewStillListsThem()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);

        var delete = await new ParticipantRoutinesController(f.Db).Delete(lunch.Id, default);

        Assert.IsType<OkObjectResult>(delete.Result);
        Assert.False((await f.Db.ParticipantRoutines.SingleAsync(r => r.Id == lunch.Id)).IsActive);   // retired, not removed
        Assert.Single(await f.Db.ShiftRoutineChecks.ToListAsync());                                    // the tick survived
        Assert.Empty(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).ShiftRoutines);    // a retired routine is in no shift window
        var row = Assert.Single((await ReviewOf(f)).Routines);
        Assert.True(row.FromTickSnapshot);
        Assert.Equal("Lunch", row.Title);
        Assert.True(row.IsChecked);
    }

    [Fact]
    public async Task ATickRecordedWithNoSnapshotTitle_FallsBackToTheRoutinesCurrentTitle_OnTheReview()
    {
        var f = Create();
        var retired = AddRoutine(f, "Old title", "12:00", "13:00", active: false);
        f.Db.ShiftRoutineChecks.Add(new ShiftRoutineCheck
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftCompletionId = f.Completion!.Id, ParticipantRoutineId = retired.Id, ScheduledAt = LunchAt,
            CheckedByUserId = f.Worker.Id, CheckedAt = f.Clock.GetUtcNow().UtcDateTime, RoutineTitle = null,
        });
        f.Db.SaveChanges();

        var row = Assert.Single((await ReviewOf(f)).Routines);

        Assert.True(row.FromTickSnapshot);
        Assert.Equal("Old title", row.Title);
    }

    [Fact]
    public async Task TheReviewListsTheLiveRoutinesFirst_ThenTheTicksFromSnapshots_AndAnUntickedLiveRoutineStaysNotDone()
    {
        var f = Create();
        var lunch = AddRoutine(f, "Lunch", "12:00", "13:00");
        var walk = AddRoutine(f, "Afternoon walk", "14:00", "15:00");
        var breakfast = AddRoutine(f, "Breakfast", "09:30", "10:00");
        await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default);
        await f.Controller.CheckRoutine(f.Shift.Id, breakfast.Id, default);
        await new ParticipantRoutinesController(f.Db).Delete(breakfast.Id, default);   // retired after it was ticked

        var routines = (await ReviewOf(f)).Routines;

        Assert.Equal(["Lunch", "Afternoon walk", "Breakfast"], routines.Select(r => r.Title));
        Assert.Equal([false, false, true], routines.Select(r => r.FromTickSnapshot));
        Assert.Equal([true, false, true], routines.Select(r => r.IsChecked));   // the coordinator still sees what was NOT ticked
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
