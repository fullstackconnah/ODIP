using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Integrations;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Imports;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;
using static Odip.Tests.Integrations.StubHttpHandler;

namespace Odip.Tests.Integrations;

/// <summary>The leave half of the Employment Hero card: counts, problems, leave categories, Try again, and what a new business forgets.</summary>
public class EmploymentHeroLeaveCardTests
{
    private static EmploymentHeroController Controller(OdipDbContext db, Guid tenantId, StubHttpHandler eh)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        return new EmploymentHeroController(db, tenant.Object, Keys, Client(eh), Sync(eh, null), Clock())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = ImportTestSupport.Admin() } },
        };
    }

    private static T Data<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static StubHttpHandler Categories() => new StubHttpHandler().On("/api/v2/business/777/leavecategory", HttpStatusCode.OK,
        new object[] { new { id = 5, name = "Annual leave" }, new { id = 7, name = "Personal leave" }, new { id = 8, name = "Another" } });

    private const string WaitingReason = "Choose the Employment Hero leave category for annual leave in Settings → Integrations.";

    private static readonly DateOnly Today = DateOnly.FromDateTime(Clock().GetUtcNow().UtcDateTime.AddHours(11));

    private static async Task<LeaveRequest> LeaveAsync(OdipDbContext db, Guid tenant, User worker, DateOnly from, DateOnly to, LeaveStatus status = LeaveStatus.Approved)
    {
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenant, UserId = worker.Id, LeaveType = LeaveType.Annual, StartDate = from, EndDate = to, Status = status,
            RequestedByUserId = worker.Id, RequestedAt = DateTime.UtcNow, DecidedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        return leave;
    }

    private static EmploymentHeroOutbox Row(Guid tenant, LeaveRequest leave, EmploymentHeroOutboxKind kind, EmploymentHeroOutboxStatus status, int attempts = 0, string? error = null, string? externalId = null)
    {
        var row = new EmploymentHeroOutbox
        {
            Id = Guid.NewGuid(), TenantId = tenant, Kind = kind, EntityId = leave.Id, Status = status, Attempts = attempts, LastError = error, ExternalId = externalId,
            NextAttemptAt = Clock().GetUtcNow().UtcDateTime.AddMinutes(10),
        };
        return row;
    }

    [Fact]
    public async Task Status_counts_this_organisations_leave_only()
    {
        var name = Guid.NewGuid().ToString();
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        await using (var other = Db(name, b))
        {
            await ConnectAsync(other, b);
            var theirs = await EhTimesheetFixture.WorkerAsync(other, b);
            for (var i = 0; i < 5; i++)
            {
                var l = await LeaveAsync(other, b, theirs, Today.AddDays(i), Today.AddDays(i));
                other.EmploymentHeroOutbox.Add(Row(b, l, EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Sent, 1, externalId: "1"));
            }
            await other.SaveChangesAsync();
        }
        await using var db = Db(name, a);
        await ConnectAsync(db, a);
        var worker = await EhTimesheetFixture.WorkerAsync(db, a);
        EmploymentHeroOutbox Add(DateOnly day, EmploymentHeroOutboxKind kind, EmploymentHeroOutboxStatus status, int attempts = 0, string? error = null, int length = 0)
        {
            var l = LeaveAsync(db, a, worker, day, day.AddDays(length), kind == EmploymentHeroOutboxKind.LeaveCancel ? LeaveStatus.Cancelled : LeaveStatus.Approved).GetAwaiter().GetResult();
            var r = Row(a, l, kind, status, attempts, error);
            db.EmploymentHeroOutbox.Add(r);
            return r;
        }
        Add(Today.AddDays(1), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Sent, 1);
        Add(Today.AddDays(2), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Sent, 1);
        Add(Today.AddDays(3), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Pending);
        var failed = Add(Today.AddDays(4), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Failed, 3, "Employment Hero refused it.");
        Add(Today.AddDays(5), EmploymentHeroOutboxKind.LeaveCancel, EmploymentHeroOutboxStatus.NeedsAttention, 6, "ODIP stopped trying after six tries.");
        Add(Today.AddDays(6), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Pending, 0, WaitingReason);
        var cancelled = Add(Today.AddDays(7), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Sent, 1);
        db.EmploymentHeroOutbox.Add(Row(a, await db.LeaveRequests.SingleAsync(l => l.Id == cancelled.EntityId), EmploymentHeroOutboxKind.LeaveCancel, EmploymentHeroOutboxStatus.Sent, 1));
        Add(Today.AddDays(-70), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Failed, 3, "Old failure.");
        db.EmploymentHeroOutbox.Add(new EmploymentHeroOutbox { Id = Guid.NewGuid(), TenantId = a, Kind = EmploymentHeroOutboxKind.Timesheet, EntityId = Guid.NewGuid(), Status = EmploymentHeroOutboxStatus.Failed });
        await db.SaveChangesAsync();

        var status = Data(await Controller(db, a, new StubHttpHandler()).Status(CancellationToken.None));

        Assert.Equal((2, 2), (status.LeaveSent, status.LeaveWaiting));
        Assert.Equal(3, status.LeaveProblems.Count);
        var waiting = Assert.Single(status.LeaveProblems, p => p.Waiting);
        Assert.Equal(WaitingReason, waiting.Reason);
        Assert.Equal("Ben Turner", waiting.Name);
        Assert.Single(status.LeaveProblems, p => p.Cancelling);
        var failure = Assert.Single(status.LeaveProblems, p => p.Id == failed.Id);
        Assert.StartsWith("Employment Hero refused it. ODIP tries again at ", failure.Reason);
        Assert.DoesNotContain(status.LeaveProblems, p => p.Reason == "Old failure.");
    }

    [Fact]
    public async Task Leave_categories_are_saved_audited_and_requeue_waiting_leave()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var held = Row(tenant, await LeaveAsync(db, tenant, worker, Today, Today), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Pending);
        var claimed = Row(tenant, await LeaveAsync(db, tenant, worker, Today.AddDays(1), Today.AddDays(1)), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Pending, 1);
        var claimedAt = claimed.NextAttemptAt;
        db.EmploymentHeroOutbox.AddRange(held, claimed);
        await db.SaveChangesAsync();
        var before = held.UpdatedAt;

        var status = Data(await Controller(db, tenant, Categories()).SaveLeaveCategories(new EmploymentHeroLeaveCategoriesDto("5", " 7 ", null, ""), CancellationToken.None));

        Assert.Equal(new EmploymentHeroLeaveCategoriesDto("5", "7", null, null), status.LeaveCategories);
        var requeued = await db.EmploymentHeroOutbox.AsNoTracking().SingleAsync(r => r.Id == held.Id);
        Assert.Equal(Clock().GetUtcNow().UtcDateTime, requeued.NextAttemptAt);
        Assert.Equal(EmploymentHeroTimesheetSender.Stamp(before, Clock().GetUtcNow().UtcDateTime), requeued.UpdatedAt);
        Assert.Equal(claimedAt, (await db.EmploymentHeroOutbox.AsNoTracking().SingleAsync(r => r.Id == claimed.Id)).NextAttemptAt);
        var audits = (await db.AuditLogs.ToListAsync()).Where(a => a.Changes.Contains("Employment Hero leave category")).ToList();
        Assert.Equal(2, audits.Count);
        Assert.Contains(audits, a => a.Changes.Contains("annual leave") && a.Changes.Contains("Annual leave") && a.Changes.Contains("not set"));
        Assert.DoesNotContain(audits, a => a.Changes.Contains(ApiKey));
    }

    [Fact]
    public async Task A_category_EH_does_not_have_is_refused_and_nothing_changes()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);

        var result = await Controller(db, tenant, Categories()).SaveLeaveCategories(new EmploymentHeroLeaveCategoriesDto("5", "99", null, null), CancellationToken.None);

        var refusal = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("isn't in Employment Hero any more", string.Join(" ", ((ApiResponse<EmploymentHeroStatusDto>)refusal.Value!).Errors));
        Assert.Null((await db.EmploymentHeroConnections.SingleAsync()).LeaveCategoryAnnual);
    }

    [Fact]
    public async Task Leave_categories_are_listed_by_name()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);

        var list = Data(await Controller(db, tenant, Categories()).LeaveCategories(CancellationToken.None));

        Assert.Equal(["5:Annual leave", "8:Another", "7:Personal leave"], list.Select(c => $"{c.Id}:{c.Name}"));
    }

    [Theory]
    [InlineData(6, 1)]
    [InlineData(0, 0)]
    public async Task Try_again_requeues_a_problem_and_keeps_find_first(int attempts, int expected)
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var row = Row(tenant, await LeaveAsync(db, tenant, worker, Today, Today), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Failed, attempts, "Employment Hero refused it.");
        db.EmploymentHeroOutbox.Add(row);
        await db.SaveChangesAsync();

        Data(await Controller(db, tenant, new StubHttpHandler()).RetryLeave(row.Id, CancellationToken.None));

        var after = await db.EmploymentHeroOutbox.AsNoTracking().SingleAsync(r => r.Id == row.Id);
        Assert.Equal((EmploymentHeroOutboxStatus.Pending, expected, (string?)null), (after.Status, after.Attempts, after.LastError));
        Assert.Equal(Clock().GetUtcNow().UtcDateTime, after.NextAttemptAt);
    }

    [Fact]
    public async Task Try_again_with_an_EH_id_starts_the_count_again()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var row = Row(tenant, await LeaveAsync(db, tenant, worker, Today, Today), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.NeedsAttention, 4, "x", externalId: "9001");
        db.EmploymentHeroOutbox.Add(row);
        await db.SaveChangesAsync();

        await Controller(db, tenant, new StubHttpHandler()).RetryLeave(row.Id, CancellationToken.None);

        Assert.Equal(0, (await db.EmploymentHeroOutbox.AsNoTracking().SingleAsync(r => r.Id == row.Id)).Attempts);
    }

    [Fact]
    public async Task Try_again_on_another_organisations_row_is_404()
    {
        var name = Guid.NewGuid().ToString();
        Guid mine = Guid.NewGuid(), theirs = Guid.NewGuid();
        Guid rowId;
        await using (var other = Db(name, theirs))
        {
            await ConnectAsync(other, theirs);
            var worker = await EhTimesheetFixture.WorkerAsync(other, theirs);
            var row = Row(theirs, await LeaveAsync(other, theirs, worker, Today, Today), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Failed, 3, "x");
            other.EmploymentHeroOutbox.Add(row);
            await other.SaveChangesAsync();
            rowId = row.Id;
        }
        await using var db = Db(name, mine);
        await ConnectAsync(db, mine);

        var result = await Controller(db, mine, new StubHttpHandler()).RetryLeave(rowId, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        await using var check = Db(name, theirs);
        Assert.Equal(EmploymentHeroOutboxStatus.Failed, (await check.EmploymentHeroOutbox.SingleAsync()).Status);
    }

    private sealed class RefusingSave : SaveChangesInterceptor
    {
        public bool On;
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            On ? throw new DbUpdateException("collision") : base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    [Fact]
    public async Task Try_again_answers_409_when_it_collides()
    {
        var name = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        var refusing = new RefusingSave();
        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).AddInterceptors(refusing).Options, ImportTestSupport.Tenant(tenant));
        await ConnectAsync(db, tenant);
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var row = Row(tenant, await LeaveAsync(db, tenant, worker, Today, Today), EmploymentHeroOutboxKind.Leave, EmploymentHeroOutboxStatus.Failed, 3, "x");
        db.EmploymentHeroOutbox.Add(row);
        await db.SaveChangesAsync();
        refusing.On = true;

        var result = await Controller(db, tenant, new StubHttpHandler()).RetryLeave(row.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Contains(EmploymentHeroController.RetryCollisionMessage, ((ApiResponse<EmploymentHeroStatusDto>)conflict.Value!).Errors);
    }

    [Fact]
    public async Task A_different_business_reconnect_forgets_EH_leave_ids()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        var worker = await EhTimesheetFixture.WorkerAsync(db, tenant);
        var leave = await LeaveAsync(db, tenant, worker, Today, Today);
        leave.ExternalLeaveId = "9001";
        await db.SaveChangesAsync();
        var eh = new StubHttpHandler().On("/api/v2/business/888", HttpStatusCode.OK, new { id = 888, name = "Acme Care (new)" });

        await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto(ApiKey, "888"), CancellationToken.None);

        Assert.Null((await db.LeaveRequests.AsNoTracking().SingleAsync(l => l.Id == leave.Id)).ExternalLeaveId);
    }
}
