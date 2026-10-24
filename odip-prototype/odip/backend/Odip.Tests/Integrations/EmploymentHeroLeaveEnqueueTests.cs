using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Imports;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>Leave is queued for Employment Hero in the save that decides it, taken back in the save that cancels it, and EH-entered leave is read-only in ODIP.</summary>
public class EmploymentHeroLeaveEnqueueTests
{
    private sealed class FailingSave : SaveChangesInterceptor
    {
        public Exception? Throw { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default) =>
            Throw is { } ex ? throw ex : base.SavingChangesAsync(eventData, result, ct);
    }

    private static DbUpdateException OutboxCollision() => new("duplicate key value violates unique constraint", new PostgresException(
        messageText: "duplicate key value violates unique constraint", severity: "ERROR", invariantSeverity: "ERROR",
        sqlState: PostgresErrorCodes.UniqueViolation, tableName: "EmploymentHeroOutbox", constraintName: EmploymentHeroOutbox.OneRowIndexName));

    private sealed record World(string Store, Guid TenantId, OdipDbContext Db, FailingSave Fail, User Sam, User Ada, FakeClock Clock);

    private static OdipDbContext Open(string store, Guid tenantId, FailingSave? fail = null) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(store).AddInterceptors(new AuditInterceptor(new HttpContextAccessor()), fail ?? new FailingSave()).Options,
            ImportTestSupport.Tenant(tenantId));

    /// <summary>A connected organisation with Sam (linked) and Ada (the Admin); the clock stands one day after the leave cutoff.</summary>
    private static async Task<World> WorldAsync(bool connected = true)
    {
        var store = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        var fail = new FailingSave();
        var db = Open(store, tenantId, fail);
        var sam = EhFixture.Staff(tenantId, "Sam", "Lee", "sam@acme.org.au", "42");
        EmploymentHeroConnection? conn = null;
        if (connected) conn = await EhFixture.ConnectAsync(db, tenantId);
        else { db.Tenants.Add(new Tenant { Id = tenantId, Name = "Acme Care", EmailDomain = "acme.org.au" }); db.Users.Add(EhFixture.Staff(tenantId, "Ada", "Admin", "ada@acme.org.au", "1", UserRole.Admin)); }
        db.Users.Add(sam);
        await db.SaveChangesAsync();
        var ada = await db.Users.SingleAsync(u => u.Email == "ada@acme.org.au");
        var cutoff = EmploymentHeroLeave.Cutoff(conn?.ConnectedAt ?? new DateTime(2026, 10, 13, 0, 0, 0, DateTimeKind.Utc));
        var clock = new FakeClock(new DateTimeOffset(DateTime.SpecifyKind(cutoff.AddDays(1), DateTimeKind.Utc)));
        return new World(store, tenantId, db, fail, sam, ada, clock);
    }

    private static LeaveController Controller(World w, Guid callerId)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerId.ToString())], "Test");
        return new LeaveController(w.Db, clock: w.Clock) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } } };
    }

    private static DateOnly Start(World w) => DateOnly.FromDateTime(w.Clock.GetUtcNow().UtcDateTime).AddDays(10);

    private static async Task<LeaveRequest> SeedLeaveAsync(World w, LeaveStatus status = LeaveStatus.Pending, LeaveSource source = LeaveSource.Odip, string? externalId = null, DateTime? decidedAt = null)
    {
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = w.Sam.Id, LeaveType = LeaveType.Annual, StartDate = Start(w), EndDate = Start(w).AddDays(4), Status = status, Source = source,
            ExternalLeaveId = externalId, RequestedByUserId = w.Sam.Id, RequestedAt = w.Clock.GetUtcNow().UtcDateTime, DecidedAt = decidedAt,
        };
        w.Db.LeaveRequests.Add(leave);
        await w.Db.SaveChangesAsync();
        return leave;
    }

    private static Task<List<EmploymentHeroOutbox>> Rows(string store, Guid tenantId) => Open(store, tenantId).EmploymentHeroOutbox.IgnoreQueryFilters().ToListAsync();

    [Fact]
    public async Task Approving_leave_queues_it_in_the_same_save()
    {
        var w = await WorldAsync();
        var leave = await SeedLeaveAsync(w);

        var result = await Controller(w, w.Ada.Id).ApproveLeave(leave.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var row = Assert.Single(await Rows(w.Store, w.TenantId));
        Assert.Equal((EmploymentHeroOutboxKind.Leave, leave.Id, EmploymentHeroOutboxStatus.Pending, w.TenantId), (row.Kind, row.EntityId, row.Status, row.TenantId));
        Assert.Equal(w.Clock.GetUtcNow().UtcDateTime, row.NextAttemptAt);
    }

    [Fact]
    public async Task A_failed_approval_save_keeps_neither_the_approval_nor_the_row()
    {
        var w = await WorldAsync();
        var leave = await SeedLeaveAsync(w);
        w.Fail.Throw = new InvalidOperationException("boom");

        await Assert.ThrowsAsync<InvalidOperationException>(() => Controller(w, w.Ada.Id).ApproveLeave(leave.Id, CancellationToken.None));

        Assert.Empty(await Rows(w.Store, w.TenantId));
        Assert.Equal(LeaveStatus.Pending, (await Open(w.Store, w.TenantId).LeaveRequests.SingleAsync()).Status);
    }

    [Fact]
    public async Task Entering_leave_on_behalf_queues_it()
    {
        var w = await WorldAsync();

        var result = await Controller(w, w.Ada.Id).CreateLeave(new CreateLeaveRequestDto { UserId = w.Sam.Id, LeaveType = LeaveType.Annual, StartDate = Start(w), EndDate = Start(w).AddDays(2) }, CancellationToken.None);

        Assert.Equal(201, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        var row = Assert.Single(await Rows(w.Store, w.TenantId));
        Assert.Equal(w.TenantId, row.TenantId);
        Assert.Equal(EmploymentHeroOutboxKind.Leave, row.Kind);
    }

    [Fact]
    public async Task Nothing_is_queued_when_not_connected()
    {
        var w = await WorldAsync(connected: false);
        var leave = await SeedLeaveAsync(w);

        await Controller(w, w.Ada.Id).ApproveLeave(leave.Id, CancellationToken.None);

        Assert.Empty(await Rows(w.Store, w.TenantId));
    }

    [Fact]
    public async Task Another_organisations_connection_does_not_queue_this_one()
    {
        var w = await WorldAsync(connected: false);
        var other = Guid.NewGuid();
        await using (var otherDb = Open(w.Store, other))
        {
            await EhFixture.ConnectAsync(otherDb, other);
        }
        var leave = await SeedLeaveAsync(w);

        await Controller(w, w.Ada.Id).ApproveLeave(leave.Id, CancellationToken.None);

        Assert.Empty(await Rows(w.Store, w.TenantId));
    }

    [Fact]
    public async Task Cancelling_a_queued_or_sent_leave_queues_its_cancel_in_the_same_save()
    {
        var w = await WorldAsync();
        var queued = await SeedLeaveAsync(w, LeaveStatus.Approved, decidedAt: w.Clock.GetUtcNow().UtcDateTime);
        w.Db.EmploymentHeroOutbox.Add(EmploymentHeroLeave.NewRow(w.TenantId, EmploymentHeroOutboxKind.Leave, queued.Id, w.Clock.GetUtcNow().UtcDateTime));
        var none = await SeedLeaveAsync(w, LeaveStatus.Approved);
        var adopted = await SeedLeaveAsync(w, LeaveStatus.Approved, externalId: "9001");
        await w.Db.SaveChangesAsync();
        var c = Controller(w, w.Ada.Id);

        await c.CancelLeave(queued.Id, CancellationToken.None);
        await c.CancelLeave(none.Id, CancellationToken.None);
        await c.CancelLeave(adopted.Id, CancellationToken.None);

        var cancels = (await Rows(w.Store, w.TenantId)).Where(r => r.Kind == EmploymentHeroOutboxKind.LeaveCancel).Select(r => r.EntityId).Order().ToList();
        Assert.Equal(new[] { queued.Id, adopted.Id }.Order().ToList(), cancels);
    }

    [Fact]
    public async Task Leave_decided_before_the_epoch_is_not_queued_even_after_a_reconnect()
    {
        var w = await WorldAsync();
        var conn = await w.Db.EmploymentHeroConnections.SingleAsync();
        conn.ConnectedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        await w.Db.SaveChangesAsync();
        var before = await SeedLeaveAsync(w, LeaveStatus.Approved, decidedAt: EmploymentHeroLeave.LeaveSyncEpoch.AddDays(-1));
        var after = await SeedLeaveAsync(w, LeaveStatus.Approved, decidedAt: EmploymentHeroLeave.LeaveSyncEpoch.AddDays(1));

        await EmploymentHeroLeave.EnqueueAsync(w.Db, before, w.Clock.GetUtcNow().UtcDateTime, CancellationToken.None);
        await EmploymentHeroLeave.EnqueueAsync(w.Db, after, w.Clock.GetUtcNow().UtcDateTime, CancellationToken.None);
        await w.Db.SaveChangesAsync();

        Assert.Equal(after.Id, Assert.Single(await Rows(w.Store, w.TenantId)).EntityId);
    }

    [Fact]
    public async Task A_colliding_second_approval_is_409()
    {
        var w = await WorldAsync();
        var leave = await SeedLeaveAsync(w);
        w.Fail.Throw = OutboxCollision();

        var result = await Controller(w, w.Ada.Id).ApproveLeave(leave.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal("This request has already been decided.", Assert.IsType<ApiResponse<LeaveApprovalResultDto>>(conflict.Value).Errors!.Single());
    }

    [Fact]
    public async Task Any_other_failed_save_is_not_hidden_as_a_409()
    {
        var w = await WorldAsync();
        var leave = await SeedLeaveAsync(w);
        w.Fail.Throw = new DbUpdateException("other", new InvalidOperationException("not a unique violation"));

        await Assert.ThrowsAsync<DbUpdateException>(() => Controller(w, w.Ada.Id).ApproveLeave(leave.Id, CancellationToken.None));
    }

    [Fact]
    public async Task A_colliding_second_cancel_is_409()
    {
        var w = await WorldAsync();
        var leave = await SeedLeaveAsync(w, LeaveStatus.Approved, externalId: "9001");
        w.Fail.Throw = OutboxCollision();

        var result = await Controller(w, w.Ada.Id).CancelLeave(leave.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal("This request has already been cancelled.", Assert.IsType<ApiResponse<LeaveRequestDto>>(conflict.Value).Errors!.Single());
    }

    [Fact]
    public async Task EH_leave_cannot_be_edited_or_cancelled_here()
    {
        var w = await WorldAsync();
        var leave = await SeedLeaveAsync(w, LeaveStatus.Approved, LeaveSource.EmploymentHero, "9001");
        var c = Controller(w, w.Ada.Id);

        var edit = await c.UpdateLeave(leave.Id, new UpdateLeaveRequestDto { LeaveType = LeaveType.Sick, StartDate = Start(w), EndDate = Start(w) }, CancellationToken.None);
        var cancel = await c.CancelLeave(leave.Id, CancellationToken.None);

        Assert.Equal(EmploymentHeroLeave.FromEhMessage, Assert.IsType<ApiResponse<LeaveApprovalResultDto>>(Assert.IsType<ConflictObjectResult>(edit.Result).Value).Errors!.Single());
        Assert.Equal(EmploymentHeroLeave.FromEhMessage, Assert.IsType<ApiResponse<LeaveRequestDto>>(Assert.IsType<ConflictObjectResult>(cancel.Result).Value).Errors!.Single());
        var stored = await Open(w.Store, w.TenantId).LeaveRequests.SingleAsync();
        Assert.Equal((LeaveStatus.Approved, LeaveType.Annual), (stored.Status, stored.LeaveType));
        Assert.Empty(await Rows(w.Store, w.TenantId));
    }

    [Fact]
    public async Task An_EH_leave_with_no_EH_id_can_be_cancelled()
    {
        var w = await WorldAsync();
        var leave = await SeedLeaveAsync(w, LeaveStatus.Approved, LeaveSource.EmploymentHero);

        var result = await Controller(w, w.Ada.Id).CancelLeave(leave.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(LeaveStatus.Cancelled, (await Open(w.Store, w.TenantId).LeaveRequests.SingleAsync()).Status);
        Assert.Empty(await Rows(w.Store, w.TenantId));
    }

    [Fact]
    public async Task The_leave_DTO_says_where_it_came_from_and_what_was_sent()
    {
        var w = await WorldAsync();
        var leave = await SeedLeaveAsync(w, LeaveStatus.Approved, LeaveSource.EmploymentHero, "9001");
        leave.SentHours = 22.8m;
        leave.SentHoursDefaulted = true;
        await w.Db.SaveChangesAsync();

        var listed = Assert.Single(Assert.IsType<ApiResponse<List<LeaveRequestDto>>>(Assert.IsType<OkObjectResult>((await Controller(w, w.Ada.Id).GetLeave(null, null, null, null, CancellationToken.None)).Result).Value).Data!);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, w.Sam.Id.ToString())], "Test");
        var portal = new PortalController(w.Db, ImportTestSupport.Tenant(w.TenantId))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
        var mine = Assert.Single(Assert.IsType<ApiResponse<PortalLeaveResponseDto>>(Assert.IsType<OkObjectResult>((await portal.GetMyLeave(CancellationToken.None)).Result).Value).Data!.Leave);

        foreach (var dto in new[] { listed, mine })
            Assert.Equal((LeaveSource.EmploymentHero, (decimal?)22.8m, (bool?)true), (dto.Source, dto.SentHours, dto.SentHoursDefaulted));
    }
}
