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
/// CASUAL_FORTNIGHT_HOURS through the controller (R6): the board chip and the assign write see hours that sit in the other week of the fortnight. The fortnight 26 Oct to 8 Nov 2026
/// is the one the plan pins: week one 26 Oct to 1 Nov holds the earlier hours, the candidate falls on Monday 2 Nov.
/// </summary>
public class RosterCasualFortnightTests
{
    private static readonly DateOnly WeekOne = new(2026, 10, 26);
    private static readonly DateOnly WeekTwo = new(2026, 11, 2);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

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
        return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db),
            clock: new FixedClock(new DateTimeOffset(2026, 10, 20, 0, 0, 0, TimeSpan.Zero)), tenant: tenant);
    }

    private static User SeedStaff(OdipDbContext db, EmploymentType? type, Guid? id = null)
    {
        var user = new User
        {
            Id = id ?? Guid.NewGuid(), FirstName = "Sam", LastName = "Lee", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, EmploymentType = type,
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        };
        db.Users.Add(user);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return user;
    }

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Mia", LastName = "Chen", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return participant;
    }

    private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid? userId, DateOnly day, int hours, ShiftStatus status = ShiftStatus.Draft)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, UserId = userId, ServiceDate = day,
            StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(8 + hours, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
        };
        db.Shifts.Add(shift);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return shift;
    }

    /// <summary>70 hours across week one: seven 10-hour days.</summary>
    private static void SeedSeventyHours(OdipDbContext db, Guid participantId, Guid userId)
    {
        for (var i = 0; i < 7; i++) SeedShift(db, participantId, userId, WeekOne.AddDays(i), 10);
    }

    private static async Task<RosterBoardDto> Board(OdipDbContext db, Guid? tenantId = null) =>
        Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(
            (await Controller(db, tenantId).GetBoard(WeekTwo, "staff", CancellationToken.None, null, null)).Result).Value).Data!;

    private static IEnumerable<string> CodesOn(RosterBoardDto board, Guid shiftId) =>
        board.StaffRows!.SelectMany(r => r.Shifts).Single(s => s.Id == shiftId).Findings.Select(f => f.Code);

    [Fact]
    public async Task Board_chip_warns_when_the_other_week_of_the_fortnight_holds_the_hours_and_the_weekly_meter_is_unchanged()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var sam = SeedStaff(db, EmploymentType.Casual);
        SeedSeventyHours(db, p.Id, sam.Id);
        var candidate = SeedShift(db, p.Id, sam.Id, WeekTwo, 8);   // 78h in the fortnight

        var board = await Board(db);

        Assert.Contains(RosterConflictService.CasualFortnightHours, CodesOn(board, candidate.Id));
        Assert.DoesNotContain(RosterConflictService.OverHours, CodesOn(board, candidate.Id));   // this week alone is 8h
        Assert.Equal(8m, board.StaffRows!.Single(r => r.StaffId == sam.Id).RosteredHours);
    }

    [Fact]
    public async Task Board_chip_is_silent_at_exactly_76_hours_and_for_workers_who_are_not_casual()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var exact = SeedStaff(db, EmploymentType.Casual);
        SeedSeventyHours(db, p.Id, exact.Id);
        var exactShift = SeedShift(db, p.Id, exact.Id, WeekTwo, 6);   // 76h
        var fullTime = SeedStaff(db, EmploymentType.FullTime);
        SeedSeventyHours(db, p.Id, fullTime.Id);
        var fullTimeShift = SeedShift(db, p.Id, fullTime.Id, WeekTwo, 8);
        var unset = SeedStaff(db, null);
        SeedSeventyHours(db, p.Id, unset.Id);
        var unsetShift = SeedShift(db, p.Id, unset.Id, WeekTwo, 8);

        var board = await Board(db);

        Assert.DoesNotContain(RosterConflictService.CasualFortnightHours, CodesOn(board, exactShift.Id));
        Assert.DoesNotContain(RosterConflictService.CasualFortnightHours, CodesOn(board, fullTimeShift.Id));
        Assert.DoesNotContain(RosterConflictService.CasualFortnightHours, CodesOn(board, unsetShift.Id));
    }

    [Fact]
    public async Task Board_chip_ignores_another_organisations_shifts_for_the_same_user_id()
    {
        var ours = Guid.NewGuid();
        var theirs = Guid.NewGuid();
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        using (var other = TestDb.ForTenant(dbName, theirs))
        {
            var theirParticipant = SeedParticipant(other);
            SeedSeventyHours(other, theirParticipant.Id, userId);
        }

        using var db = TestDb.ForTenant(dbName, ours);
        var p = SeedParticipant(db);
        SeedStaff(db, EmploymentType.Casual, userId);
        var candidate = SeedShift(db, p.Id, userId, WeekTwo, 8);

        var board = await Board(db, ours);

        Assert.DoesNotContain(RosterConflictService.CasualFortnightHours, CodesOn(board, candidate.Id));
    }

    [Fact]
    public async Task Assign_to_a_casual_over_the_limit_saves_and_returns_the_warning()
    {
        using var db = TestDb.Create();
        var p = SeedParticipant(db);
        var sam = SeedStaff(db, EmploymentType.Casual);
        SeedSeventyHours(db, p.Id, sam.Id);
        var open = SeedShift(db, p.Id, null, WeekTwo, 8);

        var result = await Controller(db).AssignShift(open.Id, new AssignShiftDto { StaffId = sam.Id }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var warning = Assert.Single(body.Findings, f => f.Code == RosterConflictService.CasualFortnightHours);
        Assert.False(warning.RequiresReason);
        Assert.Equal("Sam Lee is casual and would have 78h in the fortnight 26 Oct to 8 Nov 2026, over the 76h limit.", warning.Message);
        Assert.Equal(sam.Id, (await db.Shifts.SingleAsync(s => s.Id == open.Id)).UserId);
    }
}
