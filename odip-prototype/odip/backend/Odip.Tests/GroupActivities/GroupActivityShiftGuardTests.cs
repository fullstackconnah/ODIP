using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>The board's own shift writes leave what a group activity owns to the activity (PLAN-AMEND rulings 1, 2 and 7).</summary>
public class GroupActivityShiftGuardTests
{
    private static RosteringController Rostering(GroupActivityFixture fx)
    {
        var db = fx.Fresh();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(fx.TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), tenant: tenant.Object);
    }

    /// <summary>An activity with one attached participant shift, plus a free worker and a second, ordinary shift.</summary>
    private static async Task<(GroupActivityFixture Fx, Shift Attached, Shift Plain, Odip.Domain.Entities.User Worker)> Seeded()
    {
        var fx = new GroupActivityFixture();
        var activity = fx.AddActivity();
        var attached = fx.AddShift(fx.AddParticipant());
        var plain = fx.AddShift(fx.AddParticipant("Quinn"), startHour: 14, endHour: 15);
        var worker = fx.AddUser();
        attached.GroupActivityId = activity.Id;
        await fx.Seed.SaveChangesAsync();
        return (fx, attached, plain, worker);
    }

    private static UpdateShiftDto Put(Shift s, Action<Dictionary<string, object?>>? change = null)
    {
        var v = new Dictionary<string, object?> { ["staff"] = s.UserId, ["day"] = s.ServiceDate, ["start"] = s.StartTime, ["ratio"] = s.Ratio };
        change?.Invoke(v);
        return new UpdateShiftDto
        {
            ParticipantId = s.ParticipantId, StaffId = (Guid?)v["staff"], ServiceDate = (DateOnly)v["day"]!, StartTime = (TimeOnly)v["start"]!, EndTime = s.EndTime, EndsNextDay = s.EndsNextDay,
            Ratio = (SupportRatio)v["ratio"]!, NightType = s.NightType, Status = s.Status, Notes = "A note",
        };
    }

    private static string? Code<T>(ActionResult<ApiResponse<T>> result, int status)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, obj.StatusCode);
        return Assert.IsType<ApiResponse<T>>(obj.Value).Code;
    }

    [Fact]
    public async Task Assign_OnAnAttachedShift_409_AndNobodyIsSaved()
    {
        var (fx, attached, _, worker) = await Seeded();
        Assert.Equal("GA_ON_ACTIVITY", Code(await Rostering(fx).AssignShift(attached.Id, new AssignShiftDto { StaffId = worker.Id }, default), 409));
        Assert.Null((await fx.Seed.Shifts.AsNoTracking().SingleAsync(s => s.Id == attached.Id)).UserId);
    }

    [Fact]
    public async Task MoveStaff_WithEitherShiftAttached_409()
    {
        var (fx, attached, plain, worker) = await Seeded();
        plain.UserId = worker.Id;
        await fx.Seed.SaveChangesAsync();
        Assert.Equal("GA_ON_ACTIVITY", Code(await Rostering(fx).MoveStaff(new MoveStaffDto { FromShiftId = plain.Id, ToShiftId = attached.Id, Mode = MoveStaffMode.Move }, default), 409));
        Assert.Equal("GA_ON_ACTIVITY", Code(await Rostering(fx).MoveStaff(new MoveStaffDto { FromShiftId = attached.Id, ToShiftId = plain.Id, Mode = MoveStaffMode.Move }, default), 409));
        Assert.Equal(worker.Id, (await fx.Seed.Shifts.AsNoTracking().SingleAsync(s => s.Id == plain.Id)).UserId);
    }

    [Fact]
    public async Task Put_ChangingWhatTheActivityOwns_409_ButNotesStillSave()
    {
        var (fx, attached, _, worker) = await Seeded();
        foreach (var change in new Action<Dictionary<string, object?>>[]
                 {
                     v => v["staff"] = worker.Id, v => v["day"] = GroupActivityFixture.Day.AddDays(1), v => v["start"] = new TimeOnly(8, 0), v => v["ratio"] = SupportRatio.OneToTwo,
                 })
            Assert.Equal("GA_ON_ACTIVITY", Code(await Rostering(fx).UpdateShift(attached.Id, Put(attached, change), default), 409));
        var saved = Assert.IsType<OkObjectResult>((await Rostering(fx).UpdateShift(attached.Id, Put(attached), default)).Result);
        Assert.NotNull(saved.Value);
        Assert.Equal("A note", (await fx.Seed.Shifts.AsNoTracking().SingleAsync(s => s.Id == attached.Id)).Notes);
    }

    [Theory]
    [InlineData(ShiftStatus.Completed)]
    [InlineData(ShiftStatus.Cancelled)]
    public async Task Put_ReopeningOrCancellingAnAttachedShift_OfAFinishedActivity_409_AndTheShiftStays(ShiftStatus activityStatus)
    {
        var (fx, attached, _, _) = await Seeded();
        var activity = await fx.Seed.GroupActivities.SingleAsync();
        (activity.Status, attached.Status) = (activityStatus, ShiftStatus.Cancelled);
        await fx.Seed.SaveChangesAsync();
        Assert.Equal("GA_ON_ACTIVITY", Code(await Rostering(fx).UpdateShift(attached.Id, Put(attached) with { Status = ShiftStatus.Published }, default), 409));
        Assert.Equal(ShiftStatus.Cancelled, (await fx.Seed.Shifts.AsNoTracking().SingleAsync(s => s.Id == attached.Id)).Status);
    }

    [Fact]
    public async Task Delete_OfAnAttachedShift_409_AndItStays()
    {
        var (fx, attached, _, _) = await Seeded();
        Assert.Equal("GA_ON_ACTIVITY", Code(await Rostering(fx).DeleteShift(attached.Id, default), 409));
        Assert.Equal(2, await fx.Seed.Shifts.CountAsync());
    }

    [Fact]
    public async Task AutoRosterApply_SplitOfAnAttachedShift_IsRefused_AndTheShiftIsUnchanged()
    {
        var (fx, attached, _, worker) = await Seeded();
        var second = fx.AddUser("Sam");
        var split = new AutoRosterApplySplitDto
        {
            ShiftId = attached.Id, StartTime = attached.StartTime, EndTime = attached.EndTime, CutAt = new TimeOnly(11, 0), FirstStaffId = worker.Id, SecondStaffId = second.Id,
        };
        var ok = Assert.IsType<OkObjectResult>((await Rostering(fx).AutoRosterApply(GroupActivityFixture.Day, new AutoRosterApplyDto { Splits = [split] }, default)).Result);
        var result = Assert.IsType<ApiResponse<AutoRosterApplyResultDto>>(ok.Value).Data!;
        Assert.Empty(result.Applied);
        Assert.Equal("This shift is part of a group activity.", Assert.Single(result.Skipped).Message);
        var saved = await fx.Seed.Shifts.AsNoTracking().SingleAsync(s => s.Id == attached.Id);
        Assert.Equal((null, attached.StartTime, attached.EndTime, attached.GroupActivityId), (saved.UserId, saved.StartTime, saved.EndTime, saved.GroupActivityId));
        Assert.Equal(2, await fx.Seed.Shifts.CountAsync());
    }

    [Fact]
    public async Task StaffView_UnfilledLane_LeavesOutAttachedShifts()
    {
        var (fx, attached, plain, _) = await Seeded();
        var result = Assert.IsType<OkObjectResult>((await Rostering(fx).GetBoard(GroupActivityFixture.Day, "staff", default)).Result);
        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(result.Value).Data!;
        Assert.DoesNotContain(board.Unfilled!, s => s.Id == attached.Id);
        Assert.Contains(board.Unfilled!, s => s.Id == plain.Id);
    }
}
