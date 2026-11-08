using System.Security.Claims;
using Microsoft.AspNetCore.Http;
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
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>GA PR3 W1-W3: a worker's own row on a group activity, started and finished live. Each write's test checks what was saved, and that a refusal saved nothing.</summary>
public class GroupActivityWorkPortalTests
{
    private sealed class Clock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    // The activity day is 2026-11-16; 12:00 UTC is after 10:00 local anywhere in Australia, and 4 hours after the row's 14:00-in-AEDT-at-the-latest end is not needed.
    private static readonly DateTimeOffset During = new(2026, 11, 16, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset DaysBefore = new(2026, 11, 14, 0, 0, 0, TimeSpan.Zero);

    private sealed class Rig
    {
        public GroupActivityFixture Fx { get; }
        public User Worker { get; }
        public GroupActivity Activity { get; }
        public GroupActivityStaff Row { get; }

        public Rig(ShiftStatus status = ShiftStatus.Published, bool enabled = true)
        {
            Fx = new GroupActivityFixture(enabled);
            Worker = Fx.AddUser();
            Activity = Fx.AddActivity(status);
            Row = new GroupActivityStaff
            {
                Id = Guid.NewGuid(), TenantId = Fx.TenantId, GroupActivityId = Activity.Id, UserId = Worker.Id,
                StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0), Role = "Driver",
            };
            Fx.Seed.GroupActivityStaff.Add(Row);
            Fx.Seed.SaveChanges();
        }

        public PortalActivityShiftsController Controller(DateTimeOffset now, Guid? as_ = null, Guid? tenantId = null)
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.TenantId).Returns(tenantId ?? Fx.TenantId);
            var db = Fx.Fresh();
            var c = new PortalActivityShiftsController(db, tenant.Object, new Clock(now), new NotificationRaiser(db));
            c.ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, (as_ ?? Worker.Id).ToString())], "test")) },
            };
            return c;
        }

        public Task<GroupActivityStaff> SavedAsync() => Fx.Fresh().GroupActivityStaff.AsNoTracking().SingleAsync(r => r.Id == Row.Id);
        public Task<ShiftStatus> ActivityStatusAsync() => Fx.Fresh().GroupActivities.AsNoTracking().Where(a => a.Id == Activity.Id).Select(a => a.Status).SingleAsync();

        public void Set(Action<GroupActivityStaff> change)
        {
            var row = Fx.Seed.GroupActivityStaff.Single(r => r.Id == Row.Id);
            change(row);
            Fx.Seed.SaveChanges();
        }
    }

    private static string? Code<T>(ActionResult<ApiResponse<T>> result, int status)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, obj.StatusCode);
        return Assert.IsType<ApiResponse<T>>(obj.Value).Code;
    }

    private static readonly StartActivityShiftDto NoLocation = new() { GeolocationDeclined = true };

    [Fact]
    public async Task Start_SavesStartAndStartsTheActivity()
    {
        var rig = new Rig();
        var dto = GroupActivityFixture.Body(await rig.Controller(During).Start(rig.Row.Id, NoLocation, default), 200);
        Assert.Equal("Started", dto.State);
        var saved = await rig.SavedAsync();
        Assert.Equal(During.UtcDateTime, saved.ActualStart);
        Assert.Equal(During.UtcDateTime, saved.StartedAt);
        Assert.False(string.IsNullOrEmpty(saved.TimeZoneId));
        Assert.NotNull(saved.LocationCheck);
        Assert.Equal(ShiftStatus.InProgress, await rig.ActivityStatusAsync());
    }

    [Fact]
    public async Task Start_Twice_IsAReplayAndChangesNothing()
    {
        var rig = new Rig();
        await rig.Controller(During).Start(rig.Row.Id, NoLocation, default);
        var first = await rig.SavedAsync();
        GroupActivityFixture.Body(await rig.Controller(During.AddMinutes(30)).Start(rig.Row.Id, NoLocation, default), 200);
        Assert.Equal(first.ActualStart, (await rig.SavedAsync()).ActualStart);
    }

    [Fact]
    public async Task Start_TooEarly_Is409AndSavesNothing()
    {
        var rig = new Rig();
        Assert.Equal(ShiftErrorCodes.ShiftStartTooEarly, Code(await rig.Controller(DaysBefore).Start(rig.Row.Id, NoLocation, default), 409));
        Assert.Null((await rig.SavedAsync()).ActualStart);
        Assert.Equal(ShiftStatus.Published, await rig.ActivityStatusAsync());
    }

    [Fact]
    public async Task Start_FinishedRow_Is409()
    {
        var rig = new Rig(ShiftStatus.InProgress);
        rig.Set(r => { r.ActualStart = During.UtcDateTime.AddHours(-2); r.SubmittedAt = During.UtcDateTime.AddHours(-1); r.ActualEnd = During.UtcDateTime.AddHours(-1); });
        Assert.Equal(ShiftErrorCodes.ShiftAlreadyFinished, Code(await rig.Controller(During).Start(rig.Row.Id, NoLocation, default), 409));
    }

    [Theory]
    [InlineData("Start")]
    [InlineData("Finish")]
    public async Task ApprovedRow_Is409_AndActualsAreUnchanged(string action)
    {
        var rig = new Rig(ShiftStatus.InProgress);
        var start = During.UtcDateTime.AddHours(-3);
        rig.Set(r => { r.ActualStart = start; r.ActualEnd = start.AddHours(2); r.SubmittedAt = start.AddHours(2); r.ReviewOutcome = ReviewOutcome.Approved; });
        var c = rig.Controller(During);
        var result = action == "Start" ? await c.Start(rig.Row.Id, NoLocation, default) : await c.Finish(rig.Row.Id, new FinishActivityShiftDto(), default);
        Assert.Equal(ShiftErrorCodes.ShiftAlreadyCompleted, Code(result, 409));
        var saved = await rig.SavedAsync();
        Assert.Equal(start, saved.ActualStart);
        Assert.Equal(start.AddHours(2), saved.ActualEnd);
    }

    [Fact]
    public async Task Start_SomeoneElsesRow_Is404()
    {
        var rig = new Rig();
        var other = rig.Fx.AddUser("Olly");
        Assert.Null(Code(await rig.Controller(During, as_: other.Id).Start(rig.Row.Id, NoLocation, default), 404));
        Assert.Null((await rig.SavedAsync()).ActualStart);
    }

    [Fact]
    public async Task Start_DraftActivity_Is404()
    {
        var rig = new Rig(ShiftStatus.Draft);
        Assert.Null(Code(await rig.Controller(During).Start(rig.Row.Id, NoLocation, default), 404));
    }

    [Fact]
    public async Task Start_CancelledActivity_IsGaCancelled()
    {
        var rig = new Rig(ShiftStatus.Cancelled);
        Assert.Equal("GA_CANCELLED", Code(await rig.Controller(During).Start(rig.Row.Id, NoLocation, default), 409));
        Assert.Null((await rig.SavedAsync()).ActualStart);
    }

    [Fact]
    public async Task Start_FlagOff_IsGaDisabled()
    {
        var rig = new Rig(enabled: false);
        Assert.Equal("GA_DISABLED", Code(await rig.Controller(During).Start(rig.Row.Id, NoLocation, default), 409));
        Assert.Null((await rig.SavedAsync()).ActualStart);
    }

    [Fact]
    public async Task Finish_WithoutStart_Is409AndSavesNothing()
    {
        var rig = new Rig();
        Assert.Equal(ShiftErrorCodes.ShiftNotInProgress, Code(await rig.Controller(During).Finish(rig.Row.Id, new FinishActivityShiftDto(), default), 409));
        var saved = await rig.SavedAsync();
        Assert.Null(saved.ActualStart);
        Assert.Null(saved.SubmittedAt);
    }

    [Fact]
    public async Task Finish_AfterStart_SavesEndAndBreak()
    {
        var rig = new Rig();
        await rig.Controller(During).Start(rig.Row.Id, NoLocation, default);
        var end = During.AddHours(3);
        var dto = new FinishActivityShiftDto { BreakStart = During.UtcDateTime.AddHours(1), BreakEnd = During.UtcDateTime.AddHours(1.5) };
        Assert.Equal("Finished", GroupActivityFixture.Body(await rig.Controller(end).Finish(rig.Row.Id, dto, default), 200).State);
        var saved = await rig.SavedAsync();
        Assert.Equal(end.UtcDateTime, saved.ActualEnd);
        Assert.Equal(end.UtcDateTime, saved.SubmittedAt);
        Assert.Equal(During.UtcDateTime.AddHours(1), saved.BreakStartedAt);
        Assert.Equal(During.UtcDateTime.AddHours(1.5), saved.BreakEndedAt);
    }

    [Fact]
    public async Task Finish_Twice_IsAReplayThatKeepsTheFirstEnd()
    {
        var rig = new Rig();
        await rig.Controller(During).Start(rig.Row.Id, NoLocation, default);
        var end = During.AddHours(3);
        await rig.Controller(end).Finish(rig.Row.Id, new FinishActivityShiftDto(), default);
        var withBreak = new FinishActivityShiftDto { BreakStart = During.UtcDateTime.AddHours(1), BreakEnd = During.UtcDateTime.AddHours(2) };
        GroupActivityFixture.Body(await rig.Controller(end.AddMinutes(5)).Finish(rig.Row.Id, withBreak, default), 200);
        var saved = await rig.SavedAsync();
        Assert.Equal(end.UtcDateTime, saved.ActualEnd);
        Assert.Null(saved.BreakStartedAt);
    }

    [Fact]
    public async Task Finish_NeverStarted_WithTypedStart_StartsAndFinishes()
    {
        var rig = new Rig();
        var typed = During.UtcDateTime.AddHours(-2);
        GroupActivityFixture.Body(await rig.Controller(During).Finish(rig.Row.Id, new FinishActivityShiftDto { ActualStart = typed }, default), 200);
        var saved = await rig.SavedAsync();
        Assert.Equal(typed, saved.ActualStart);
        Assert.Equal(During.UtcDateTime, saved.ActualEnd);
        Assert.False(string.IsNullOrEmpty(saved.TimeZoneId));
        Assert.Equal(ShiftStatus.InProgress, await rig.ActivityStatusAsync());
    }

    [Theory]
    [InlineData(-30, 0)]    // 30 hours back
    [InlineData(1, 0)]      // in the future
    public async Task Finish_TypedStartOutsideTheLast24Hours_IsGaTimes(int hours, int _)
    {
        var rig = new Rig();
        var typed = During.UtcDateTime.AddHours(hours);
        Assert.Equal("GA_TIMES", Code(await rig.Controller(During).Finish(rig.Row.Id, new FinishActivityShiftDto { ActualStart = typed }, default), 400));
        Assert.Null((await rig.SavedAsync()).ActualStart);
    }

    [Fact]
    public async Task Finish_OneBreakTimeOnly_IsGaBreak()
    {
        var rig = new Rig();
        await rig.Controller(During).Start(rig.Row.Id, NoLocation, default);
        var dto = new FinishActivityShiftDto { BreakStart = During.UtcDateTime.AddHours(1) };
        Assert.Equal("GA_BREAK", Code(await rig.Controller(During.AddHours(3)).Finish(rig.Row.Id, dto, default), 400));
        Assert.Null((await rig.SavedAsync()).SubmittedAt);
    }

    [Fact]
    public async Task Finish_BreakOutsideTheShift_IsGaBreakRange()
    {
        var rig = new Rig();
        await rig.Controller(During).Start(rig.Row.Id, NoLocation, default);
        var dto = new FinishActivityShiftDto { BreakStart = During.UtcDateTime.AddHours(-1), BreakEnd = During.UtcDateTime.AddHours(1) };
        Assert.Equal("GA_BREAK_RANGE", Code(await rig.Controller(During.AddHours(3)).Finish(rig.Row.Id, dto, default), 400));
        Assert.Null((await rig.SavedAsync()).SubmittedAt);
    }

    [Fact]
    public async Task MyShifts_ListsTheWorkersRowWithItsParticipants_AndNotAnotherWorkers()
    {
        var rig = new Rig();
        var p = rig.Fx.AddParticipant("Pat");
        var shift = rig.Fx.AddShift(p, status: ShiftStatus.Published);
        rig.Fx.Seed.Shifts.Single(s => s.Id == shift.Id).GroupActivityId = rig.Activity.Id;
        rig.Fx.Seed.SaveChanges();
        var other = rig.Fx.AddUser("Olly");

        var rows = await PortalActivityShiftsLookup(rig, rig.Worker.Id);
        var mine = Assert.Single(rows);
        Assert.Equal(rig.Row.Id, mine.Id);
        Assert.Equal("NotStarted", mine.State);
        Assert.Equal("Pat Test", Assert.Single(mine.Participants).Name);
        Assert.Empty(await PortalActivityShiftsLookup(rig, other.Id));
    }

    private PortalController NotesController(Rig rig, Guid userId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(rig.Fx.TenantId);
        return new PortalController(rig.Fx.Fresh(), tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test")) } },
        };
    }

    private static Shift Attach(Rig rig, ShiftStatus status)
    {
        var shift = rig.Fx.AddShift(rig.Fx.AddParticipant("Pat"), status: status);
        rig.Fx.Seed.Shifts.Single(s => s.Id == shift.Id).GroupActivityId = rig.Activity.Id;
        rig.Fx.Seed.SaveChanges();
        return shift;
    }

    [Fact]
    public async Task Notes_RosteredWorker_CanReadAndWriteOnAParticipantShift_AnOutsiderCannot()
    {
        var rig = new Rig();
        var shift = Attach(rig, ShiftStatus.Published);
        var outsider = rig.Fx.AddUser("Olly");
        Assert.IsType<OkObjectResult>((await NotesController(rig, rig.Worker.Id).GetShiftNotes(shift.Id, default)).Result);
        Assert.IsType<OkObjectResult>((await NotesController(rig, rig.Worker.Id).CreateShiftNote(shift.Id, new CreateShiftNoteDto { Body = "Had a great time." }, default)).Result);
        Assert.Single(rig.Fx.Fresh().ShiftNotes);
        Assert.IsType<NotFoundObjectResult>((await NotesController(rig, outsider.Id).GetShiftNotes(shift.Id, default)).Result);
        Assert.IsType<NotFoundObjectResult>((await NotesController(rig, outsider.Id).CreateShiftNote(shift.Id, new CreateShiftNoteDto { Body = "Hi" }, default)).Result);
        Assert.Single(rig.Fx.Fresh().ShiftNotes);
    }

    [Fact]
    public async Task Notes_CancelledParticipantShift_404()
    {
        var rig = new Rig();
        var shift = Attach(rig, ShiftStatus.Cancelled);
        Assert.IsType<NotFoundObjectResult>((await NotesController(rig, rig.Worker.Id).GetShiftNotes(shift.Id, default)).Result);
        Assert.IsType<NotFoundObjectResult>((await NotesController(rig, rig.Worker.Id).CreateShiftNote(shift.Id, new CreateShiftNoteDto { Body = "Hi" }, default)).Result);
        Assert.Empty(rig.Fx.Fresh().ShiftNotes);
    }

    [Fact]
    public async Task Notes_RemovedWorker_LosesAccessAtOnce()
    {
        var rig = new Rig();
        var shift = Attach(rig, ShiftStatus.Published);
        rig.Fx.Seed.GroupActivityStaff.Remove(rig.Fx.Seed.GroupActivityStaff.Single(r => r.Id == rig.Row.Id));
        rig.Fx.Seed.SaveChanges();
        Assert.IsType<NotFoundObjectResult>((await NotesController(rig, rig.Worker.Id).GetShiftNotes(shift.Id, default)).Result);
    }

    private static Task<List<PortalActivityShiftDto>> PortalActivityShiftsLookup(Rig rig, Guid staffId) =>
        Odip.Api.Rostering.PortalActivityShifts.ListAsync(rig.Fx.Fresh(), staffId, GroupActivityFixture.Day.AddDays(-7), GroupActivityFixture.Day.AddDays(7), GroupActivityFixture.Day, default);

    // ---- finish notice to coordinators (GA payroll) ----

    private static User StaffOf(Rig rig, UserRole role, bool active = true, Guid? tenantId = null)
    {
        var u = rig.Fx.AddUser("Cora", active, tenantId);
        var tracked = rig.Fx.Seed.Users.IgnoreQueryFilters().Single(x => x.Id == u.Id);
        tracked.Role = role;
        rig.Fx.Seed.SaveChanges();
        return tracked;
    }

    private static Task<List<NotificationOutbox>> NoticesAsync(Rig rig) =>
        rig.Fx.Fresh().NotificationOutbox.IgnoreQueryFilters().AsNoTracking().Where(o => o.EventType == NotificationEventType.ShiftCompletionPendingReview).ToListAsync();

    [Fact]
    public async Task Finish_RaisesPendingReview_ToActiveAdminsAndCoordinatorsOfTenant()
    {
        var rig = new Rig();
        var admin = StaffOf(rig, UserRole.Admin);
        var coordinator = StaffOf(rig, UserRole.Coordinator);
        StaffOf(rig, UserRole.Coordinator, active: false);
        StaffOf(rig, UserRole.SupportWorker);
        StaffOf(rig, UserRole.Coordinator, tenantId: Guid.NewGuid());
        await rig.Controller(During).Start(rig.Row.Id, NoLocation, default);

        GroupActivityFixture.Body(await rig.Controller(During.AddHours(3)).Finish(rig.Row.Id, new FinishActivityShiftDto(), default), 200);

        var notices = await NoticesAsync(rig);
        Assert.Equal(new[] { admin.Id, coordinator.Id }.Order(), notices.Select(n => n.RecipientUserId).Order());
        Assert.All(notices, n => Assert.Equal(("GroupActivityStaff", rig.Row.Id), (n.EntityType, n.EntityId)));
        var payload = System.Text.Json.JsonSerializer.Deserialize<ShiftCompletionPendingReviewPayload>(notices[0].PayloadJson)!;
        Assert.Equal(("Wendy Worker", rig.Activity.Title), (payload.WorkerName, payload.ActivityTitle));
    }

    [Fact]
    public async Task Finish_Replay_RaisesNothingMore()
    {
        var rig = new Rig();
        StaffOf(rig, UserRole.Coordinator);
        await rig.Controller(During).Start(rig.Row.Id, NoLocation, default);
        await rig.Controller(During.AddHours(3)).Finish(rig.Row.Id, new FinishActivityShiftDto(), default);

        await rig.Controller(During.AddHours(3.1)).Finish(rig.Row.Id, new FinishActivityShiftDto(), default);

        Assert.Single(await NoticesAsync(rig));
    }

    [Fact]
    public async Task RecordTimes_RaisesNothing()
    {
        var rig = new Rig();
        var coordinator = StaffOf(rig, UserRole.Coordinator);
        var activity = rig.Fx.AddActivity(ShiftStatus.InProgress, DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1));
        var row = new GroupActivityStaff { Id = Guid.NewGuid(), TenantId = rig.Fx.TenantId, GroupActivityId = activity.Id, UserId = rig.Worker.Id, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0), TimeZoneId = "Australia/Sydney" };
        rig.Fx.Seed.GroupActivityStaff.Add(row);
        rig.Fx.Seed.SaveChanges();
        var times = new SetGroupStaffActualsDto { ActualStart = DateTime.UtcNow.AddHours(-5), ActualEnd = DateTime.UtcNow.AddHours(-1), Reason = "Forgot to tap Finish" };

        GroupActivityFixture.Body(await rig.Fx.Controller(userId: coordinator.Id).SetStaffActuals(activity.Id, row.Id, times, default), 200);

        Assert.Empty(await NoticesAsync(rig));
    }
}
