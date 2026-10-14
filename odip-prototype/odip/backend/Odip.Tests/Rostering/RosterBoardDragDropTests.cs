using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Roster board drag and drop (spec 2026-10-14) on EF InMemory: the /assign guards, notices only for Published shifts, the all-or-nothing
/// move-staff request and Publish week. The lock and transaction behaviour is in RosterBoardDragDropPostgresTests.
/// </summary>
public class RosterBoardDragDropTests
{
    // A Monday: the week is 2026-08-24 to 2026-08-30.
    private static readonly DateOnly Monday = new(2026, 8, 24);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    // The provider's today is 2026-08-20 in every Australian zone, so the test week is in the future (Publish week notifies only shifts from today on).
    private static readonly TimeProvider BeforeTheWeek = new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero));

    private static RosteringController Controller(OdipDbContext db, Guid? tenantId = null, TimeProvider? clock = null)
    {
        ICurrentTenant? tenant = null;
        if (tenantId is { } id)
        {
            var mock = new Mock<ICurrentTenant>();
            mock.Setup(t => t.TenantId).Returns(id);
            mock.Setup(t => t.IsSuperAdmin).Returns(false);
            tenant = mock.Object;
        }
        return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: clock ?? BeforeTheWeek, tenant: tenant);
    }


    private static User SeedStaff(OdipDbContext db, string first = "Sam", string last = "Wilson", bool screeningValid = true)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), FirstName = first, LastName = last, Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            // A lapsed screening is WSC_EXPIRED, a Blocking finding.
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = screeningValid ? new DateOnly(2030, 1, 1) : new DateOnly(2020, 1, 1),
        };
        db.Users.Add(user);
        db.SaveChangesAsync().GetAwaiter().GetResult();   // the async save is the one that stamps TenantId on a tenant context
        return user;
    }

    private static Participant SeedParticipant(OdipDbContext db, string first = "Mia", string last = "Chen")
    {
        // Active and not a draft: can receive services, so Warn-mode readiness lets a placement through.
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = first, LastName = last, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return participant;
    }

    private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid? userId, ShiftStatus status = ShiftStatus.Draft, DateOnly? day = null, int startHour = 9, int endHour = 15)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, UserId = userId, ServiceDate = day ?? Monday,
            StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
        };
        db.Shifts.Add(shift);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return shift;
    }

    private static T Body<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static Task<Shift> Reload(OdipDbContext db, Guid id) => db.Shifts.AsNoTracking().SingleAsync(s => s.Id == id);

    // ── /assign refuses the locked statuses (decision 8) ──

    [Theory]
    [InlineData(ShiftStatus.InProgress, false)]
    [InlineData(ShiftStatus.PendingReview, false)]
    [InlineData(ShiftStatus.Completed, false)]
    [InlineData(ShiftStatus.Cancelled, false)]
    [InlineData(ShiftStatus.Completed, true)]   // clearing (the menu's Unassign) is refused too
    public async Task AssignShift_OnALockedShift_Is409AndKeepsTheWorker(ShiftStatus status, bool clearing)
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var sam = SeedStaff(db);
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, status);

        var result = await Controller(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = clearing ? null : sam.Id }, default);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(ShiftErrorCodes.ShiftStatusLocked, Assert.IsType<ApiResponse<ShiftDto>>(conflict.Value).Code);
        Assert.Equal(alex.Id, (await Reload(db, shift.Id)).UserId);
    }

    [Theory]
    [InlineData(ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Published)]
    public async Task AssignShift_OnADraftOrPublishedShift_StillAssigns(ShiftStatus status)
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var shift = SeedShift(db, SeedParticipant(db).Id, null, status);

        // Naming the worker the board showed (nobody) passes the stale-board guard.
        var dto = Body(await Controller(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = sam.Id, ExpectedStaffId = null }, default));

        Assert.Equal(sam.Id, dto.StaffId);
        Assert.Equal(sam.Id, (await Reload(db, shift.Id)).UserId);
    }

    // ── /assign refuses a drop made on a board that is out of date (Review Focus 1) ──

    [Theory]
    [InlineData(false)]   // the board showed it unfilled (expected null); someone has filled it since
    [InlineData(true)]    // the board showed Alex (the prompt's Replace); someone has put Jo on since
    public async Task AssignShift_WhenTheShiftChangedSinceTheBoardLoaded_Is409AndChangesNothing(bool boardShowedAlex)
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var jo = SeedStaff(db, "Jo", "Park");
        var sam = SeedStaff(db);
        var shift = SeedShift(db, SeedParticipant(db).Id, jo.Id, ShiftStatus.Published);

        var result = await Controller(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = sam.Id, ExpectedStaffId = boardShowedAlex ? alex.Id : null }, default);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(jo.Id, (await Reload(db, shift.Id)).UserId);
        Assert.Empty(await db.NotificationOutbox.ToListAsync());
    }

    [Fact]
    public void AssignShiftDto_TellsAnAbsentExpectedStaffIdFromANullOne()
    {
        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);

        Assert.False(JsonSerializer.Deserialize<AssignShiftDto>("""{ "staffId": null }""", web)!.ExpectsStaff);
        Assert.True(JsonSerializer.Deserialize<AssignShiftDto>("""{ "staffId": null, "expectedStaffId": null }""", web)!.ExpectsStaff);
    }

    private static async Task<List<(NotificationEventType Type, Guid To)>> Notices(OdipDbContext db) =>
        (await db.NotificationOutbox.AsNoTracking().ToListAsync()).Select(o => (o.EventType, o.RecipientUserId)).OrderBy(n => n.EventType).ThenBy(n => n.RecipientUserId).ToList();

    private static UpdateShiftDto Put(Shift s, Guid? staffId, ShiftStatus status) => new()
    {
        ParticipantId = s.ParticipantId, StaffId = staffId, ServiceDate = s.ServiceDate, StartTime = s.StartTime, EndTime = s.EndTime,
        EndsNextDay = s.EndsNextDay, Ratio = s.Ratio, NightType = s.NightType, Status = status,
    };

    // ── Notices only for Published shifts (decision 9) ──

    [Fact]
    public async Task AssignShift_OnADraft_SendsNothing()
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, ShiftStatus.Draft);

        await Controller(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = SeedStaff(db).Id }, default);
        await Controller(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = null }, default);

        Assert.Empty(await Notices(db));
    }

    [Fact]
    public async Task AssignShift_ReplacingOnAPublishedShift_TellsBothPeople()
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var sam = SeedStaff(db);
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, ShiftStatus.Published);

        Body(await Controller(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = sam.Id }, default));

        Assert.Equal(new[] { (NotificationEventType.ShiftAssigned, sam.Id), (NotificationEventType.ShiftUnassigned, alex.Id) }, await Notices(db));
    }

    [Fact]
    public async Task AssignShift_ClearingAPublishedShift_SendsShiftUnassigned()
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, ShiftStatus.Published);

        Body(await Controller(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = null }, default));

        Assert.Equal(new[] { (NotificationEventType.ShiftUnassigned, alex.Id) }, await Notices(db));
    }

    [Fact]
    public async Task AssignShift_TheSameWorkerAgain_SendsNothing()
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, ShiftStatus.Published);

        Body(await Controller(db).AssignShift(shift.Id, new AssignShiftDto { StaffId = alex.Id }, default));

        Assert.Empty(await Notices(db));
    }

    [Fact]
    public async Task UpdateShift_DraftToPublished_TellsTheWorker()
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, ShiftStatus.Draft);

        Body(await Controller(db).UpdateShift(shift.Id, Put(shift, alex.Id, ShiftStatus.Published), default));

        Assert.Equal(new[] { (NotificationEventType.ShiftAssigned, alex.Id) }, await Notices(db));
    }

    [Fact]
    public async Task UpdateShift_ChangingTheWorkerOnAPublishedShift_TellsBothPeople()
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var sam = SeedStaff(db);
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, ShiftStatus.Published);

        Body(await Controller(db).UpdateShift(shift.Id, Put(shift, sam.Id, ShiftStatus.Published), default));

        Assert.Equal(new[] { (NotificationEventType.ShiftAssigned, sam.Id), (NotificationEventType.ShiftUnassigned, alex.Id) }, await Notices(db));
    }

    [Theory]
    [InlineData(ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Cancelled)]
    public async Task UpdateShift_ChangingTheWorkerAndLeavingPublished_TellsTheOneTakenOff(ShiftStatus to)   // deep review S2
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var sam = SeedStaff(db);
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, ShiftStatus.Published);

        Body(await Controller(db).UpdateShift(shift.Id, Put(shift, sam.Id, to), default));

        // Alex was told they were on a Published shift, so they hear they are off it; Sam is on a shift that is no longer out, so hears nothing yet.
        Assert.Equal(new[] { (NotificationEventType.ShiftUnassigned, alex.Id) }, await Notices(db));
    }

    [Theory]
    [InlineData(ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Cancelled)]
    public async Task UpdateShift_PublishedToDraftOrCancelled_SendsNothing(ShiftStatus to)
    {
        using var db = TestDb.Create();
        var alex = SeedStaff(db, "Alex", "Ng");
        var shift = SeedShift(db, SeedParticipant(db).Id, alex.Id, ShiftStatus.Published);

        Body(await Controller(db).UpdateShift(shift.Id, Put(shift, alex.Id, to), default));

        Assert.Empty(await Notices(db));
    }

    // ── POST /shifts/move-staff: one all-or-nothing request ──

    // As the page sends it: the person it carried is whoever the board showed on the source.
    private static MoveStaffDto Move(Shift from, Shift to, MoveStaffMode mode, string? reason = null, List<string>? codes = null) =>
        new() { FromShiftId = from.Id, ToShiftId = to.Id, Mode = mode, StaffId = from.UserId, OverrideReason = reason, AcknowledgedFindingCodes = codes };

    private static List<(NotificationEventType Type, Guid To)> Sorted(params (NotificationEventType Type, Guid To)[] notices) =>
        notices.OrderBy(n => n.Type).ThenBy(n => n.To).ToList();

    [Fact]
    public async Task MoveStaff_Move_PutsThePersonOnTheTarget_AndTheSourceNeedsStaff()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id, day: Monday);
        var to = SeedShift(db, mia.Id, null, day: Monday.AddDays(1));

        var dto = Body(await Controller(db).MoveStaff(Move(from, to, MoveStaffMode.Move), default));

        Assert.Equal(sam.Id, dto.StaffId);
        Assert.Equal(sam.Id, (await Reload(db, to.Id)).UserId);
        Assert.Null((await Reload(db, from.Id)).UserId);
        Assert.Empty(await Notices(db));   // both Draft: silent
    }

    [Fact]
    public async Task MoveStaff_BetweenOverlappingShifts_RaisesNoDoubleBooking()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var from = SeedShift(db, SeedParticipant(db).Id, sam.Id, startHour: 9, endHour: 15);
        var to = SeedShift(db, SeedParticipant(db, "Jo", "Park").Id, null, startHour: 10, endHour: 14);
        var controller = Controller(db);
        // The overlap is real: a dry run of Sam on the target, while Sam is still on the source, says DOUBLE_BOOKED_SHIFT.
        var dryRun = Body(await controller.CheckShift(new CheckShiftDto
        {
            Id = to.Id, ParticipantId = to.ParticipantId, StaffId = sam.Id, ServiceDate = to.ServiceDate,
            StartTime = to.StartTime, EndTime = to.EndTime, Ratio = to.Ratio, NightType = to.NightType,
        }, default));
        Assert.Contains(dryRun, f => f.Code == RosterConflictService.DoubleBookedShift);

        var moved = Body(await controller.MoveStaff(Move(from, to, MoveStaffMode.Move), default));

        Assert.DoesNotContain(moved.Findings, f => f.Code == RosterConflictService.DoubleBookedShift);
        Assert.DoesNotContain(RosterConflictService.DoubleBookedShift, (await Reload(db, to.Id)).AcknowledgedFindingCodes ?? "");
    }

    [Fact]
    public async Task MoveStaff_ReplaceOnPublishedShifts_TellsEachChange()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var alex = SeedStaff(db, "Alex", "Ng");
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id, ShiftStatus.Published, day: Monday);
        var to = SeedShift(db, mia.Id, alex.Id, ShiftStatus.Published, day: Monday.AddDays(1));

        Body(await Controller(db).MoveStaff(Move(from, to, MoveStaffMode.Replace), default));

        Assert.Equal(sam.Id, (await Reload(db, to.Id)).UserId);
        Assert.Null((await Reload(db, from.Id)).UserId);
        Assert.Equal(Sorted((NotificationEventType.ShiftAssigned, sam.Id), (NotificationEventType.ShiftUnassigned, alex.Id), (NotificationEventType.ShiftUnassigned, sam.Id)), await Notices(db));
    }

    [Fact]
    public async Task MoveStaff_Swap_ExchangesThePeople()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var alex = SeedStaff(db, "Alex", "Ng");
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id, day: Monday);
        var to = SeedShift(db, mia.Id, alex.Id, day: Monday.AddDays(1));

        Body(await Controller(db).MoveStaff(Move(from, to, MoveStaffMode.Swap), default));

        Assert.Equal(sam.Id, (await Reload(db, to.Id)).UserId);
        Assert.Equal(alex.Id, (await Reload(db, from.Id)).UserId);
    }

    [Fact]
    public async Task MoveStaff_ASwapWhoseSecondHalfIsBlocked_Is422_AndLeavesBothShiftsAndTheOutboxAlone()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var alex = SeedStaff(db, "Alex", "Ng", screeningValid: false);   // landing anywhere is WSC_EXPIRED: Blocking
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id, ShiftStatus.Published, day: Monday);
        var to = SeedShift(db, mia.Id, alex.Id, ShiftStatus.Published, day: Monday.AddDays(1));

        var result = await Controller(db).MoveStaff(Move(from, to, MoveStaffMode.Swap, "Covering a sick call"), default);

        var refused = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value);
        Assert.Contains(refused.Data!, f => f.Code == RosterConflictService.WscExpired);
        Assert.Equal(sam.Id, (await Reload(db, from.Id)).UserId);
        Assert.Equal(alex.Id, (await Reload(db, to.Id)).UserId);
        Assert.Empty(await Notices(db));
    }

    [Fact]
    public async Task MoveStaff_AWarningThatNeedsAReason_Is422_ThenGoesThroughWithOne()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id, day: Monday);
        var to = SeedShift(db, mia.Id, null, day: Monday.AddDays(1));
        // Approved leave on the target's day: STAFF_ON_LEAVE, a warning that needs a reason.
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = sam.Id, LeaveType = LeaveType.Annual, StartDate = to.ServiceDate, EndDate = to.ServiceDate,
            Status = LeaveStatus.Approved, RequestedByUserId = sam.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
        var controller = Controller(db);

        var first = await controller.MoveStaff(Move(from, to, MoveStaffMode.Move), default);
        var findings = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(Assert.IsType<UnprocessableEntityObjectResult>(first.Result).Value).Data!;
        Assert.Contains(findings, f => f.Code == RosterConflictService.StaffOnLeave);
        Assert.Equal(sam.Id, (await Reload(db, from.Id)).UserId);

        Body(await controller.MoveStaff(Move(from, to, MoveStaffMode.Move, "Leave cancelled by phone", findings.Select(f => f.Code).ToList()), default));

        var landed = await Reload(db, to.Id);
        Assert.Equal(sam.Id, landed.UserId);
        Assert.Equal("Leave cancelled by phone", landed.OverrideReason);
        Assert.Null((await Reload(db, from.Id)).UserId);
    }

    [Fact]
    public async Task MoveStaff_MoveOntoATargetFilledSinceTheBoardLoaded_Is409AndChangesNothing()   // Review Focus 1
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var alex = SeedStaff(db, "Alex", "Ng");
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id, day: Monday);
        var to = SeedShift(db, mia.Id, alex.Id, day: Monday.AddDays(1));   // the page drew it as Needs staff; someone filled it since

        var result = await Controller(db).MoveStaff(Move(from, to, MoveStaffMode.Move), default);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(sam.Id, (await Reload(db, from.Id)).UserId);
        Assert.Equal(alex.Id, (await Reload(db, to.Id)).UserId);
    }

    [Theory]
    [InlineData(MoveStaffMode.Replace)]
    [InlineData(MoveStaffMode.Swap)]
    public async Task MoveStaff_ReplaceOrSwapWhenSomeoneElseIsOnTheTargetNow_Is409AndChangesNothing(MoveStaffMode mode)   // deep review S4
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var jack = SeedStaff(db, "Jack", "Oh");
        var jill = SeedStaff(db, "Jill", "Oh");
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id, day: Monday);
        var to = SeedShift(db, mia.Id, jill.Id, day: Monday.AddDays(1));   // the prompt said Jack is on it; Jill was put there since

        var result = await Controller(db).MoveStaff(Move(from, to, mode) with { ExpectedToStaffId = jack.Id }, default);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(sam.Id, (await Reload(db, from.Id)).UserId);
        Assert.Equal(jill.Id, (await Reload(db, to.Id)).UserId);
    }

    [Fact]
    public async Task MoveStaff_WhenSomeoneElseIsOnTheSourceNow_Is409AndChangesNothing()   // Review Focus 1: the source's side
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var jo = SeedStaff(db, "Jo", "Park");
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, jo.Id, day: Monday);              // the page carried Sam off it; Jo was put on since
        var to = SeedShift(db, mia.Id, null, day: Monday.AddDays(1));

        var result = await Controller(db).MoveStaff(Move(from, to, MoveStaffMode.Move) with { StaffId = sam.Id }, default);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(jo.Id, (await Reload(db, from.Id)).UserId);
        Assert.Null((await Reload(db, to.Id)).UserId);
    }

    [Theory]
    [InlineData(ShiftStatus.Completed, true)]
    [InlineData(ShiftStatus.InProgress, false)]
    public async Task MoveStaff_WhenEitherShiftIsLocked_Is409(ShiftStatus status, bool lockTheTarget)
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id, lockTheTarget ? ShiftStatus.Draft : status, day: Monday);
        var to = SeedShift(db, mia.Id, null, lockTheTarget ? status : ShiftStatus.Draft, day: Monday.AddDays(1));

        var result = await Controller(db).MoveStaff(Move(from, to, MoveStaffMode.Move), default);

        Assert.Equal(ShiftErrorCodes.ShiftStatusLocked, Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value).Code);
        Assert.Equal(sam.Id, (await Reload(db, from.Id)).UserId);
    }

    [Fact]
    public async Task MoveStaff_OntoAShiftOfAnotherOrganisation_Is404()
    {
        var dbName = Guid.NewGuid().ToString();
        var ours = Guid.NewGuid();
        Shift from, to;
        using (var mine = TestDb.ForTenant(dbName, ours)) from = SeedShift(mine, SeedParticipant(mine).Id, SeedStaff(mine).Id);
        using (var other = TestDb.ForTenant(dbName, Guid.NewGuid())) to = SeedShift(other, SeedParticipant(other).Id, null);
        using var db = TestDb.ForTenant(dbName, ours);

        var result = await Controller(db, ours).MoveStaff(Move(from, to, MoveStaffMode.Move), default);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        using var all = TestDb.Create(dbName);
        Assert.Null((await all.Shifts.SingleAsync(s => s.Id == to.Id)).UserId);
        Assert.NotNull((await all.Shifts.SingleAsync(s => s.Id == from.Id)).UserId);
    }

    // ── A person carried off a puck onto an empty day: the create and the move are one guarded save (deep review S6) ──

    private static CreateShiftDto NewShiftFor(Guid participantId, Guid staffId, DateOnly day, int startHour, int endHour, Guid? moveFrom) => new()
    {
        ParticipantId = participantId, StaffId = staffId, ServiceDate = day, StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, MoveFromShiftId = moveFrom,
    };

    [Fact]
    public async Task CreateShift_MovingThePersonOffAPublishedShift_CreatesItAndClearsTheSourceInOneSave_WithNoFalseDoubleBooking()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var mia = SeedParticipant(db);
        var jo = SeedParticipant(db, "Jo", "Park");
        var source = SeedShift(db, mia.Id, sam.Id, ShiftStatus.Published, startHour: 9, endHour: 15);

        // The same day and overlapping hours: judged as if Sam had already left the source, so no DOUBLE_BOOKED_SHIFT.
        var created = Body(await Controller(db).CreateShift(NewShiftFor(jo.Id, sam.Id, Monday, 10, 14, source.Id), default));

        Assert.Equal(sam.Id, created.StaffId);
        Assert.DoesNotContain(created.Findings, f => f.Code == RosterConflictService.DoubleBookedShift);
        Assert.Null((await Reload(db, source.Id)).UserId);
        Assert.Equal(new[] { (NotificationEventType.ShiftUnassigned, sam.Id) }, await Notices(db));   // the new shift is a Draft: silent
    }

    [Fact]
    public async Task CreateShift_MovingFromAShiftSomeoneElseIsOnNow_Is409AndCreatesNothing()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db);
        var jo = SeedStaff(db, "Jo", "Park");
        var mia = SeedParticipant(db);
        var source = SeedShift(db, mia.Id, jo.Id);   // the board carried Sam off it; Jo was put on since

        var result = await Controller(db).CreateShift(NewShiftFor(mia.Id, sam.Id, Monday.AddDays(1), 9, 15, source.Id), default);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(jo.Id, (await Reload(db, source.Id)).UserId);
        Assert.Equal(1, await db.Shifts.CountAsync());
    }

    // ── Publish week ──

    [Fact]
    public async Task PublishWeek_PublishesEveryDraftOfTheWeek_UnfilledToo_AndTellsEachWorker()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        using var db = TestDb.ForTenant(dbName, tenant);
        var sam = SeedStaff(db);
        var alex = SeedStaff(db, "Alex", "Ng");
        var mia = SeedParticipant(db);
        var jo = SeedParticipant(db, "Jo", "Park");
        var monday = SeedShift(db, mia.Id, sam.Id, ShiftStatus.Draft, day: Monday);
        var tuesday = SeedShift(db, jo.Id, null, ShiftStatus.Draft, day: Monday.AddDays(1));
        var sunday = SeedShift(db, mia.Id, sam.Id, ShiftStatus.Draft, day: Monday.AddDays(6), startHour: 16, endHour: 20);
        var alreadyOut = SeedShift(db, jo.Id, alex.Id, ShiftStatus.Published, day: Monday.AddDays(3));
        var cancelled = SeedShift(db, jo.Id, alex.Id, ShiftStatus.Cancelled, day: Monday.AddDays(4));
        var nextWeek = SeedShift(db, mia.Id, sam.Id, ShiftStatus.Draft, day: Monday.AddDays(7));

        // Any day of the week names the week: here, its Wednesday.
        var result = Body(await Controller(db, tenant).PublishWeek(Monday.AddDays(2), default));

        Assert.Equal(3, result.Published);
        Assert.Equal(1, result.Notified);        // Sam, on two shifts
        Assert.Equal(1, result.Unfilled);
        Assert.Equal(0, result.Skipped);
        foreach (var id in new[] { monday.Id, tuesday.Id, sunday.Id }) Assert.Equal(ShiftStatus.Published, (await Reload(db, id)).Status);
        Assert.Equal(ShiftStatus.Cancelled, (await Reload(db, cancelled.Id)).Status);
        Assert.Equal(ShiftStatus.Draft, (await Reload(db, nextWeek.Id)).Status);
        // One email for Sam, not one per shift (fix round 1), naming Monday and Sunday.
        Assert.Equal(new[] { (NotificationEventType.ShiftAssigned, sam.Id) }, await Notices(db));
        var payload = (await db.NotificationOutbox.SingleAsync()).PayloadJson;
        Assert.Contains("2026-08-24", payload);
        Assert.Contains("2026-08-30", payload);
        Assert.Contains("16:00", payload);
        _ = alreadyOut;   // already Published: nobody is told again
    }

    [Fact]
    public async Task PublishWeek_LeavesAnotherTenantsDraftsAlone()   // Review Focus 5
    {
        var dbName = Guid.NewGuid().ToString();
        var ours = Guid.NewGuid();
        Shift theirs;
        using (var other = TestDb.ForTenant(dbName, Guid.NewGuid())) theirs = SeedShift(other, SeedParticipant(other).Id, SeedStaff(other).Id, ShiftStatus.Draft);
        using var db = TestDb.ForTenant(dbName, ours);

        var result = Body(await Controller(db, ours).PublishWeek(Monday, default));

        Assert.Equal(0, result.Published);
        using var all = TestDb.Create(dbName);
        Assert.Equal(ShiftStatus.Draft, (await all.Shifts.SingleAsync(s => s.Id == theirs.Id)).Status);
        Assert.Empty(await all.NotificationOutbox.ToListAsync());
    }

    [Fact]
    public async Task PublishWeek_WithoutATenant_Is400()   // Review Focus 5: a SuperAdmin who has not chosen an organisation
    {
        using var db = TestDb.Create();
        var draft = SeedShift(db, SeedParticipant(db).Id, SeedStaff(db).Id, ShiftStatus.Draft);

        var result = await Controller(db).PublishWeek(Monday, default);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(ShiftStatus.Draft, (await Reload(db, draft.Id)).Status);
    }

    [Fact]
    public async Task PublishWeek_SkipsADraftWhoseWorkerIsBlocked_AndAParticipantTheBoardDoesNotShow()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        using var db = TestDb.ForTenant(dbName, tenant);
        var lapsed = SeedStaff(db, "Lee", "Kim", screeningValid: false);   // WSC_EXPIRED: Blocking
        var blocked = SeedShift(db, SeedParticipant(db).Id, lapsed.Id, ShiftStatus.Draft);
        var gone = SeedParticipant(db, "Ivy", "Hall");
        gone.IsActive = false;                                              // not on the board, so not published
        db.SaveChanges();
        var hidden = SeedShift(db, gone.Id, null, ShiftStatus.Draft);

        var result = Body(await Controller(db, tenant).PublishWeek(Monday, default));

        Assert.Equal(0, result.Published);
        Assert.Equal(1, result.Skipped);
        Assert.Equal(ShiftStatus.Draft, (await Reload(db, blocked.Id)).Status);
        Assert.Equal(ShiftStatus.Draft, (await Reload(db, hidden.Id)).Status);
        Assert.Empty(await Notices(db));
    }

    [Fact]
    public async Task PublishWeek_SkipsOnlyTheDraftsAfterTheWorkersScreeningLapses()   // S3: the expiry is compared with each shift's own day
    {
        var dbName = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        using var db = TestDb.ForTenant(dbName, tenant);
        var lee = SeedStaff(db, "Lee", "Kim");
        lee.WorkerScreeningExpiryDate = Monday.AddDays(2);                  // lapses on Wednesday
        db.SaveChanges();
        var mia = SeedParticipant(db);
        var monday = SeedShift(db, mia.Id, lee.Id, ShiftStatus.Draft, day: Monday);
        var friday = SeedShift(db, mia.Id, lee.Id, ShiftStatus.Draft, day: Monday.AddDays(4));

        var result = Body(await Controller(db, tenant).PublishWeek(Monday, default));

        Assert.Equal(1, result.Published);
        Assert.Equal(1, result.Skipped);
        Assert.Equal(ShiftStatus.Published, (await Reload(db, monday.Id)).Status);
        Assert.Equal(ShiftStatus.Draft, (await Reload(db, friday.Id)).Status);
    }

    [Fact]
    public async Task PublishWeek_PublishesDraftsBeforeToday_ButTellsOnlyTheWorkersOfTodayOn()   // N7
    {
        var dbName = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        using var db = TestDb.ForTenant(dbName, tenant);
        var sam = SeedStaff(db);
        var mia = SeedParticipant(db);
        var monday = SeedShift(db, mia.Id, sam.Id, ShiftStatus.Draft, day: Monday);
        var thursday = SeedShift(db, mia.Id, sam.Id, ShiftStatus.Draft, day: Monday.AddDays(3));
        // Wednesday 26 August, midday in every Australian zone: Monday has gone, Thursday has not.
        var wednesday = new FixedClock(new DateTimeOffset(2026, 8, 26, 2, 0, 0, TimeSpan.Zero));

        var result = Body(await Controller(db, tenant, wednesday).PublishWeek(Monday, default));

        Assert.Equal(2, result.Published);
        Assert.Equal(1, result.Notified);
        Assert.Equal(ShiftStatus.Published, (await Reload(db, monday.Id)).Status);
        Assert.Equal(thursday.Id, (await db.NotificationOutbox.SingleAsync()).EntityId);
    }
}
