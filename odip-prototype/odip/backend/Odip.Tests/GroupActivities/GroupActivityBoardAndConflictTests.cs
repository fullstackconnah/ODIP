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
using Xunit;

namespace Odip.Tests.GroupActivities;

public class GroupActivityConflictTests
{
    private static async Task<ActionResult<ApiResponse<GroupActivityDto>>> AddWorker(GroupActivityFixture fx, Guid activityId, Guid userId, string role, string? reason = null) =>
        await fx.Controller(role: role).AddStaff(activityId, new AddGroupStaffDto { StaffId = userId, OverrideReason = reason }, default);

    private static List<string> Codes(ActionResult<ApiResponse<GroupActivityDto>> result) =>
        Assert.IsType<ApiResponse<List<RosterFindingDto>>>(Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value).Data!.Select(f => f.Code).ToList();

    [Fact]
    public async Task AddStaff_BookedOnAnOrdinaryShiftAtTheSameTime_IsRefusedForACoordinator_AndNeedsAReasonFromAnAdmin()
    {
        var fx = new GroupActivityFixture();
        var worker = fx.AddUser();
        fx.AddShift(fx.AddParticipant(), userId: worker.Id, startHour: 10, endHour: 11);
        var activity = fx.AddActivity();
        Assert.Contains(RosterConflictService.DoubleBookedShift, Codes(await AddWorker(fx, activity.Id, worker.Id, "Coordinator")));
        Assert.Contains(RosterConflictService.DoubleBookedShift, Codes(await AddWorker(fx, activity.Id, worker.Id, "Admin")));
        Assert.Empty(fx.Seed.GroupActivityStaff);
        var saved = GroupActivityFixture.Body(await AddWorker(fx, activity.Id, worker.Id, "Admin", "Covering a gap"), 200);
        Assert.Single(saved.Staff);
        var row = await fx.Seed.GroupActivityStaff.AsNoTracking().SingleAsync();
        Assert.Equal("Covering a gap", row.OverrideReason);
        Assert.Contains(RosterConflictService.DoubleBookedShift, row.AcknowledgedFindingCodes);
    }

    [Fact]
    public async Task TwoActivitiesAtTheSameTime_CannotShareAWorker()
    {
        var fx = new GroupActivityFixture();
        var worker = fx.AddUser();
        GroupActivityFixture.Body(await AddWorker(fx, fx.AddActivity().Id, worker.Id, "Coordinator"), 200);
        var second = fx.AddActivity();
        Assert.Contains(RosterConflictService.DoubleBookedShift, Codes(await AddWorker(fx, second.Id, worker.Id, "Coordinator")));
        Assert.Equal(1, await fx.Seed.GroupActivityStaff.CountAsync());
    }

    [Fact]
    public async Task AnOrdinaryShift_SeesTheWorkersActivityRowAsBusy()
    {
        var fx = new GroupActivityFixture();
        var worker = fx.AddUser();
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await AddWorker(fx, fx.AddActivity().Id, worker.Id, "Coordinator"), 200);
        var db = fx.Fresh();
        var snapshot = await new RosterAvailability(db, new StaffUnavailabilityQuery(db)).LoadAsync([worker.Id], [p.Id], GroupActivityFixture.Day, GroupActivityFixture.Day, default);
        var candidate = new Shift { Id = Guid.NewGuid(), TenantId = fx.TenantId, ParticipantId = p.Id, UserId = worker.Id, ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(11, 0) };
        Assert.Contains(snapshot.Check(candidate, callerIsAdmin: false), f => f.Code == RosterConflictService.DoubleBookedShift);
    }

    [Fact]
    public async Task ReadingAnActivity_WarnsWhileItIsShortOfStaff_AndStopsOnceItIsNot()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var dto = GroupActivityFixture.Body(await fx.Controller().AddParticipant(a.Id, new AddGroupParticipantDto { ParticipantId = fx.AddParticipant().Id, Ratio = SupportRatio.OneToOne }, default), 200);
        Assert.Contains(dto.Findings, f => f.Code == RosterConflictService.ActivityStaffShort);
        dto = GroupActivityFixture.Body(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = fx.AddUser().Id }, default), 200);
        Assert.DoesNotContain(dto.Findings, f => f.Code == RosterConflictService.ActivityStaffShort);
    }

    [Fact]
    public async Task AGroupShift_NeverRaisesTheRatioShortfall()
    {
        var fx = new GroupActivityFixture();
        var worker = fx.AddUser();
        var p = fx.AddParticipant();
        var db = fx.Fresh();
        var snapshot = await new RosterAvailability(db, new StaffUnavailabilityQuery(db)).LoadAsync([worker.Id], [p.Id], GroupActivityFixture.Day, GroupActivityFixture.Day, default);
        var candidate = new Shift
        {
            Id = Guid.NewGuid(), TenantId = fx.TenantId, ParticipantId = p.Id, UserId = worker.Id, ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(11, 0),
            Ratio = SupportRatio.TwoToOne, GroupActivityId = Guid.NewGuid(),
        };
        Assert.DoesNotContain(snapshot.Check(candidate, callerIsAdmin: false), f => f.Code == RosterConflictService.RatioShortfall);
    }
}

public class GroupActivityBoardTests
{
    private static readonly DateOnly Monday = GroupActivityFixture.Day;

    private static RosteringController Rostering(GroupActivityFixture fx, OdipDbContext db)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(fx.TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), tenant: tenant.Object);
    }

    private static RosterBoardDto Board(ActionResult<ApiResponse<RosterBoardDto>> result) =>
        Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static async Task<(GroupActivityFixture Fx, GroupActivity Activity, Shift Shift)> Seeded(bool enabled = true, ShiftStatus status = ShiftStatus.Draft)
    {
        var fx = new GroupActivityFixture(enabled);
        var activity = fx.AddActivity(status);
        var shift = fx.AddShift(fx.AddParticipant(), status: status);
        var worker = fx.AddUser();
        shift.GroupActivityId = activity.Id;
        fx.Seed.GroupActivityStaff.Add(new GroupActivityStaff { Id = Guid.NewGuid(), TenantId = fx.TenantId, GroupActivityId = activity.Id, UserId = worker.Id, StartTime = activity.StartTime, EndTime = activity.EndTime });
        await fx.Seed.SaveChangesAsync();
        return (fx, activity, shift);
    }

    [Fact]
    public async Task Board_FlagOn_ListsTheWeeksActivities_AndMarksTheirShifts_WithoutSavingAnything()
    {
        var (fx, activity, shift) = await Seeded();
        var board = Board(await Rostering(fx, fx.Fresh()).GetBoard(Monday, "participant", default));
        Assert.True(board.GroupActivitiesEnabled);
        Assert.Equal(activity.Id, Assert.Single(board.GroupActivities).Id);
        var dto = board.ParticipantRows!.SelectMany(r => r.Shifts).Single(s => s.Id == shift.Id);
        Assert.Equal(activity.Id, dto.GroupActivityId);
        Assert.True(dto.IsGroupLine);
        Assert.Equal(1, await fx.Seed.Shifts.CountAsync());
        Assert.Equal(1, await fx.Seed.GroupActivityStaff.CountAsync());
    }

    [Fact]
    public async Task Board_FlagOff_CarriesNoActivities()
    {
        var (fx, _, _) = await Seeded(enabled: false);
        var board = Board(await Rostering(fx, fx.Fresh()).GetBoard(Monday, "participant", default));
        Assert.False(board.GroupActivitiesEnabled);
        Assert.Empty(board.GroupActivities);
    }

    [Fact]
    public async Task Board_LeavesACancelledActivityOut()
    {
        var (fx, activity, _) = await Seeded();
        (await fx.Seed.GroupActivities.SingleAsync()).Status = ShiftStatus.Cancelled;
        await fx.Seed.SaveChangesAsync();
        Assert.Empty(Board(await Rostering(fx, fx.Fresh()).GetBoard(Monday, "participant", default)).GroupActivities);
    }

    [Fact]
    public async Task Fill_GroupLines_AreNeverOpen_AndCountAsFilledOnceTheActivityHasAWorker()
    {
        var (fx, _, _) = await Seeded();
        var week = (await RosterFill.WeeksAsync(fx.Fresh(), Monday, 1, default)).Single();
        Assert.Equal(1, week.Shifts);
        Assert.Equal(0, week.Open);
        Assert.Equal(1, week.Filled);
    }

    [Fact]
    public async Task Fill_GroupLineWithoutAWorker_IsNeitherOpenNorFilled()
    {
        var (fx, _, _) = await Seeded();
        fx.Seed.GroupActivityStaff.RemoveRange(fx.Seed.GroupActivityStaff);
        await fx.Seed.SaveChangesAsync();
        var week = (await RosterFill.WeeksAsync(fx.Fresh(), Monday, 1, default)).Single();
        Assert.Equal((0, 0), (week.Open, week.Filled));
    }

    [Fact]
    public async Task PublishWeek_PublishesTheDraftActivityAndItsShifts_AndDoesNotCallThemUnfilled()
    {
        var (fx, activity, shift) = await Seeded();
        var result = Assert.IsType<OkObjectResult>((await Rostering(fx, fx.Fresh()).PublishWeek(Monday, default)).Result);
        var data = Assert.IsType<ApiResponse<PublishWeekResultDto>>(result.Value).Data!;
        Assert.Equal(0, data.Unfilled);
        Assert.Equal(1, data.Published);
        Assert.Equal(ShiftStatus.Published, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync(a => a.Id == activity.Id)).Status);
        Assert.Equal(ShiftStatus.Published, (await fx.Seed.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id)).Status);
    }
}
