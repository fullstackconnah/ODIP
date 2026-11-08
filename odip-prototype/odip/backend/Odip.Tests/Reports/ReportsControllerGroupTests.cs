using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Reports;

/// <summary>GA payroll: the staff-hours report counts a group activity's staff rows once, from the actual times, and never another organisation's.</summary>
public class ReportsControllerGroupTests
{
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();
    private static readonly DateOnly From = new(2026, 10, 19), To = new(2026, 11, 1), Day = new(2026, 10, 21);
    private static readonly DateTime Start = new(2026, 10, 20, 22, 0, 0, DateTimeKind.Utc);   // 09:00 Sydney

    private sealed class FixedClock(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
    }

    private static ReportsController Controller(OdipDbContext db)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        return new ReportsController(db, tenant.Object, new FixedClock(new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero)));
    }

    private static async Task<List<HoursByWorkerRowDto>> HoursAsync(OdipDbContext db)
    {
        var result = await Controller(db).HoursByWorker(From, To, CancellationToken.None);
        return Assert.IsType<ApiResponse<List<HoursByWorkerRowDto>>>(Assert.IsAssignableFrom<ObjectResult>(result.Result).Value).Data!;
    }

    private static User AddUser(OdipDbContext db, Guid tenant, string first)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), TenantId = tenant, FirstName = first, LastName = "Worker", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(u);
        return u;
    }

    private static GroupActivity AddActivity(OdipDbContext db, Guid tenant, ShiftStatus status = ShiftStatus.Completed)
    {
        var a = new GroupActivity { Id = Guid.NewGuid(), TenantId = tenant, ServiceDate = Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), Title = "Bowling", Status = status };
        db.GroupActivities.Add(a);
        return a;
    }

    /// <summary>9:00 to 15:00 Sydney with a 30 minute break: 330 paid minutes.</summary>
    private static GroupActivityStaff AddRow(OdipDbContext db, Guid tenant, GroupActivity a, User worker, bool approved, bool finished = true, bool started = true)
    {
        var r = new GroupActivityStaff
        {
            Id = Guid.NewGuid(), TenantId = tenant, GroupActivityId = a.Id, UserId = worker.Id, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), TimeZoneId = "Australia/Sydney",
            ActualStart = started ? Start : null, ActualEnd = finished ? Start.AddHours(6) : null, StartedAt = started ? Start : null, SubmittedAt = finished ? Start.AddHours(6) : null,
            BreakStartedAt = finished ? Start.AddHours(3) : null, BreakEndedAt = finished ? Start.AddHours(3.5) : null,
            ReviewOutcome = approved ? ReviewOutcome.Approved : null,
        };
        db.GroupActivityStaff.Add(r);
        return r;
    }

    [Fact]
    public async Task HoursByWorker_IncludesApprovedGroupStaffRow_ActualMinusBreak()
    {
        using var db = TestDb.Create();
        var worker = AddUser(db, TenantA, "Sam");
        AddRow(db, TenantA, AddActivity(db, TenantA), worker, approved: true);
        await db.SaveChangesAsync();

        var row = Assert.Single(await HoursAsync(db));

        Assert.Equal((1, 5.5m, 0m), (row.ApprovedShifts, row.ApprovedHours, row.AwaitingApprovalHours));
    }

    [Fact]
    public async Task HoursByWorker_ApprovedGroupRowWithoutActualEnd_IsItsRosteredHours()
    {
        using var db = TestDb.Create();
        var worker = AddUser(db, TenantA, "Sam");
        AddRow(db, TenantA, AddActivity(db, TenantA), worker, approved: true, finished: false);
        await db.SaveChangesAsync();

        var row = Assert.Single(await HoursAsync(db));

        Assert.Equal((1, 6m, 0m), (row.ApprovedShifts, row.ApprovedHours, row.AwaitingApprovalHours));
    }

    [Fact]
    public async Task HoursByWorker_FinishedGroupRow_IsAwaiting_NotStartedIsAbsent()
    {
        using var db = TestDb.Create();
        var finished = AddUser(db, TenantA, "Fin");
        var notStarted = AddUser(db, TenantA, "Idle");
        var activity = AddActivity(db, TenantA, ShiftStatus.InProgress);
        AddRow(db, TenantA, activity, finished, approved: false);
        AddRow(db, TenantA, activity, notStarted, approved: false, finished: false, started: false);
        await db.SaveChangesAsync();

        var row = Assert.Single(await HoursAsync(db));

        Assert.Equal((finished.Id, 0, 0m, 5.5m), (row.WorkerId, row.ApprovedShifts, row.ApprovedHours, row.AwaitingApprovalHours));
    }

    [Fact]
    public async Task HoursByWorker_GroupActivity_NoDoubleCount()
    {
        using var db = TestDb.Create();
        var worker = AddUser(db, TenantA, "Sam");
        var activity = AddActivity(db, TenantA);
        AddRow(db, TenantA, activity, worker, approved: true);
        for (var i = 0; i < 3; i++)
        {
            var shift = new Shift
            {
                Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = Guid.NewGuid(), UserId = worker.Id, ServiceDate = Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
                Status = ShiftStatus.Completed, GroupActivityId = activity.Id,
            };
            db.Shifts.Add(shift);
            db.ShiftCompletions.Add(new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = TenantA, ShiftId = shift.Id, ActualStart = Start, ActualEnd = Start.AddHours(6), TimeZoneId = "Australia/Sydney",
                SubmittedByUserId = worker.Id, ReviewOutcome = ReviewOutcome.Approved, IsActive = true,
            });
        }
        await db.SaveChangesAsync();

        var row = Assert.Single(await HoursAsync(db));

        Assert.Equal((1, 5.5m), (row.ApprovedShifts, row.ApprovedHours));
    }

    [Fact]
    public async Task HoursByWorker_NeverCountsAnotherTenantsGroupRows()
    {
        using var db = TestDb.Create();
        var theirs = AddUser(db, TenantB, "Other");
        AddRow(db, TenantB, AddActivity(db, TenantB), theirs, approved: true);
        await db.SaveChangesAsync();

        Assert.Empty(await HoursAsync(db));
    }
}
