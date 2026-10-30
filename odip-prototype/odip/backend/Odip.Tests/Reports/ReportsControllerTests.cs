using System.Collections;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
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

public class ReportsControllerTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly DateOnly From = new(2026, 10, 19);   // a Monday
    private static readonly DateOnly To = new(2026, 11, 1);      // a Sunday

    private sealed class FixedClock(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
    }

    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero));

    private static ReportsController Controller(OdipDbContext db, Guid? tenantId = null, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId ?? TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return new ReportsController(db, tenant.Object, Clock);
    }

    private static (int Status, string? Message, IList? Data) Unpack<T>(ActionResult<ApiResponse<List<T>>> r)
    {
        var o = (ObjectResult)r.Result!;
        var body = (ApiResponse<List<T>>)o.Value!;
        return (o.StatusCode ?? 200, body.Errors?.FirstOrDefault(), body.Data);
    }

    private static async Task<(int Status, string? Message, IList? Data)> Call(ReportsController c, string endpoint, DateOnly? from, DateOnly? to) => endpoint switch
    {
        "hours" => Unpack(await c.HoursByWorker(from, to, CancellationToken.None)),
        "fulfilment" => Unpack(await c.ShiftFulfilment(from, to, CancellationToken.None)),
        "leave" => Unpack(await c.LeaveTaken(from, to, CancellationToken.None)),
        _ => throw new ArgumentOutOfRangeException(nameof(endpoint)),
    };

    private static List<T> Rows<T>((int Status, string? Message, IList? Data) r)
    {
        Assert.Equal(200, r.Status);
        return r.Data!.Cast<T>().ToList();
    }

    private static User AddUser(OdipDbContext db, string first, string last, Guid? tenant = null)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), TenantId = tenant ?? TenantA, FirstName = first, LastName = last,
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(u);
        return u;
    }

    private static Shift AddShift(OdipDbContext db, DateOnly date, ShiftStatus status, Guid? userId, Guid? tenant = null,
        TimeOnly? start = null, TimeOnly? end = null, bool nextDay = false, SleepoverType night = SleepoverType.None)
    {
        var s = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenant ?? TenantA, ParticipantId = Guid.NewGuid(), UserId = userId, ServiceDate = date,
            StartTime = start ?? new TimeOnly(8, 0), EndTime = end ?? new TimeOnly(16, 0), EndsNextDay = nextDay, NightType = night, Status = status,
        };
        db.Shifts.Add(s);
        return s;
    }

    /// <summary>A completion by <paramref name="worker"/> that ran <paramref name="minutes"/> from 08:00 UTC, with an optional break of <paramref name="breakMinutes"/>.</summary>
    private static ShiftCompletion AddCompletion(OdipDbContext db, Shift shift, User worker, int? minutes, ReviewOutcome? outcome = ReviewOutcome.Approved,
        bool active = true, int breakMinutes = 0, Guid? tenant = null)
    {
        var start = new DateTime(2026, 10, 20, 8, 0, 0, DateTimeKind.Utc);
        var c = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = tenant ?? TenantA, ShiftId = shift.Id, ActualStart = start, ActualEnd = minutes is { } m ? start.AddMinutes(m) : null,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = worker.Id, StartedAt = start, ReviewOutcome = outcome, IsActive = active,
        };
        db.ShiftCompletions.Add(c);
        if (breakMinutes > 0)
            db.ShiftBreaks.Add(new ShiftBreak
            {
                Id = Guid.NewGuid(), TenantId = tenant ?? TenantA, ShiftCompletionId = c.Id, StartedAt = start.AddMinutes(60), EndedAt = start.AddMinutes(60 + breakMinutes), CreatedByUserId = worker.Id,
            });
        return c;
    }

    private static LeaveRequest AddLeave(OdipDbContext db, User worker, DateOnly start, DateOnly end, LeaveStatus status = LeaveStatus.Approved,
        LeaveSource source = LeaveSource.Odip, Guid? tenant = null) =>
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenant ?? TenantA, UserId = worker.Id, LeaveType = LeaveType.Annual, StartDate = start, EndDate = end, Status = status,
            Source = source, RequestedByUserId = worker.Id, RequestedAt = DateTime.UtcNow, Reason = "private reason",
        }).Entity;

    // ---------- hours by worker ----------

    [Fact]
    public async Task HoursByWorker_SumsApprovedPaidHours_PerSubmitter_SortedByName_RoundedOnce()
    {
        using var db = TestDb.Create();
        var zoe = AddUser(db, "Zoe", "Young");
        var adam = AddUser(db, "adam", "Able");
        var other = AddUser(db, "Other", "Person");
        // adam: 7h20m with a 20 min break = 420 min, plus 3h10m = 190 min -> 610 min = 10.17.
        AddCompletion(db, AddShift(db, From, ShiftStatus.Completed, other.Id), adam, 440, breakMinutes: 20);   // Shift.UserId differs: the worker is the submitter
        AddCompletion(db, AddShift(db, From.AddDays(1), ShiftStatus.Completed, adam.Id), adam, 190);
        // zoe: two 3h10m shifts = 380 min = 6.33 (per-shift rounding would give 6.34).
        AddCompletion(db, AddShift(db, From.AddDays(2), ShiftStatus.Completed, zoe.Id), zoe, 190);
        AddCompletion(db, AddShift(db, From.AddDays(3), ShiftStatus.Completed, zoe.Id), zoe, 190);
        await db.SaveChangesAsync();

        var rows = Rows<HoursByWorkerRowDto>(await Call(Controller(db), "hours", From, To));

        Assert.Equal(["adam Able", "Zoe Young"], rows.Select(r => r.WorkerName));
        Assert.Equal((2, 10.17m, 0m), (rows[0].ApprovedShifts, rows[0].ApprovedHours, rows[0].AwaitingApprovalHours));
        Assert.Equal((2, 6.33m, 0m), (rows[1].ApprovedShifts, rows[1].ApprovedHours, rows[1].AwaitingApprovalHours));
    }

    [Fact]
    public async Task HoursByWorker_PendingReviewIsAwaiting_InProgressReturnedAndOutOfRangeLeftOut()
    {
        using var db = TestDb.Create();
        var pat = AddUser(db, "Pat", "Pending");
        var out1 = AddUser(db, "Out", "OfRange");
        var prog = AddUser(db, "Ina", "Progress");
        var ret = AddUser(db, "Rita", "Returned");
        AddCompletion(db, AddShift(db, From, ShiftStatus.PendingReview, pat.Id), pat, 240, outcome: null);
        AddCompletion(db, AddShift(db, From.AddDays(-30), ShiftStatus.PendingReview, out1.Id), out1, 240, outcome: null);   // PendingReview outside the range
        AddCompletion(db, AddShift(db, From, ShiftStatus.InProgress, prog.Id), prog, null, outcome: null);                    // no end: left out
        AddCompletion(db, AddShift(db, From, ShiftStatus.Published, ret.Id), ret, 240, outcome: ReviewOutcome.Returned, active: false);
        await db.SaveChangesAsync();

        var rows = Rows<HoursByWorkerRowDto>(await Call(Controller(db), "hours", From, To));

        var row = Assert.Single(rows);
        Assert.Equal(("Pat Pending", 0, 0m, 4.00m), (row.WorkerName, row.ApprovedShifts, row.ApprovedHours, row.AwaitingApprovalHours));
    }

    [Fact]
    public async Task HoursByWorker_SleepoverCountsRosteredHours()
    {
        using var db = TestDb.Create();
        var w = AddUser(db, "Sam", "Sleeper");
        var shift = AddShift(db, From, ShiftStatus.Completed, w.Id, start: new TimeOnly(22, 0), end: new TimeOnly(8, 0), nextDay: true, night: SleepoverType.Sleepover);
        AddCompletion(db, shift, w, 540);   // worked 9h, rostered 10h
        await db.SaveChangesAsync();

        var row = Assert.Single(Rows<HoursByWorkerRowDto>(await Call(Controller(db), "hours", From, To)));
        Assert.Equal(10.00m, row.ApprovedHours);
    }

    // ---------- shift fulfilment ----------

    [Theory]
    [InlineData(2026, 10, 25, 2026, 10, 19)]   // Sunday 23:30 shift stays in the week that began Monday 19th
    [InlineData(2026, 10, 26, 2026, 10, 26)]   // Monday stays in its own week
    public async Task ShiftFulfilment_BucketsOnServiceDate_NotUtc(int y, int m, int d, int wy, int wm, int wd)
    {
        using var db = TestDb.Create();
        AddShift(db, new DateOnly(y, m, d), ShiftStatus.Published, Guid.NewGuid(), start: new TimeOnly(23, 30), end: new TimeOnly(7, 30), nextDay: true);
        await db.SaveChangesAsync();

        var rows = Rows<ShiftFulfilmentWeekDto>(await Call(Controller(db), "fulfilment", From, To));

        Assert.Equal(new DateOnly(wy, wm, wd), Assert.Single(rows, r => r.Shifts == 1).WeekStart);
    }

    [Fact]
    public async Task ShiftFulfilment_CancelledAndDraftLeftOutOfFillRate_RoundsHalfAwayFromZero()
    {
        using var db = TestDb.Create();
        var worker = Guid.NewGuid();
        for (var i = 0; i < 3; i++) AddShift(db, From.AddDays(i), ShiftStatus.Published, worker);
        AddShift(db, From, ShiftStatus.Published, null);
        AddShift(db, From, ShiftStatus.Cancelled, worker);
        AddShift(db, From, ShiftStatus.Cancelled, null);
        AddShift(db, From, ShiftStatus.Draft, null);
        // The next week: 2 filled and 1 unstaffed = 66.67 -> 67.
        AddShift(db, From.AddDays(7), ShiftStatus.Completed, worker);
        AddShift(db, From.AddDays(7), ShiftStatus.Published, worker);
        AddShift(db, From.AddDays(8), ShiftStatus.Published, null);
        await db.SaveChangesAsync();

        var rows = Rows<ShiftFulfilmentWeekDto>(await Call(Controller(db), "fulfilment", From, To));

        Assert.Equal((6, 3, 1, 2, 75), (rows[0].Shifts, rows[0].Filled, rows[0].Unstaffed, rows[0].Cancelled, rows[0].FillRatePercent));
        Assert.All(rows, r => Assert.Equal(r.Shifts, r.Filled + r.Unstaffed + r.Cancelled));
        Assert.Equal(67, rows[1].FillRatePercent);
    }

    [Fact]
    public async Task ShiftFulfilment_EmitsEveryWeek_NullRateWhenNothingToFill()
    {
        using var db = TestDb.Create();
        var from = new DateOnly(2026, 10, 5);
        AddShift(db, new DateOnly(2026, 10, 13), ShiftStatus.Published, Guid.NewGuid());
        AddShift(db, new DateOnly(2026, 10, 21), ShiftStatus.Cancelled, null);   // week 3 is all cancelled
        await db.SaveChangesAsync();

        var rows = Rows<ShiftFulfilmentWeekDto>(await Call(Controller(db), "fulfilment", from, To));

        Assert.Equal([new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 26)], rows.Select(r => r.WeekStart));
        Assert.Equal([null, 100, null, null], rows.Select(r => r.FillRatePercent));
        Assert.Equal(1, rows[2].Cancelled);
        Assert.Equal(0, rows[3].Shifts);
    }

    [Fact]
    public async Task ShiftFulfilment_WednesdayToTuesdayRange_MarksFirstAndLastWeeksAsPartWeeks_AndCountsOnlyDaysInside()
    {
        using var db = TestDb.Create();
        AddShift(db, new DateOnly(2026, 10, 13), ShiftStatus.Published, Guid.NewGuid());   // Tuesday before the range
        AddShift(db, new DateOnly(2026, 10, 14), ShiftStatus.Published, Guid.NewGuid());   // Wednesday: in
        AddShift(db, new DateOnly(2026, 10, 27), ShiftStatus.Published, Guid.NewGuid());   // Tuesday: in
        AddShift(db, new DateOnly(2026, 10, 28), ShiftStatus.Published, Guid.NewGuid());   // Wednesday after the range
        await db.SaveChangesAsync();

        var rows = Rows<ShiftFulfilmentWeekDto>(await Call(Controller(db), "fulfilment", new DateOnly(2026, 10, 14), new DateOnly(2026, 10, 27)));

        Assert.Equal([new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 26)], rows.Select(r => r.WeekStart));
        Assert.Equal([true, false, true], rows.Select(r => r.PartWeek));
        Assert.Equal([1, 0, 1], rows.Select(r => r.Shifts));
    }

    // ---------- leave taken ----------

    [Fact]
    public async Task LeaveTaken_ApprovedOverlappingOnly_DaysClippedToRange_OwnDatesShown_NoReason()
    {
        using var db = TestDb.Create();
        var w = AddUser(db, "Lee", "Leave");
        var from = new DateOnly(2026, 10, 26);
        AddLeave(db, w, new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 30));                          // runs in from before: 26..30 = 5
        AddLeave(db, w, new DateOnly(2026, 10, 31), new DateOnly(2026, 11, 5), source: LeaveSource.EmploymentHero);   // runs out after: 31, 1 = 2
        AddLeave(db, w, new DateOnly(2026, 10, 27), new DateOnly(2026, 10, 27), LeaveStatus.Pending);
        AddLeave(db, w, new DateOnly(2026, 10, 27), new DateOnly(2026, 10, 27), LeaveStatus.Declined);
        AddLeave(db, w, new DateOnly(2026, 10, 27), new DateOnly(2026, 10, 27), LeaveStatus.Cancelled);
        AddLeave(db, w, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 10));
        await db.SaveChangesAsync();

        var rows = Rows<LeaveTakenRowDto>(await Call(Controller(db), "leave", from, To));

        Assert.Equal([(new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 30), 5), (new DateOnly(2026, 10, 31), new DateOnly(2026, 11, 5), 2)],
            rows.Select(r => (r.From, r.To, r.DaysInRange)));
        Assert.All(rows, r => Assert.Equal(("Lee Leave", LeaveType.Annual), (r.WorkerName, r.Type)));
        Assert.DoesNotContain(typeof(LeaveTakenRowDto).GetProperties(), p => p.Name is "Reason" or "DecisionNote");
    }

    // ---------- seams: tenant, organisation, range, roles ----------

    /// <summary>Tenant B has rows in the same dates for every report; a tenant-A caller sees only tenant A's. With <paramref name="filterOn"/> the context's own tenant filter does it;
    /// without it (the SuperAdmin-style context) only the controller's explicit TenantId predicates can.</summary>
    [Theory]
    [InlineData("hours", true)]
    [InlineData("hours", false)]
    [InlineData("fulfilment", true)]
    [InlineData("fulfilment", false)]
    [InlineData("leave", true)]
    [InlineData("leave", false)]
    public async Task EachReport_LeavesOutAnotherTenantsRows(string endpoint, bool filterOn)
    {
        var name = Guid.NewGuid().ToString();
        using (var seed = TestDb.Create(name))
        {
            foreach (var (tenant, first) in new[] { (TenantA, "Anna"), (TenantB, "Bea") })
            {
                var w = AddUser(seed, first, "Worker", tenant);
                AddCompletion(seed, AddShift(seed, From, ShiftStatus.Completed, w.Id, tenant), w, 480, tenant: tenant);
                AddLeave(seed, w, From, From.AddDays(1), tenant: tenant);
            }
            await seed.SaveChangesAsync();
        }

        using var db = filterOn ? TestDb.ForTenant(name, TenantA) : TestDb.Create(name);
        var r = await Call(Controller(db), endpoint, From, To);

        var data = Assert.IsAssignableFrom<IList>(r.Data);
        Assert.Equal(200, r.Status);
        switch (endpoint)
        {
            case "hours": Assert.Equal("Anna Worker", Assert.Single(data.Cast<HoursByWorkerRowDto>()).WorkerName); break;
            case "fulfilment": Assert.Equal(1, data.Cast<ShiftFulfilmentWeekDto>().Sum(w => w.Shifts)); break;
            default: Assert.Equal("Anna Worker", Assert.Single(data.Cast<LeaveTakenRowDto>()).WorkerName); break;
        }
    }

    [Theory]
    [InlineData("hours")]
    [InlineData("fulfilment")]
    [InlineData("leave")]
    public async Task SuperAdminNotViewingAs_Returns400ChooseOrganisation(string endpoint)
    {
        using var db = TestDb.Create();
        var r = await Call(Controller(db, tenantId: null, superAdmin: true), endpoint, From, To);
        Assert.Equal((400, ReportsController.ChooseOrganisation), (r.Status, r.Message));
    }

    [Theory]
    [InlineData("hours")]
    [InlineData("fulfilment")]
    [InlineData("leave")]
    public async Task Range_366DaysAccepted_367Refused_ReversedOrMissingRefused(string endpoint)
    {
        using var db = TestDb.Create();
        var c = Controller(db);
        var start = new DateOnly(2024, 1, 1);

        Assert.Equal(200, (await Call(c, endpoint, start, new DateOnly(2024, 12, 31))).Status);   // 366 days (2024 is a leap year)
        var tooLong = await Call(c, endpoint, start, new DateOnly(2025, 1, 1));                    // 367
        Assert.Equal((400, ReportsController.RangeMessage), (tooLong.Status, tooLong.Message));
        Assert.Equal(400, (await Call(c, endpoint, To, From)).Status);
        Assert.Equal(400, (await Call(c, endpoint, From, null)).Status);
        Assert.Equal(400, (await Call(c, endpoint, null, To)).Status);
    }

    [Theory]
    [InlineData(nameof(ReportsController.HoursByWorker))]
    [InlineData(nameof(ReportsController.ShiftFulfilment))]
    [InlineData(nameof(ReportsController.LeaveTaken))]
    public void Roles_MatchCompletions_AndNothingIsAnonymous(string action)
    {
        var type = typeof(ReportsController);
        static HashSet<string> RolesOf(Type t) => t.GetCustomAttributes<AuthorizeAttribute>(true).Where(a => a.Roles != null)
            .SelectMany(a => a.Roles!.Split(',')).Select(r => r.Trim()).ToHashSet();

        var completions = RolesOf(typeof(RosteringController));
        Assert.Equal(completions, RolesOf(type));
        foreach (var role in new[] { "SuperAdmin", "Admin", "Coordinator" }) Assert.Contains(role, completions);
        foreach (var role in new[] { "SupportWorker", "ReadOnly" }) Assert.DoesNotContain(role, RolesOf(type));
        Assert.Empty(type.GetCustomAttributes<AllowAnonymousAttribute>(true));
        Assert.Empty(type.GetMethod(action)!.GetCustomAttributes<AllowAnonymousAttribute>(true));
    }
}
