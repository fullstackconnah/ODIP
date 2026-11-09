using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
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
using System.Reflection;
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

        public Rig(ShiftStatus status = ShiftStatus.Published, bool enabled = true, DateOnly? day = null)
        {
            Fx = new GroupActivityFixture(enabled);
            Worker = Fx.AddUser();
            Activity = Fx.AddActivity(status, day);
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
    public async Task Start_DeactivatedWorker_IsRefusedLikeAMissingUser_AnActiveOneStarts()
    {
        var rig = new Rig();
        rig.Fx.Seed.Users.Single(u => u.Id == rig.Worker.Id).IsActive = false;
        rig.Fx.Seed.SaveChanges();
        Assert.Null(Code(await rig.Controller(During).Start(rig.Row.Id, NoLocation, default), 404));
        Assert.Null((await rig.SavedAsync()).ActualStart);

        rig.Fx.Seed.Users.Single(u => u.Id == rig.Worker.Id).IsActive = true;
        rig.Fx.Seed.SaveChanges();
        Assert.IsType<ApiResponse<PortalActivityShiftDto>>(Assert.IsAssignableFrom<ObjectResult>((await rig.Controller(During).Start(rig.Row.Id, NoLocation, default)).Result).Value);
        Assert.NotNull((await rig.SavedAsync()).ActualStart);
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

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task PortalMyShifts_ListsTheActivityOnlyWhileTheSwitchIsOn_OrdinaryShiftsEitherWay(bool enabled)
    {
        var rig = new Rig(enabled: enabled);
        var ordinary = rig.Fx.AddShift(rig.Fx.AddParticipant("Pat"), userId: rig.Worker.Id, status: ShiftStatus.Published);

        var result = await NotesController(rig, rig.Worker.Id).GetMyShifts(GroupActivityFixture.Day.AddDays(-7), GroupActivityFixture.Day.AddDays(7), default);

        var body = Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(ordinary.Id, Assert.Single(body.Shifts).Id);
        Assert.Equal(enabled ? 1 : 0, body.ActivityShifts?.Count ?? 0);
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
    public async Task Start_RaisesNothing()
    {
        var rig = new Rig();
        StaffOf(rig, UserRole.Admin);
        StaffOf(rig, UserRole.Coordinator);

        await rig.Controller(During).Start(rig.Row.Id, NoLocation, default);

        Assert.Empty(await NoticesAsync(rig));
    }

    [Fact]
    public async Task Finish_NeverStarted_WithTypedStart_RaisesOnePerAdminAndCoordinator()
    {
        var rig = new Rig();
        var admin = StaffOf(rig, UserRole.Admin);
        var coordinator = StaffOf(rig, UserRole.Coordinator);

        GroupActivityFixture.Body(await rig.Controller(During).Finish(rig.Row.Id, new FinishActivityShiftDto { ActualStart = During.UtcDateTime.AddHours(-2) }, default), 200);

        Assert.Equal(new[] { admin.Id, coordinator.Id }.Order(), (await NoticesAsync(rig)).Select(n => n.RecipientUserId).Order());
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

    // ---- worker marks attendance (ga-portal-attendance) ----

    private static readonly DateOnly Yesterday = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);   // a no-show can only be undone after the service day has begun
    private const string StartedMessage = "Start this shift before you mark attendance.";

    /// <summary>The worker has tapped Start on an InProgress activity from yesterday.</summary>
    private static Rig StartedRig(ShiftStatus status = ShiftStatus.InProgress, bool enabled = true)
    {
        var rig = new Rig(status, enabled, Yesterday);
        rig.Set(r => { r.ActualStart = DateTime.UtcNow.AddHours(-2); r.StartedAt = r.ActualStart; });
        return rig;
    }

    private static Participant Person(Rig rig, string first = "Pat", ShiftStatus status = ShiftStatus.Published, Guid? tenantId = null)
    {
        var person = rig.Fx.AddParticipant(first);
        var shift = rig.Fx.AddShift(person, day: rig.Activity.ServiceDate, status: status);
        var tracked = rig.Fx.Seed.Shifts.Single(s => s.Id == shift.Id);
        tracked.GroupActivityId = rig.Activity.Id;
        if (tenantId is { } t) { tracked.TenantId = t; rig.Fx.Seed.Participants.Single(p => p.Id == person.Id).TenantId = t; }
        rig.Fx.Seed.SaveChanges();
        return person;
    }

    private static Task<ActionResult<ApiResponse<PortalActivityShiftDto>>> Mark(Rig rig, Guid personId, bool attended, Guid? rowId = null, Guid? as_ = null) =>
        rig.Controller(During, as_).SetAttendance(rowId ?? rig.Row.Id, new SetActivityAttendanceDto { ParticipantId = personId, Attended = attended }, default);

    private static async Task<Shift> ShiftOf(Rig rig, Guid personId) => await rig.Fx.Fresh().Shifts.IgnoreQueryFilters().AsNoTracking().SingleAsync(s => s.ParticipantId == personId);

    private static string Message<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsAssignableFrom<ObjectResult>(result.Result).Value).Errors![0];

    [Fact]
    public async Task Attendance_SomeoneElsesRow_Is404_AndSavesNothing()
    {
        var rig = StartedRig();
        var person = Person(rig);
        var outsider = rig.Fx.AddUser("Olly");
        Assert.Null(Code(await Mark(rig, person.Id, false, as_: outsider.Id), 404));
        Assert.Equal(ShiftStatus.Published, (await ShiftOf(rig, person.Id)).Status);
    }

    [Fact]
    public async Task Attendance_NotStartedRow_Is409ShiftNotInProgress()
    {
        var rig = new Rig(ShiftStatus.InProgress, day: Yesterday);
        var person = Person(rig);
        var result = await Mark(rig, person.Id, false);
        Assert.Equal(ShiftErrorCodes.ShiftNotInProgress, Code(result, 409));
        Assert.Equal(StartedMessage, Message(result));
        Assert.Equal(ShiftStatus.Published, (await ShiftOf(rig, person.Id)).Status);
    }

    [Theory]
    [InlineData("Finished", ShiftErrorCodes.ShiftAlreadyFinished)]
    [InlineData("Approved", ShiftErrorCodes.ShiftAlreadyCompleted)]
    public async Task Attendance_FinishedRow_And_ApprovedRow_Are409(string state, string code)
    {
        var rig = StartedRig();
        var person = Person(rig);
        rig.Set(r => { r.SubmittedAt = DateTime.UtcNow.AddHours(-1); r.ActualEnd = r.SubmittedAt; if (state == "Approved") r.ReviewOutcome = ReviewOutcome.Approved; });
        Assert.Equal(code, Code(await Mark(rig, person.Id, false), 409));
        Assert.Equal(ShiftStatus.Published, (await ShiftOf(rig, person.Id)).Status);
    }

    [Fact]
    public async Task Attendance_CancelledActivity_IsGaCancelled()
    {
        var rig = StartedRig(ShiftStatus.Cancelled);
        Assert.Equal("GA_CANCELLED", Code(await Mark(rig, Person(rig).Id, false), 409));
    }

    [Fact]
    public async Task Attendance_DraftActivity_Is404()
    {
        var rig = StartedRig(ShiftStatus.Draft);
        Assert.Null(Code(await Mark(rig, Person(rig).Id, false), 404));
    }

    [Fact]
    public async Task Attendance_FlagOff_IsGaDisabled()
    {
        var rig = StartedRig(enabled: false);
        Assert.Equal("GA_DISABLED", Code(await Mark(rig, Person(rig).Id, false), 409));
    }

    [Fact]
    public async Task Attendance_ActivityCompleted_IsAttendanceClosed()
    {
        var rig = StartedRig(ShiftStatus.Completed);
        var person = Person(rig);
        Assert.Equal("GA_ATTENDANCE_CLOSED", Code(await Mark(rig, person.Id, false), 409));
        Assert.Equal(ShiftStatus.Published, (await ShiftOf(rig, person.Id)).Status);
    }

    [Fact]
    public async Task Attendance_ActivityPendingReview_IsAttendanceClosed_Not200()
    {
        // E13's own window lets PendingReview through; the worker's route must not.
        var rig = StartedRig(ShiftStatus.PendingReview);
        var person = Person(rig);
        var result = await Mark(rig, person.Id, false);
        Assert.Equal("GA_ATTENDANCE_CLOSED", Code(result, 409));
        Assert.Equal(RosteringController.AttendanceClosedMessage, Message(result));
        Assert.Equal(ShiftStatus.Published, (await ShiftOf(rig, person.Id)).Status);
    }

    [Fact]
    public async Task Attendance_ParticipantNotOnActivity_Is400_AndOtherOrgsParticipant_Is400()
    {
        var rig = StartedRig();
        var other = Person(rig, "Olga", tenantId: Guid.NewGuid());
        Assert.Equal("GA_PARTICIPANT_NOT_FOUND", Code(await Mark(rig, Guid.NewGuid(), false), 400));
        Assert.Equal("GA_PARTICIPANT_NOT_FOUND", Code(await Mark(rig, Guid.Empty, false), 400));
        Assert.Equal("GA_PARTICIPANT_NOT_FOUND", Code(await Mark(rig, other.Id, false), 400));
        Assert.Equal(ShiftStatus.Published, (await ShiftOf(rig, other.Id)).Status);
    }

    [Fact]
    public async Task Attendance_Mark_CancelsTheShift_AndTheAnswerListsThemAsDidNotAttend()
    {
        var rig = StartedRig();
        var person = Person(rig);
        var before = DateTime.UtcNow.AddSeconds(-5);
        var dto = GroupActivityFixture.Body(await Mark(rig, person.Id, false), 200);
        var saved = await ShiftOf(rig, person.Id);
        Assert.Equal(ShiftStatus.Cancelled, saved.Status);
        Assert.InRange(saved.CancelledAt!.Value, before, DateTime.UtcNow.AddSeconds(5));
        var listed = Assert.Single(dto.Participants);
        Assert.Equal((person.Id, true), (listed.ParticipantId, listed.DidNotAttend));
    }

    [Fact]
    public async Task Attendance_Undo_RestoresPublished_AndDidNotAttendFalse()
    {
        var rig = StartedRig();
        var person = Person(rig);
        await Mark(rig, person.Id, false);
        var dto = GroupActivityFixture.Body(await Mark(rig, person.Id, true), 200);
        var saved = await ShiftOf(rig, person.Id);
        Assert.Equal(ShiftStatus.Published, saved.Status);
        Assert.Null(saved.CancelledAt);
        Assert.False(Assert.Single(dto.Participants).DidNotAttend);
    }

    [Fact]
    public async Task Attendance_MarkTwice_And_UndoTwice_AreIdempotent()
    {
        var rig = StartedRig();
        var person = Person(rig);
        await Mark(rig, person.Id, false);
        var first = await ShiftOf(rig, person.Id);
        GroupActivityFixture.Body(await Mark(rig, person.Id, false), 200);
        var again = await ShiftOf(rig, person.Id);
        Assert.Equal((first.CancelledAt, first.UpdatedAt), (again.CancelledAt, again.UpdatedAt));

        await Mark(rig, person.Id, true);
        GroupActivityFixture.Body(await Mark(rig, person.Id, true), 200);
        Assert.Equal(ShiftStatus.Published, (await ShiftOf(rig, person.Id)).Status);
    }

    [Fact]
    public async Task Attendance_ShiftInProgress_IsLockedWithWorkerWording()
    {
        var rig = StartedRig();
        var person = Person(rig, status: ShiftStatus.InProgress);
        var result = await Mark(rig, person.Id, false);
        Assert.Equal("GA_SHIFT_LOCKED", Code(result, 409));
        Assert.Equal("Your coordinator needs to change this.", Message(result));
    }

    [Fact]
    public async Task Attendance_Undo_WhenTheNoShowIsOnAClaim_IsShiftClaimLocked_WithWorkerWording()
    {
        var rig = StartedRig();
        var person = Person(rig);
        await Mark(rig, person.Id, false);
        var shift = await ShiftOf(rig, person.Id);
        var claim = new TripClaim { Id = Guid.NewGuid(), TenantId = rig.Fx.TenantId, ClaimReference = "CLM-1", Kind = ClaimKind.Shift, ParticipantId = person.Id };
        rig.Fx.Seed.TripClaims.Add(claim);
        rig.Fx.Seed.ClaimLineItems.Add(new ClaimLineItem { Id = Guid.NewGuid(), TenantId = rig.Fx.TenantId, TripClaimId = claim.Id, ShiftId = shift.Id });
        rig.Fx.Seed.SaveChanges();

        var result = await Mark(rig, person.Id, true);
        Assert.Equal(ShiftErrorCodes.ShiftClaimLocked, Code(result, 409));
        Assert.Equal("This person's support has already been claimed, so ask your coordinator.", Message(result));
        Assert.Equal(ShiftStatus.Cancelled, (await ShiftOf(rig, person.Id)).Status);
    }

    [Fact]
    public void Attendance_MissingAttended_IsNotAMark()
    {
        var results = new List<System.ComponentModel.DataAnnotations.ValidationResult>();
        var dto = new SetActivityAttendanceDto { ParticipantId = Guid.NewGuid() };
        Assert.False(System.ComponentModel.DataAnnotations.Validator.TryValidateObject(dto, new(dto), results, true));
        Assert.Contains(results, r => r.MemberNames.Contains("Attended"));
    }

    [Fact]
    public async Task MyShifts_KeepsANoShow_DropsAnEarlyBoardCancel()
    {
        var rig = StartedRig();
        var noShow = Person(rig, "Nora");
        var early = Person(rig, "Earl");
        await Mark(rig, noShow.Id, false);
        var earlyShift = rig.Fx.Seed.Shifts.Single(s => s.ParticipantId == early.Id);
        earlyShift.Status = ShiftStatus.Cancelled;
        earlyShift.CancelledAt = DateTime.UtcNow.AddDays(-3);
        rig.Fx.Seed.SaveChanges();

        var card = Assert.Single(await PortalActivityShiftsLookup(rig, rig.Worker.Id));
        var listed = Assert.Single(card.Participants);
        Assert.Equal((noShow.Id, true), (listed.ParticipantId, listed.DidNotAttend));
    }
}

/// <summary>The worker's portal mark is open to any signed-in role like Start and Finish: the controller has no role list and the action no [Authorize] of its own.</summary>
public class PortalActivityShiftsControllerRoleTests
{
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    [Theory]
    [InlineData("SupportWorker"), InlineData("Coordinator"), InlineData("Admin")]
    public void SetAttendance_AdmitsWorkersAndOffice(string role)
    {
        var action = typeof(PortalActivityShiftsController).GetMethod(nameof(PortalActivityShiftsController.SetAttendance))!;
        Assert.True(Allows(action, role));
        Assert.Empty(action.GetCustomAttributes<AuthorizeAttribute>(false));
    }
}
