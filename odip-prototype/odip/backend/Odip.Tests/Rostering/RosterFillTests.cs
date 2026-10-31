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
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>GET api/v1/rostering/fill: how full the next weeks are (spec 2026-10-31). Open = no worker and not Cancelled.</summary>
public class RosterFillTests
{
    // Monday 2 Nov 2026. FakeClock noon UTC that day is 23:00 in Sydney, the same date.
    private static readonly DateOnly Monday = new(2026, 11, 2);
    private static FakeClock Noon() => FakeClock.AtUtc(2026, 11, 2, 12, 0);

    private static RosteringController Controller(OdipDbContext db, FakeClock? clock = null) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: clock ?? Noon());

    private static Shift Add(OdipDbContext db, DateOnly date, bool assigned, ShiftStatus status = ShiftStatus.Published,
        string start = "09:00", string end = "17:00", bool endsNextDay = false, Guid? participantId = null)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId ?? Guid.NewGuid(), UserId = assigned ? Guid.NewGuid() : null,
            ServiceDate = date, StartTime = TimeOnly.Parse(start), EndTime = TimeOnly.Parse(end), EndsNextDay = endsNextDay,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status
        };
        db.Shifts.Add(shift);
        db.SaveChanges();
        return shift;
    }

    private static async Task<RosterFillDto> Fill(RosteringController c, int? weeks = null)
    {
        var result = await c.GetFill(weeks, CancellationToken.None);
        return Assert.IsType<ApiResponse<RosterFillDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    [Fact]
    public async Task GetFill_CancelledShift_IsNotCounted()
    {
        using var db = TestDb.Create();
        Add(db, Monday, assigned: false, ShiftStatus.Cancelled);
        Add(db, Monday, assigned: true, ShiftStatus.Cancelled);

        var week = (await Fill(Controller(db))).Weeks[0];

        Assert.Equal(0, week.Shifts);
        Assert.Equal(0, week.Open);
        Assert.Equal(0, week.Filled);
        Assert.Equal(0m, week.HoursOpen + week.HoursFilled);
        Assert.Equal(0, week.Draft);
    }

    [Fact]
    public async Task GetFill_OpenMatchesBoardUnfilled_ForTheSameWeek()
    {
        using var db = TestDb.Create();
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        Add(db, Monday, assigned: false, ShiftStatus.Draft, participantId: participant.Id);
        Add(db, Monday.AddDays(1), assigned: false, ShiftStatus.Draft, participantId: participant.Id);
        Add(db, Monday.AddDays(2), assigned: false, ShiftStatus.Published, participantId: participant.Id);
        Add(db, Monday.AddDays(3), assigned: true, ShiftStatus.Published, participantId: participant.Id);
        Add(db, Monday.AddDays(4), assigned: false, ShiftStatus.Cancelled, participantId: participant.Id);
        var controller = Controller(db);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>((await controller.GetBoard(Monday, "staff", CancellationToken.None)).Result).Value).Data!;
        var week = (await Fill(controller)).Weeks[0];

        // The board's unfilled lane keeps the struck-through Cancelled chip; the chart leaves it out: exactly that one chip differs.
        Assert.Equal(4, board.Unfilled!.Count);
        Assert.Equal(board.Unfilled.Count(s => s.Status != ShiftStatus.Cancelled), week.Open);
        Assert.Equal(3, week.Open);
        Assert.Equal(4, week.Shifts);
        Assert.Equal(1, week.Filled);
    }

    [Fact]
    public async Task GetFill_BucketsByProviderMonday_NotUtcDate()
    {
        using var db = TestDb.Create();
        // Sunday 1 Nov 14:00 UTC is Monday 2 Nov 01:00 in Sydney (no provider state: the zone falls back to Sydney).
        var clock = FakeClock.AtUtc(2026, 11, 1, 14, 0);
        Add(db, new DateOnly(2026, 11, 1), assigned: true);
        Add(db, new DateOnly(2026, 11, 8), assigned: true);
        Add(db, new DateOnly(2026, 11, 9), assigned: true);

        var fill = await Fill(Controller(db, clock));

        Assert.Equal(Monday, fill.Today);
        Assert.Equal(Monday, fill.Weeks[0].WeekStart);
        Assert.Equal(1, fill.Weeks[0].Shifts);
        Assert.Equal(1, fill.Weeks[1].Shifts);
    }

    [Fact]
    public async Task GetFill_HoursSplitFilledAndOpen_IncludingOvernight()
    {
        using var db = TestDb.Create();
        Add(db, Monday, assigned: false, start: "22:00", end: "06:00", endsNextDay: true);
        Add(db, Monday, assigned: true, start: "09:00", end: "12:30");

        var week = (await Fill(Controller(db))).Weeks[0];

        Assert.Equal(8m, week.HoursOpen);
        Assert.Equal(3.5m, week.HoursFilled);
    }

    [Fact]
    public async Task GetFill_DraftCountsFilledAndOpen()
    {
        using var db = TestDb.Create();
        Add(db, Monday, assigned: true, ShiftStatus.Draft);
        Add(db, Monday, assigned: false, ShiftStatus.Draft);
        Add(db, Monday, assigned: true, ShiftStatus.Published);

        Assert.Equal(2, (await Fill(Controller(db))).Weeks[0].Draft);
    }

    [Theory]
    [InlineData(1, 4)]
    [InlineData(20, 8)]
    [InlineData(null, 8)]
    [InlineData(6, 6)]
    public async Task GetFill_WeeksClamped(int? asked, int expected)
    {
        using var db = TestDb.Create();

        var weeks = (await Fill(Controller(db), asked)).Weeks;

        Assert.Equal(expected, weeks.Count);
        Assert.Equal(Enumerable.Range(0, expected).Select(i => Monday.AddDays(7 * i)), weeks.Select(w => w.WeekStart));
    }

    [Fact]
    public async Task GetFill_EmptyRange_ReturnsEveryWeekAsZeros()
    {
        using var db = TestDb.Create();

        var weeks = (await Fill(Controller(db))).Weeks;

        Assert.Equal(8, weeks.Count);
        Assert.All(weeks, w => Assert.Equal((0, 0, 0, 0, 0m, 0m), (w.Shifts, w.Filled, w.Open, w.Draft, w.HoursFilled, w.HoursOpen)));
    }

    [Fact]
    public async Task GetFill_OtherTenantsShifts_AreNotCounted()
    {
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        // SaveChanges stamps TenantId from the ambient tenant, as in RosteringControllerTests' other-tenant idiom.
        foreach (var (tenant, count) in new[] { (tenantB, 3), (tenantA, 1) })
        {
            var ambient = new Mock<ICurrentTenant>();
            ambient.Setup(t => t.TenantId).Returns(tenant);
            ambient.Setup(t => t.IsSuperAdmin).Returns(false);
            using var seed = new OdipDbContext(options, ambient.Object);
            for (var i = 0; i < count; i++) Add(seed, Monday, assigned: false);
        }
        var reader = new Mock<ICurrentTenant>();
        reader.Setup(t => t.TenantId).Returns(tenantA);
        reader.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(options, reader.Object);

        Assert.Equal(1, (await Fill(Controller(db))).Weeks[0].Shifts);
    }
}
