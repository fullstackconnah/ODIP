using Microsoft.AspNetCore.Mvc;
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
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// GET /rostering/board narrowed to one person (spec 2026-10-28, the roster week on a profile): staffId with groupBy=staff,
/// participantId with groupBy=participant. Rows narrow; findings are still computed against the whole week.
/// </summary>
public class RosterBoardPersonFilterTests
{
    // A Monday: the week is 2026-08-24 to 2026-08-30.
    private static readonly DateOnly Monday = new(2026, 8, 24);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private static readonly TimeProvider BeforeTheWeek = new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero));

    private static RosteringController Controller(OdipDbContext db, Guid? tenantId = null)
    {
        ICurrentTenant? tenant = null;
        if (tenantId is { } id)
        {
            var mock = new Mock<ICurrentTenant>();
            mock.Setup(t => t.TenantId).Returns(id);
            mock.Setup(t => t.IsSuperAdmin).Returns(false);
            tenant = mock.Object;
        }
        return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: BeforeTheWeek, tenant: tenant);
    }

    // Copied from RosterBoardDragDropTests: the async save is the one that stamps TenantId on a tenant context.
    private static User SeedStaff(OdipDbContext db, string first = "Sam", string last = "Wilson", bool screeningValid = true, bool active = true)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), FirstName = first, LastName = last, Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = active,
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = screeningValid ? new DateOnly(2030, 1, 1) : new DateOnly(2020, 1, 1),
        };
        db.Users.Add(user);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return user;
    }

    private static Participant SeedParticipant(OdipDbContext db, string first = "Mia", string last = "Chen", bool draft = false)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = first, LastName = last, IsActive = true, IsDraft = draft };
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

    private static TripInstance SeedTrip(OdipDbContext db)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripCode = "BLUE", TripName = "Blue Mountains", StartDate = Monday.AddDays(2), DurationDays = 3 };
        db.TripInstances.Add(trip);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return trip;
    }

    private static RosterBoardDto Body(ActionResult<ApiResponse<RosterBoardDto>> result) =>
        Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static async Task<RosterBoardDto> Board(OdipDbContext db, string groupBy, Guid? staffId = null, Guid? participantId = null, Guid? tenantId = null) =>
        Body(await Controller(db, tenantId).GetBoard(Monday, groupBy, CancellationToken.None, staffId, participantId));

    [Fact]
    public async Task StaffFilter_ReturnsOnlyThatStaffRow_AndNoUnfilledLane()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var a = SeedStaff(db, "Alex", "Rivera");
        var b = SeedStaff(db, "Bea", "Stone");
        var aShift = SeedShift(db, p.Id, a.Id);
        SeedShift(db, p.Id, b.Id, day: Monday.AddDays(1));
        SeedShift(db, p.Id, null, day: Monday.AddDays(2));

        var board = await Board(db, "staff", staffId: a.Id);

        var row = Assert.Single(board.StaffRows!);
        Assert.Equal(a.Id, row.StaffId);
        Assert.Equal(aShift.Id, Assert.Single(row.Shifts).Id);
        Assert.NotNull(board.Unfilled);
        Assert.Empty(board.Unfilled!);
        Assert.Equal(RosterBoardGroupBy.Staff, board.GroupBy);
        Assert.Equal(7, board.Days.Count);
    }

    [Fact]
    public async Task StaffFilter_KeepsLeaveTripBarsAndHours()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var a = SeedStaff(db, "Alex", "Rivera");
        SeedStaff(db, "Bea", "Stone");
        SeedShift(db, p.Id, a.Id, ShiftStatus.Published, startHour: 9, endHour: 15);
        SeedShift(db, p.Id, a.Id, ShiftStatus.Cancelled, day: Monday.AddDays(1), startHour: 9, endHour: 13);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = a.Id, LeaveType = LeaveType.Annual, StartDate = Monday.AddDays(5), EndDate = Monday.AddDays(6),
            Status = LeaveStatus.Approved, RequestedByUserId = a.Id, RequestedAt = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
        });
        var trip = SeedTrip(db);
        db.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = a.Id,
            AssignmentStart = trip.StartDate, AssignmentEnd = trip.StartDate.AddDays(2), Status = AssignmentStatus.Confirmed
        });
        await db.SaveChangesAsync();

        var all = (await Board(db, "staff")).StaffRows!.Single(r => r.StaffId == a.Id);
        var row = Assert.Single((await Board(db, "staff", staffId: a.Id)).StaffRows!);

        Assert.NotEmpty(row.Leave);
        Assert.Equal(all.Leave.Select(l => (l.StartDate, l.EndDate, l.Kind)), row.Leave.Select(l => (l.StartDate, l.EndDate, l.Kind)));
        Assert.NotEmpty(row.TripBars);
        Assert.Equal(all.TripBars.Select(t => (t.TripInstanceId, t.StartDate, t.EndDate)), row.TripBars.Select(t => (t.TripInstanceId, t.StartDate, t.EndDate)));
        Assert.Equal(6m, row.RosteredHours);   // the Cancelled 4 h shift is excluded
        Assert.Equal(all.TargetHours, row.TargetHours);
    }

    [Fact]
    public async Task ParticipantFilter_FindingsStillSeeOtherParticipantsShifts()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db, "Mia", "Chen");
        var q = SeedParticipant(db, "Quinn", "Ash");
        var a = SeedStaff(db, "Alex", "Rivera");
        var pShift = SeedShift(db, p.Id, a.Id, startHour: 9, endHour: 15);
        SeedShift(db, q.Id, a.Id, startHour: 10, endHour: 14);   // overlaps: A is double-booked

        var unfiltered = (await Board(db, "participant")).ParticipantRows!.Single(r => r.ParticipantId == p.Id).Shifts.Single(s => s.Id == pShift.Id);
        var filtered = Assert.Single((await Board(db, "participant", participantId: p.Id)).ParticipantRows!).Shifts.Single(s => s.Id == pShift.Id);

        Assert.Contains(filtered.Findings, f => f.Code == RosterConflictService.DoubleBookedShift);
        Assert.Equal(unfiltered.Findings.Select(f => f.Code).OrderBy(c => c), filtered.Findings.Select(f => f.Code).OrderBy(c => c));
    }

    [Fact]
    public async Task ParticipantFilter_ReturnsOnlyThatRow_WithUnfilledInline()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db, "Mia", "Chen");
        var q = SeedParticipant(db, "Quinn", "Ash");
        var a = SeedStaff(db);
        SeedShift(db, p.Id, a.Id);
        SeedShift(db, p.Id, null, day: Monday.AddDays(1));
        SeedShift(db, q.Id, a.Id, day: Monday.AddDays(2));
        var trip = SeedTrip(db);
        db.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = p.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = Monday });
        await db.SaveChangesAsync();

        var all = (await Board(db, "participant")).ParticipantRows!.Single(r => r.ParticipantId == p.Id);
        var row = Assert.Single((await Board(db, "participant", participantId: p.Id)).ParticipantRows!);

        Assert.Equal(p.Id, row.ParticipantId);
        Assert.Equal(2, row.Shifts.Count);
        Assert.Single(row.Shifts, s => s.StaffId is null);
        Assert.NotEmpty(row.TripBars);
        Assert.Equal(all.TripBars.Select(t => t.TripInstanceId), row.TripBars.Select(t => t.TripInstanceId));
    }

    [Fact]
    public async Task Filter_NarrowsExceptionsToThePersonsShifts()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var a = SeedStaff(db, "Alex", "Rivera");
        var b = SeedStaff(db, "Bea", "Stone", screeningValid: false);   // WSC_EXPIRED on B's shift
        SeedShift(db, p.Id, a.Id);
        var bShift = SeedShift(db, p.Id, b.Id, day: Monday.AddDays(1));

        Assert.Contains((await Board(db, "staff")).Exceptions, e => e.ShiftId == bShift.Id);   // the finding exists unfiltered
        Assert.DoesNotContain((await Board(db, "staff", staffId: a.Id)).Exceptions, e => e.ShiftId == bShift.Id);
    }

    [Fact]
    public async Task StaffFilter_InactiveUser_ReturnsNoRow_Ok()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var gone = SeedStaff(db, active: false);
        SeedShift(db, p.Id, null);

        var board = await Board(db, "staff", staffId: gone.Id);

        Assert.Empty(board.StaffRows!);
        Assert.Empty(board.Unfilled!);
    }

    [Fact]
    public async Task ParticipantFilter_DraftParticipant_ReturnsNoRow_Ok()
    {
        using var db = TestDb.Create();
        var draft = SeedParticipant(db, draft: true);

        Assert.Empty((await Board(db, "participant", participantId: draft.Id)).ParticipantRows!);
    }

    [Theory]
    [InlineData("staff")]
    [InlineData("participant")]
    public async Task Filter_UnknownId_ReturnsNoRow_Ok(string groupBy)
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var a = SeedStaff(db);
        SeedShift(db, p.Id, a.Id);

        var board = groupBy == "staff"
            ? await Board(db, groupBy, staffId: Guid.NewGuid())
            : await Board(db, groupBy, participantId: Guid.NewGuid());

        Assert.Empty((IEnumerable<object>?)board.StaffRows ?? board.ParticipantRows!);
        Assert.Empty(board.Exceptions);
    }

    [Fact]
    public async Task StaffFilter_AnotherTenantsUser_ReturnsNoRow()
    {
        var dbName = Guid.NewGuid().ToString();
        var ours = Guid.NewGuid();
        User x;
        Shift theirShift;
        using (var other = TestDb.ForTenant(dbName, Guid.NewGuid()))
        {
            x = SeedStaff(other, "Xan", "Other", screeningValid: false);   // a finding, so an Exceptions leak would show
            theirShift = SeedShift(other, SeedParticipant(other).Id, x.Id);
            SeedShift(other, SeedParticipant(other, "Zed", "Other").Id, null, day: Monday.AddDays(1));
        }
        User me;
        using (var ourDb = TestDb.ForTenant(dbName, ours))
        {
            me = SeedStaff(ourDb, "Alex", "Rivera");
            SeedShift(ourDb, SeedParticipant(ourDb).Id, me.Id);
        }
        using var db = TestDb.ForTenant(dbName, ours);

        var theirs = await Board(db, "staff", staffId: x.Id, tenantId: ours);
        Assert.Empty(theirs.StaffRows!);
        Assert.Empty(theirs.Unfilled!);
        Assert.DoesNotContain(theirs.Exceptions, e => e.ShiftId == theirShift.Id);

        // Positive control in the same database: our own staff member's row comes back.
        Assert.Equal(me.Id, Assert.Single((await Board(db, "staff", staffId: me.Id, tenantId: ours)).StaffRows!).StaffId);
    }

    [Fact]
    public async Task ParticipantFilter_AnotherTenantsParticipant_ReturnsNoRow()
    {
        var dbName = Guid.NewGuid().ToString();
        var ours = Guid.NewGuid();
        Participant y;
        Shift theirShift;
        using (var other = TestDb.ForTenant(dbName, Guid.NewGuid()))
        {
            y = SeedParticipant(other, "Yara", "Other");
            theirShift = SeedShift(other, y.Id, SeedStaff(other, "Xan", "Other", screeningValid: false).Id);
        }
        Participant mine;
        using (var ourDb = TestDb.ForTenant(dbName, ours))
        {
            mine = SeedParticipant(ourDb);
            SeedShift(ourDb, mine.Id, SeedStaff(ourDb).Id);
        }
        using var db = TestDb.ForTenant(dbName, ours);

        var theirs = await Board(db, "participant", participantId: y.Id, tenantId: ours);
        Assert.Empty(theirs.ParticipantRows!);
        Assert.DoesNotContain(theirs.Exceptions, e => e.ShiftId == theirShift.Id);

        Assert.Equal(mine.Id, Assert.Single((await Board(db, "participant", participantId: mine.Id, tenantId: ours)).ParticipantRows!).ParticipantId);
    }

    [Theory]
    [InlineData("participant", true, false, "staffId needs groupBy=staff.")]
    [InlineData("staff", false, true, "participantId needs groupBy=participant.")]
    [InlineData("staff", true, true, "Pass staffId or participantId, not both.")]
    public async Task Filter_MismatchedGroupBy_Returns400(string groupBy, bool withStaff, bool withParticipant, string message)
    {
        using var db = TestDb.Create();

        var result = await Controller(db).GetBoard(Monday, groupBy, CancellationToken.None,
            withStaff ? Guid.NewGuid() : null, withParticipant ? Guid.NewGuid() : null);

        var body = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.False(body.Success);
        Assert.Equal(message, Assert.Single(body.Errors!));
    }

    [Fact]
    public async Task Filter_None_ResponseUnchanged()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var a = SeedStaff(db, "Alex", "Rivera");
        var b = SeedStaff(db, "Bea", "Stone");
        SeedShift(db, p.Id, a.Id);
        SeedShift(db, p.Id, b.Id, day: Monday.AddDays(1));
        SeedShift(db, p.Id, null, day: Monday.AddDays(2));

        var board = await Board(db, "staff");

        Assert.Equal(2, board.StaffRows!.Count);
        Assert.Single(board.Unfilled!);
    }
}
