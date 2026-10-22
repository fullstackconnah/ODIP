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
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Tests.Imports;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;

namespace Odip.Tests.Integrations;

/// <summary>The Settings card's timesheet parts: its counts, the work types, the cutoff on Connect and the queue on a business change.</summary>
public class EmploymentHeroTimesheetCardTests
{
    /// <summary>Throws a concurrency conflict from the first save that touches an outbox row, as a drain claiming it at that moment would.</summary>
    private sealed class ConflictOnce : SaveChangesInterceptor
    {
        public int Thrown { get; private set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (Thrown == 0 && eventData.Context!.ChangeTracker.Entries<EmploymentHeroOutbox>().Any(e => e.State is EntityState.Modified or EntityState.Deleted))
            {
                Thrown++;
                throw new DbUpdateConcurrencyException("claimed", new List<Microsoft.EntityFrameworkCore.Update.IUpdateEntry>());
            }
            return base.SavingChangesAsync(eventData, result, ct);
        }
    }

    private static OdipDbContext DbWith(string name, Guid tenantId, params IInterceptor[] extra) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).AddInterceptors(new AuditInterceptor(new HttpContextAccessor())).AddInterceptors(extra).Options,
            ImportTestSupport.Tenant(tenantId));

    private static EmploymentHeroController Controller(OdipDbContext db, Guid tenantId, StubHttpHandler eh)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new EmploymentHeroController(db, tenant.Object, Keys, StubHttpHandler.Client(eh), Sync(eh), Clock())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = ImportTestSupport.Admin() } },
        };
    }

    private static T Data<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static StubHttpHandler WorkTypes() => new StubHttpHandler().On("/api/v2/business/777/worktype", HttpStatusCode.OK, new object[]
    {
        new { id = 7, name = "Ordinary hours", mappingType = "PrimaryPayCategory" },
        new { id = 8, name = "Active night", mappingType = "PayCategory" },
        new { id = 9, name = "Annual leave", mappingType = "Leave" },
        new { id = 10, name = "Broken shift", mappingType = "ShiftCondition" },
    });

    private static EmploymentHeroOutbox Row(Guid tenant, EmploymentHeroOutboxStatus status, int attempts = 0, EmploymentHeroOutboxKind kind = EmploymentHeroOutboxKind.Timesheet) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenant, Kind = kind, EntityId = Guid.NewGuid(), Status = status, Attempts = attempts,
        NextAttemptAt = Clock().GetUtcNow().UtcDateTime.AddHours(1), CreatedAt = Clock().GetUtcNow().UtcDateTime, UpdatedAt = Clock().GetUtcNow().UtcDateTime,
    };

    [Fact]
    public async Task Status_counts_this_organisations_timesheets_only()
    {
        var name = Guid.NewGuid().ToString();
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        await using var dbA = Db(name, a);
        await ConnectAsync(dbA, a);
        await using (var dbB = Db(name, b))
        {
            await ConnectAsync(dbB, b);
            dbB.EmploymentHeroOutbox.AddRange(Enumerable.Range(0, 5).Select(_ => Row(b, EmploymentHeroOutboxStatus.Sent)));
            await dbB.SaveChangesAsync();
        }
        dbA.EmploymentHeroOutbox.AddRange(Row(a, EmploymentHeroOutboxStatus.Sent), Row(a, EmploymentHeroOutboxStatus.Sent), Row(a, EmploymentHeroOutboxStatus.Pending),
            Row(a, EmploymentHeroOutboxStatus.Failed), Row(a, EmploymentHeroOutboxStatus.Pending, kind: EmploymentHeroOutboxKind.Leave));   // a leave row is not a timesheet
        await dbA.SaveChangesAsync();

        var status = Data(await Controller(dbA, a, new StubHttpHandler()).Status(CancellationToken.None));

        Assert.Equal((2, 2), (status.TimesheetsSent, status.TimesheetsWaiting));
    }

    [Fact]
    public async Task Work_types_list_is_read_live_without_leave_or_shift_condition_types()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);

        var list = Data(await Controller(db, tenant, WorkTypes()).WorkTypes(CancellationToken.None));

        Assert.Equal(["8:Active night", "7:Ordinary hours"], list.Select(w => $"{w.Id}:{w.Name}"));
    }

    [Fact]
    public async Task Work_types_are_saved_audited_and_requeue_waiting_shifts()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        var waiting = Row(tenant, EmploymentHeroOutboxStatus.Pending);
        var claimed = Row(tenant, EmploymentHeroOutboxStatus.Pending, attempts: 1);
        var claimedAt = claimed.NextAttemptAt;
        db.EmploymentHeroOutbox.AddRange(waiting, claimed);
        await db.SaveChangesAsync();

        var status = Data(await Controller(db, tenant, WorkTypes()).SaveWorkTypes(new EmploymentHeroWorkTypesDto("7", " 8 ", null, ""), CancellationToken.None));

        Assert.Equal(new EmploymentHeroWorkTypesDto("7", "8", null, null), status.WorkTypes);
        Assert.Equal(Clock().GetUtcNow().UtcDateTime, (await db.EmploymentHeroOutbox.SingleAsync(r => r.Id == waiting.Id)).NextAttemptAt);
        Assert.Equal(claimedAt, (await db.EmploymentHeroOutbox.SingleAsync(r => r.Id == claimed.Id)).NextAttemptAt);
        var audits = (await db.AuditLogs.ToListAsync()).Where(a => a.Changes.Contains("Employment Hero work type")).ToList();
        Assert.Equal(2, audits.Count);   // only the two fields that changed
        Assert.Contains(audits, a => a.Changes.Contains("day and evening shifts") && a.Changes.Contains("Ordinary hours") && a.Changes.Contains("not set"));
        Assert.DoesNotContain(audits, a => a.Changes.Contains(ApiKey));
    }

    [Fact]
    public async Task A_work_type_EH_does_not_have_is_refused_and_nothing_changes()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);

        var result = await Controller(db, tenant, WorkTypes()).SaveWorkTypes(new EmploymentHeroWorkTypesDto("7", "99", null, null), CancellationToken.None);

        var refusal = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("isn't in Employment Hero any more", string.Join(" ", ((ApiResponse<EmploymentHeroStatusDto>)refusal.Value!).Errors));
        Assert.Null((await db.EmploymentHeroConnections.SingleAsync()).WorkTypeStandard);
    }

    [Fact]
    public async Task A_work_types_save_that_collides_with_a_claim_is_retried_once()
    {
        var tenant = Guid.NewGuid();
        var conflict = new ConflictOnce();
        await using var db = DbWith(Guid.NewGuid().ToString(), tenant, conflict);
        await ConnectAsync(db, tenant);
        db.EmploymentHeroOutbox.Add(Row(tenant, EmploymentHeroOutboxStatus.Pending));
        await db.SaveChangesAsync();

        var status = Data(await Controller(db, tenant, WorkTypes()).SaveWorkTypes(new EmploymentHeroWorkTypesDto("7", null, null, null), CancellationToken.None));

        Assert.Equal(1, conflict.Thrown);
        Assert.Equal("7", status.WorkTypes.Standard);
    }

    [Fact]
    public async Task A_same_business_connect_keeps_ConnectedAt_and_a_different_business_sets_it_to_now()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        var first = (await db.EmploymentHeroConnections.SingleAsync()).ConnectedAt;
        var eh = new StubHttpHandler().On("/api/v2/business/777", HttpStatusCode.OK, new { id = 777, name = "Acme Care" })
            .On("/api/v2/business/888", HttpStatusCode.OK, new { id = 888, name = "Other" });

        await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto(ApiKey, "777"), CancellationToken.None);
        Assert.Equal(first, (await db.EmploymentHeroConnections.SingleAsync()).ConnectedAt);

        await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto(ApiKey, "888"), CancellationToken.None);
        Assert.Equal(Clock().GetUtcNow().UtcDateTime, (await db.EmploymentHeroConnections.SingleAsync()).ConnectedAt);
    }

    [Fact]
    public async Task Reconnecting_to_another_business_clears_the_queue_and_the_same_business_keeps_it()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        db.EmploymentHeroOutbox.AddRange(Row(tenant, EmploymentHeroOutboxStatus.Sent), Row(tenant, EmploymentHeroOutboxStatus.Pending, kind: EmploymentHeroOutboxKind.Leave));
        await db.SaveChangesAsync();
        var eh = new StubHttpHandler().On("/api/v2/business/777", HttpStatusCode.OK, new { id = 777, name = "Acme Care" })
            .On("/api/v2/business/888", HttpStatusCode.OK, new { id = 888, name = "Other" });

        await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto(ApiKey, "777"), CancellationToken.None);
        Assert.Equal(2, await db.EmploymentHeroOutbox.CountAsync());

        await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto(ApiKey, "888"), CancellationToken.None);
        Assert.Empty(await db.EmploymentHeroOutbox.ToListAsync());   // every Kind
    }

    [Fact]
    public async Task Forgetting_the_queue_survives_one_claim_landing_meanwhile()
    {
        var tenant = Guid.NewGuid();
        var conflict = new ConflictOnce();
        await using var db = DbWith(Guid.NewGuid().ToString(), tenant, conflict);
        await ConnectAsync(db, tenant);
        db.EmploymentHeroOutbox.Add(Row(tenant, EmploymentHeroOutboxStatus.Sent));
        await db.SaveChangesAsync();
        var eh = new StubHttpHandler().On("/api/v2/business/888", HttpStatusCode.OK, new { id = 888, name = "Other" });

        await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto(ApiKey, "888"), CancellationToken.None);

        Assert.Equal(1, conflict.Thrown);
        Assert.Empty(await db.EmploymentHeroOutbox.ToListAsync());
        Assert.Equal("888", (await db.EmploymentHeroConnections.SingleAsync()).BusinessId);
    }
}
