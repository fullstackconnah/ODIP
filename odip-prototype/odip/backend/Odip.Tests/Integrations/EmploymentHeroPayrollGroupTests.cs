using System.Globalization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Imports;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;

namespace Odip.Tests.Integrations;

/// <summary>GA payroll: approved group staff rows reach the Payroll check and Send missing as their own Kind.</summary>
public class EmploymentHeroPayrollGroupTests
{
    private static readonly DateOnly From = new(2026, 10, 6), To = new(2026, 10, 19), Day = new(2026, 10, 14);
    private static readonly DateTime NineSydney = new(2026, 10, 13, 22, 0, 0, DateTimeKind.Utc), ThreeSydney = new(2026, 10, 14, 4, 0, 0, DateTimeKind.Utc);

    private static EmploymentHeroPayrollController Controller(OdipDbContext db, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        return new EmploymentHeroPayrollController(db, tenant.Object, Keys, StubHttpHandler.Client(new StubHttpHandler()), Clock())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = ImportTestSupport.Admin() } },
        };
    }

    private static T Data<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static async Task<(OdipDbContext Db, Guid Tenant)> OrgAsync(string? database = null)
    {
        var id = Guid.NewGuid();
        var db = Db(database ?? Guid.NewGuid().ToString(), id);
        (await ConnectAsync(db, id)).WorkTypeStandard = "7";
        await db.SaveChangesAsync();
        return (db, id);
    }

    internal static async Task<GroupActivity> ActivityAsync(OdipDbContext db, Guid tenant, string title = "Bowling", ShiftStatus status = ShiftStatus.Completed)
    {
        var a = new GroupActivity { Id = Guid.NewGuid(), TenantId = tenant, ServiceDate = Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), Title = title, Status = status };
        db.GroupActivities.Add(a);
        await db.SaveChangesAsync();
        return a;
    }

    internal static async Task<GroupActivityStaff> RowAsync(OdipDbContext db, Guid tenant, GroupActivity a, Guid userId, bool approved = true, bool actuals = true, bool submitted = true, bool breakSet = false)
    {
        var r = new GroupActivityStaff
        {
            Id = Guid.NewGuid(), TenantId = tenant, GroupActivityId = a.Id, UserId = userId, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), TimeZoneId = "Australia/Sydney",
            ActualStart = actuals ? NineSydney : null, ActualEnd = actuals ? ThreeSydney : null, StartedAt = actuals ? NineSydney : null, SubmittedAt = submitted ? ThreeSydney : null,
            ReviewOutcome = approved ? ReviewOutcome.Approved : null, ReviewedAt = approved ? ThreeSydney : null,
            BreakStartedAt = breakSet ? NineSydney.AddHours(3) : null, BreakEndedAt = breakSet ? NineSydney.AddHours(3.5) : null,
        };
        db.GroupActivityStaff.Add(r);
        await db.SaveChangesAsync();
        return r;
    }

    internal static EmploymentHeroOutbox OutboxFor(Guid tenant, Guid entityId, EmploymentHeroOutboxKind kind, EmploymentHeroOutboxStatus status, int attempts = 0, string? error = null)
    {
        var now = Clock().GetUtcNow().UtcDateTime;
        return new EmploymentHeroOutbox
        {
            Id = Guid.NewGuid(), TenantId = tenant, Kind = kind, EntityId = entityId, Status = status, Attempts = attempts, LastError = error, NextAttemptAt = now.AddHours(1), CreatedAt = now, UpdatedAt = now,
        };
    }

    [Fact]
    public async Task Check_ListsApprovedGroupStaffRow_UnderItsWorker_WithActivityTitleAndKind3Status()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var row = await RowAsync(db, tenant, await ActivityAsync(db, tenant), worker.Id);
        db.EmploymentHeroOutbox.Add(OutboxFor(tenant, row.Id, EmploymentHeroOutboxKind.GroupStaffTimesheet, EmploymentHeroOutboxStatus.Failed, 2, "Employment Hero is busy."));
        await db.SaveChangesAsync();

        var check = Data(await Controller(db, tenant).Check(From, To, default));

        var line = Assert.Single(Assert.Single(check.Workers).Shifts);
        Assert.Equal(row.Id, line.ShiftId);
        Assert.True(line.IsGroupActivity);
        Assert.Equal("Bowling", line.ParticipantName);
        Assert.Equal(PayrollShiftStatus.Failed, line.Status);
        Assert.StartsWith("Employment Hero is busy. We'll try again at", line.Reason);
        Assert.True(line.Sendable);
        Assert.Equal((1, 1), (check.Approved, check.Failed));
    }

    [Fact]
    public async Task Check_NeverListsAnotherTenantsGroupRows()
    {
        var database = Guid.NewGuid().ToString();
        var (db, tenant) = await OrgAsync(database);
        await using var _ = db;
        var (dbB, other) = await OrgAsync(database);
        await using var __ = dbB;
        var theirWorker = await EhTimesheetFixture.WorkerAsync(dbB, other, "43");
        var theirs = await RowAsync(dbB, other, await ActivityAsync(dbB, other), theirWorker.Id);
        dbB.EmploymentHeroOutbox.Add(OutboxFor(other, theirs.Id, EmploymentHeroOutboxKind.GroupStaffTimesheet, EmploymentHeroOutboxStatus.Failed, 2, "x"));
        await dbB.SaveChangesAsync();

        var check = Data(await Controller(db, tenant).Check(From, To, default));

        Assert.Empty(check.Workers);
        Assert.Equal((0, 0, 0), (check.Approved, check.Failed, check.Sendable));
    }

    [Fact]
    public async Task Check_GroupActivity_CountsStaffRowOnce_NotItsParticipantShifts()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var activity = await ActivityAsync(db, tenant);
        await RowAsync(db, tenant, activity, worker.Id);
        for (var i = 0; i < 3; i++)
        {
            var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, new TimeOnly(9, 0), new TimeOnly(15, 0));
            shift.GroupActivityId = activity.Id;
        }
        await db.SaveChangesAsync();

        Assert.Equal(1, Data(await Controller(db, tenant).Check(From, To, default)).Approved);
    }

    [Fact]
    public async Task Check_Kind3RowNotMatchedAsTimesheet()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var row = await RowAsync(db, tenant, await ActivityAsync(db, tenant), worker.Id);
        db.EmploymentHeroOutbox.Add(OutboxFor(tenant, row.Id, EmploymentHeroOutboxKind.Timesheet, EmploymentHeroOutboxStatus.Failed, 2, "wrong kind"));
        await db.SaveChangesAsync();

        var line = Assert.Single(Assert.Single(Data(await Controller(db, tenant).Check(From, To, default)).Workers).Shifts);

        Assert.Equal(PayrollShiftStatus.Waiting, line.Status);
        Assert.Equal("Not queued yet. Send missing queues it.", line.Reason);
    }

    [Fact]
    public async Task Check_ApprovedRowWithoutActualTimes_IsSkipped_AndTheOtherRowsStillList()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var activity = await ActivityAsync(db, tenant);
        await RowAsync(db, tenant, activity, worker.Id, actuals: false);
        var good = await RowAsync(db, tenant, activity, (await EhTimesheetFixture.WorkerAsync(db, tenant, "44")).Id);

        var check = Data(await Controller(db, tenant).Check(From, To, default));

        Assert.Equal(good.Id, Assert.Single(Assert.Single(check.Workers).Shifts).ShiftId);
        Assert.Equal(1, check.Approved);
    }

    [Fact]
    public async Task Check_GroupRow_PaysTheSameMinutesAsTheLineTheSenderBuilds_WithABreak()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var activity = await ActivityAsync(db, tenant);
        var row = await RowAsync(db, tenant, activity, worker.Id, breakSet: true);
        var (shift, completion, breaks) = EmploymentHeroTimesheets.ForStaffRow(activity, row)!.Value;
        var map = new EmploymentHeroTimesheets.TimesheetMapping("7", null, null, null);
        var line = EmploymentHeroTimesheets.Build(shift, completion, breaks, worker.ExternalPayrollId, map, TimeZoneInfo.Utc).Line!;
        double Minutes(string a, string b) => (DateTime.Parse(b, CultureInfo.InvariantCulture) - DateTime.Parse(a, CultureInfo.InvariantCulture)).TotalMinutes;
        var sent = Minutes(line.StartTime, line.EndTime) - line.Breaks.Where(b => !b.IsPaidBreak).Sum(b => Minutes(b.StartTime, b.EndTime));

        var paid = Assert.Single(Assert.Single(Data(await Controller(db, tenant).Check(From, To, default)).Workers).Shifts).PaidMinutes;

        Assert.Equal(330, sent);
        Assert.Equal(sent, paid);
    }

    [Fact]
    public async Task SendMissing_QueuesOneKind3Row_ThenNothingTwice()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var row = await RowAsync(db, tenant, await ActivityAsync(db, tenant), worker.Id);
        var controller = Controller(db, tenant);

        var first = Data(await controller.SendMissing(new PayrollRangeDto(From, To), default));
        var second = Data(await controller.SendMissing(new PayrollRangeDto(From, To), default));

        Assert.Equal((1, 0), (first.Queued, second.Queued));
        var queued = Assert.Single(await db.EmploymentHeroOutbox.ToListAsync());
        Assert.Equal((EmploymentHeroOutboxKind.GroupStaffTimesheet, row.Id, EmploymentHeroOutboxStatus.Pending), (queued.Kind, queued.EntityId, queued.Status));
    }

    [Fact]
    public async Task SendMissing_ResetsFailedKind3Row_ToPending()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var row = await RowAsync(db, tenant, await ActivityAsync(db, tenant), worker.Id);
        db.EmploymentHeroOutbox.Add(OutboxFor(tenant, row.Id, EmploymentHeroOutboxKind.GroupStaffTimesheet, EmploymentHeroOutboxStatus.Failed, 2, "busy"));
        await db.SaveChangesAsync();

        Assert.Equal(1, Data(await Controller(db, tenant).SendMissing(new PayrollRangeDto(From, To), default)).Queued);

        var saved = Assert.Single(await db.EmploymentHeroOutbox.ToListAsync());
        Assert.Equal((EmploymentHeroOutboxStatus.Pending, (string?)null), (saved.Status, saved.LastError));
    }

    [Fact]
    public async Task Check_AwaitingApproval_CountsStartedOrFinishedStaffRows_NotGroupParticipantShifts()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var live = await ActivityAsync(db, tenant, status: ShiftStatus.InProgress);
        await RowAsync(db, tenant, live, worker.Id, approved: false, submitted: false);                                  // started
        await RowAsync(db, tenant, live, (await EhTimesheetFixture.WorkerAsync(db, tenant, "44")).Id, approved: false);   // finished
        await RowAsync(db, tenant, live, (await EhTimesheetFixture.WorkerAsync(db, tenant, "45")).Id, approved: false, actuals: false, submitted: false);   // not started
        await RowAsync(db, tenant, await ActivityAsync(db, tenant, status: ShiftStatus.Cancelled), worker.Id, approved: false);   // cancelled activity
        var (shift, _) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, Day, new TimeOnly(9, 0), new TimeOnly(15, 0), status: ShiftStatus.PendingReview);
        shift.GroupActivityId = live.Id;   // a participant's shift is the coordinator's record, not pay
        await db.SaveChangesAsync();

        Assert.Equal(2, Data(await Controller(db, tenant).Check(From, To, default)).AwaitingApproval);
    }
}
