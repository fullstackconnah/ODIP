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
        db.SaveChanges();
        return user;
    }

    private static Participant SeedParticipant(OdipDbContext db, string first = "Mia", string last = "Chen")
    {
        // Active and not a draft: can receive services, so Warn-mode readiness lets a placement through.
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = first, LastName = last, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
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
        db.SaveChanges();
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
}
