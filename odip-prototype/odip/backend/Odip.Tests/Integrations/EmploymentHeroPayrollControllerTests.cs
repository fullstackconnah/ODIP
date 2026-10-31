using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
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

/// <summary>The Payroll page's API: pay periods from EH, the per-worker check, and Send missing.</summary>
public class EmploymentHeroPayrollControllerTests
{
    private const string Lines = "/api/v2/business/777/timesheet";
    private static readonly TimeOnly Nine = new(9, 0), Three = new(15, 0);
    private static readonly DateOnly From = new(2026, 10, 6), To = new(2026, 10, 19);

    private sealed class FailSaveOnce : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default) =>
            eventData.Context!.ChangeTracker.Entries<EmploymentHeroOutbox>().Any(e => e.State == EntityState.Added)
                ? throw new DbUpdateException("duplicate key")
                : base.SavingChangesAsync(eventData, result, ct);
    }

    private static EmploymentHeroPayrollController Controller(OdipDbContext db, Guid tenantId, StubHttpHandler eh, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return new EmploymentHeroPayrollController(db, tenant.Object, Keys, StubHttpHandler.Client(eh), Clock())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = ImportTestSupport.Admin() } },
        };
    }

    private static T Data<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static async Task<(OdipDbContext Db, Guid Tenant)> OrgAsync(string? database = null, Guid? tenant = null, params IInterceptor[] extra)
    {
        var id = tenant ?? Guid.NewGuid();
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(database ?? Guid.NewGuid().ToString()).AddInterceptors(extra).Options, ImportTestSupport.Tenant(id));
        var conn = await ConnectAsync(db, id);
        conn.WorkTypeStandard = "7";
        await db.SaveChangesAsync();
        return (db, id);
    }

    private static EmploymentHeroOutbox RowFor(Guid tenant, ShiftCompletion c, EmploymentHeroOutboxStatus status, int attempts = 0, string? lastError = null, string? externalId = null) =>
        new()
        {
            Id = Guid.NewGuid(), TenantId = tenant, Kind = EmploymentHeroOutboxKind.Timesheet, EntityId = c.Id, Status = status, Attempts = attempts, LastError = lastError,
            ExternalId = externalId, NextAttemptAt = Clock().GetUtcNow().UtcDateTime.AddHours(1), CreatedAt = Clock().GetUtcNow().UtcDateTime, UpdatedAt = Clock().GetUtcNow().UtcDateTime,
            SentAt = status == EmploymentHeroOutboxStatus.Sent ? Clock().GetUtcNow().UtcDateTime : null,
        };

    [Fact]
    public async Task A_SuperAdmin_who_is_not_viewing_an_organisation_is_refused_and_queues_nothing()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, new DateOnly(2026, 10, 14), Nine, Three);
        var c = Controller(db, tenant, new StubHttpHandler(), superAdmin: true);

        string Refusal<T>(ActionResult<ApiResponse<T>> r) => Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(r.Result).Value).Errors!.Single();

        Assert.Equal(EmploymentHeroController.ChooseOrganisation, Refusal(await c.Periods(default)));
        Assert.Equal(EmploymentHeroController.ChooseOrganisation, Refusal(await c.Check(From, To, default)));
        Assert.Equal(EmploymentHeroController.ChooseOrganisation, Refusal(await c.SendMissing(new PayrollRangeDto(From, To), default)));
        Assert.Empty(await db.EmploymentHeroOutbox.ToListAsync());
    }

    [Fact]
    public async Task Periods_merge_pay_runs_and_the_next_period_newest_first()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var eh = new StubHttpHandler()
            .On("/api/v2/business/777/payschedule", HttpStatusCode.OK, new[] { new { id = 5, name = "Fortnightly staff", frequency = "Fortnightly" } })
            .On("/api/v2/business/777/payschedule/nextpaydates", HttpStatusCode.OK, new[]
            {
                new { payScheduleId = 5, nextScheduledFromDate = "2026-10-06T00:00:00", nextScheduledToDate = "2026-10-19T00:00:00" },
                new { payScheduleId = 5, nextScheduledFromDate = "2026-09-22T00:00:00", nextScheduledToDate = "2026-10-05T00:00:00" },   // same dates as the run
            })
            .On("/api/v2/business/777/payrun?$orderby=PayPeriodEnding desc&$top=30", HttpStatusCode.OK,
                new[] { new { id = 1, payScheduleId = 5, payPeriodStarting = "2026-09-22T00:00:00", payPeriodEnding = "2026-10-05T00:00:00", isFinalised = true } });

        var periods = Data(await Controller(db, tenant, eh).Periods(CancellationToken.None));

        Assert.True(periods.Connected);
        Assert.Equal(new DateOnly(2026, 10, 14), periods.Today);
        Assert.Equal(
            [new PayPeriodDto(5, "Fortnightly staff", From, To, false), new PayPeriodDto(5, "Fortnightly staff", new DateOnly(2026, 9, 22), new DateOnly(2026, 10, 5), true)],
            periods.Periods);
    }

    [Fact]
    public async Task Periods_say_not_connected_without_calling_EH()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        var eh = new StubHttpHandler();

        var periods = Data(await Controller(db, tenant, eh).Periods(CancellationToken.None));

        Assert.False(periods.Connected);
        Assert.Empty(periods.Periods);
        Assert.Empty(eh.Requests);
    }

    [Fact]
    public async Task The_check_lists_this_organisations_approved_shifts_per_worker_worst_word_first()
    {
        var name = Guid.NewGuid().ToString();
        var (db, tenant) = await OrgAsync(name);
        await using var _ = db;
        var (dbB, other) = await OrgAsync(name);
        await using var __ = dbB;
        var sam = await EhTimesheetFixture.WorkerAsync(db, tenant, "42");
        var ned = EhFixture.Staff(tenant, "Ned", "Alpha", $"ned.{Guid.NewGuid():N}@acme.org.au");
        db.Users.Add(ned);
        await db.SaveChangesAsync();
        var (_, sent) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, sam, new DateOnly(2026, 10, 14), Nine, Three);
        var (_, waiting) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, sam, new DateOnly(2026, 10, 15), new TimeOnly(22, 0), new TimeOnly(6, 0), SleepoverType.Sleepover);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, ned, new DateOnly(2026, 10, 14), Nine, Three);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, sam, new DateOnly(2026, 10, 16), Nine, Three, status: ShiftStatus.PendingReview);
        db.EmploymentHeroOutbox.AddRange(RowFor(tenant, sent, EmploymentHeroOutboxStatus.Sent, 1, externalId: "9001"), RowFor(tenant, waiting, EmploymentHeroOutboxStatus.Pending));
        var otherWorker = await EhTimesheetFixture.WorkerAsync(dbB, other, "43");
        await EhTimesheetFixture.ApprovedShiftAsync(dbB, other, otherWorker, new DateOnly(2026, 10, 14), Nine, Three);
        await db.SaveChangesAsync();

        var check = Data(await Controller(db, tenant, new StubHttpHandler()).Check(From, To, CancellationToken.None));

        Assert.Equal((3, 1, 1, 0, 0, 1, 0, 1), (check.Approved, check.Sent, check.Waiting, check.Failed, check.Changed, check.NotLinked, check.Sendable, check.AwaitingApproval));
        Assert.Equal(["Ned Alpha", "Ben Turner"], check.Workers.Select(w => w.Name));
        Assert.False(check.Workers[0].Linked);
        var shifts = check.Workers[1].Shifts;
        Assert.Equal([PayrollShiftStatus.Sent, PayrollShiftStatus.Waiting], shifts.Select(s => s.Status));
        Assert.Equal(360, shifts[0].PaidMinutes);
        Assert.Equal(480, shifts[1].PaidMinutes);   // a sleepover is paid its rostered minutes
    }

    // Reports pays through the same ShiftBreakRules.PaidMinutes, so these pin the money rule from the Payroll side.
    [Fact]
    public async Task The_check_pays_a_sleepover_its_rostered_minutes_and_a_standard_shift_net_of_its_break()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var sam = await EhTimesheetFixture.WorkerAsync(db, tenant, "42");
        var (_, shortNight) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, sam, new DateOnly(2026, 10, 14), new TimeOnly(22, 0), new TimeOnly(6, 0), SleepoverType.Sleepover);
        shortNight.ActualEnd = shortNight.ActualStart.AddMinutes(420);   // worked 420 of the rostered 480
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, sam, new DateOnly(2026, 10, 15), Nine, Three, breaks: [(120, 30)]);
        await db.SaveChangesAsync();

        var shifts = Data(await Controller(db, tenant, new StubHttpHandler()).Check(From, To, CancellationToken.None)).Workers.Single().Shifts.OrderBy(s => s.ServiceDate).ToList();

        Assert.Equal((480, 0), (shifts[0].PaidMinutes, shifts[0].BreakMinutes));
        Assert.Equal((30, 330), (shifts[1].BreakMinutes, shifts[1].PaidMinutes));   // 360 worked - 30 break
    }

    [Theory]
    [InlineData("2026-10-19", "2026-10-06")]
    [InlineData("2026-08-01", "2026-10-19")]
    public async Task A_range_over_62_days_or_backwards_is_refused(string from, string to)
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;

        var result = await Controller(db, tenant, new StubHttpHandler()).Check(DateOnly.Parse(from), DateOnly.Parse(to), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains(EmploymentHeroPayrollController.RangeMessage, string.Join(" ", ((ApiResponse<PayrollCheckDto>)bad.Value!).Errors));
    }

    [Fact]
    public async Task Send_missing_queues_exactly_the_sendable_rows_ignoring_the_cutoff()
    {
        var name = Guid.NewGuid().ToString();
        var (db, tenant) = await OrgAsync(name);
        await using var _ = db;
        var (dbB, other) = await OrgAsync(name);
        await using var __ = dbB;
        var linked = await EhTimesheetFixture.WorkerAsync(db, tenant, "42");
        var unlinked = EhFixture.Staff(tenant, "Ned", "Alpha", $"ned.{Guid.NewGuid():N}@acme.org.au");
        db.Users.Add(unlinked);
        await db.SaveChangesAsync();
        Task<ShiftCompletion> Approved(User w, int day) => EhTimesheetFixture.ApprovedShiftAsync(db, tenant, w, new DateOnly(2026, 10, day), Nine, Three).ContinueWith(t => t.Result.Completion);
        var noRow = await Approved(linked, 7);                         // before the connect date, no row
        var failed = await Approved(linked, 8);
        var stuck = await Approved(linked, 9);                         // NeedsAttention, not Changed
        var changed = await Approved(linked, 10);
        var pending = await Approved(linked, 11);
        await Approved(unlinked, 12);                                  // not linked
        db.EmploymentHeroOutbox.AddRange(
            RowFor(tenant, failed, EmploymentHeroOutboxStatus.Failed, 2, "Employment Hero is busy."),
            RowFor(tenant, stuck, EmploymentHeroOutboxStatus.NeedsAttention, 1, "Employee is terminated"),
            RowFor(tenant, changed, EmploymentHeroOutboxStatus.NeedsAttention, 1, EmploymentHeroTimesheets.FinalisedMessage, "9001"),
            RowFor(tenant, pending, EmploymentHeroOutboxStatus.Pending));
        var otherWorker = await EhTimesheetFixture.WorkerAsync(dbB, other, "43");
        var (_, theirs) = await EhTimesheetFixture.ApprovedShiftAsync(dbB, other, otherWorker, new DateOnly(2026, 10, 8), Nine, Three);
        dbB.EmploymentHeroOutbox.Add(RowFor(other, theirs, EmploymentHeroOutboxStatus.Failed, 2, "x"));
        await db.SaveChangesAsync();
        await dbB.SaveChangesAsync();
        var controller = Controller(db, tenant, new StubHttpHandler());
        var before = Data(await controller.Check(From, To, CancellationToken.None)).Sendable;

        var result = Data(await controller.SendMissing(new PayrollRangeDto(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 19)), CancellationToken.None));

        Assert.Equal(3, result.Queued);
        Assert.Equal(before, result.Queued);   // no ExternalId and tried before (R1): Attempts goes to 1 so the next try finds first
        var rows = await db.EmploymentHeroOutbox.ToDictionaryAsync(r => r.EntityId);
        Assert.Equal(EmploymentHeroOutboxStatus.Pending, rows[noRow.Id].Status);
        Assert.All(new[] { failed, stuck }, c => Assert.Equal((EmploymentHeroOutboxStatus.Pending, 1), (rows[c.Id].Status, rows[c.Id].Attempts)));
        Assert.Equal(EmploymentHeroOutboxStatus.NeedsAttention, rows[changed.Id].Status);
        Assert.Equal(1, await db.EmploymentHeroOutbox.IgnoreQueryFilters().CountAsync(r => r.TenantId == other && r.Status == EmploymentHeroOutboxStatus.Failed));
        Assert.Equal(0, result.Check.Sendable);
    }

    [Fact]
    public async Task A_given_up_row_whose_line_EH_already_holds_is_updated_not_duplicated()
    {
        var (db, tenant) = await OrgAsync();
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var (_, completion) = await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, new DateOnly(2026, 10, 14), Nine, Three);
        db.EmploymentHeroOutbox.Add(RowFor(tenant, completion, EmploymentHeroOutboxStatus.NeedsAttention, 6, EmploymentHeroTimesheets.GaveUpMessage));
        await db.SaveChangesAsync();
        await Controller(db, tenant, new StubHttpHandler()).SendMissing(new PayrollRangeDto(From, To), CancellationToken.None);
        var clock = Clock();
        var eh = new StubHttpHandler()
            .On(HttpMethod.Get, $"{Lines}?$filter=ExternalId eq '{completion.Id:D}'", HttpStatusCode.OK, new[] { new { id = 9001, workTypeId = "7" } })
            .On(HttpMethod.Put, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001 })
            .On(HttpMethod.Get, $"{Lines}/9001", HttpStatusCode.OK, new { id = 9001, status = "Submitted" });
        var sender = new EmploymentHeroTimesheetSender(StubHttpHandler.Client(eh), Keys, clock, NullLogger<EmploymentHeroTimesheetSender>.Instance, TimeSpan.Zero);
        clock.Set(clock.GetUtcNow().AddMinutes(11));   // past the claim lease

        await sender.RunAsync(db, tenant, false, default);

        Assert.Empty(eh.Requests.Where(r => r.Method == HttpMethod.Post));
        Assert.Single(eh.Requests, r => r.Method == HttpMethod.Put);
    }

    [Fact]
    public async Task Send_missing_answers_409_when_queuing_collides()
    {
        var (db, tenant) = await OrgAsync(extra: new FailSaveOnce());
        await using var _ = db;
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        await EhTimesheetFixture.ApprovedShiftAsync(db, tenant, worker, new DateOnly(2026, 10, 8), Nine, Three);

        var result = await Controller(db, tenant, new StubHttpHandler()).SendMissing(new PayrollRangeDto(From, To), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Contains(EmploymentHeroPayrollController.CollisionMessage, string.Join(" ", ((ApiResponse<SendMissingResultDto>)conflict.Value!).Errors));
    }
}
