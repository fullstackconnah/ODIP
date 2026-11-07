using System.Security.Claims;
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
using Odip.Tests.Integrations;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Leave;

/// <summary>
/// H31-1 on a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): a coordinator's approve and the worker's withdraw both loaded the same
/// Pending leave. UpdatedAt is the row's version, so the second save matches no row and answers 409 with its existing refusal text, saving nothing: the leave
/// ends in the first decision's status and the Employment Hero outbox holds only what that decision queued. The loser is made by loading the leave into its
/// context first, which is what a request whose read ran before the other's save looks like.
/// </summary>
public class LeaveDecisionRacePostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public LeaveDecisionRacePostgresTests(PostgresFixture pg) => _pg = pg;

    private OdipDbContext Open(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return PostgresFixture.NewContext(_pg.ConnectionString, tenant.Object);
    }

    private static ControllerContext Caller(Guid userId, UserRole role) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role.ToString()), new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "Test")),
        },
    };

    /// <summary>A connected organisation with a coordinator, a worker and the worker's Pending leave.</summary>
    private async Task<(Guid TenantId, Guid CoordinatorId, Guid WorkerId, Guid LeaveId)> SeedAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", db.Database.ProviderName);   // so an InMemory run can never satisfy this class
        var coordinator = EhFixture.Staff(tenantId, "Cora", "Coordinator", $"{Guid.NewGuid():N}@example.com", null, UserRole.Coordinator);
        var worker = EhFixture.Staff(tenantId, "Wes", "Worker", $"{Guid.NewGuid():N}@example.com", "42");
        var (cipher, nonce) = EhFixture.Keys.Protect(EhFixture.ApiKey, tenantId);
        db.Users.AddRange(coordinator, worker);
        db.EmploymentHeroConnections.Add(new EmploymentHeroConnection
        {
            Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = EhFixture.Business, BusinessName = "Acme Care", ApiKeyCiphertext = cipher, ApiKeyNonce = nonce,
            ConnectedAt = new DateTime(2026, 10, 13, 0, 0, 0, DateTimeKind.Utc), ConnectedByName = "Ada Admin",
        });
        var day = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(10);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = worker.Id, LeaveType = LeaveType.Annual, StartDate = day, EndDate = day, Status = LeaveStatus.Pending,
            RequestedByUserId = worker.Id, RequestedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync(Ct);
        return (tenantId, coordinator.Id, worker.Id, leave.Id);
    }

    private async Task<(LeaveStatus Status, List<EmploymentHeroOutboxKind> Outbox)> StoredAsync(Guid tenantId, Guid leaveId)
    {
        await using var check = Open(tenantId);
        var status = (await check.LeaveRequests.AsNoTracking().SingleAsync(l => l.Id == leaveId, Ct)).Status;
        return (status, await check.EmploymentHeroOutbox.AsNoTracking().Where(r => r.EntityId == leaveId).Select(r => r.Kind).ToListAsync(Ct));
    }

    [SkippableFact(DisplayName = "Postgres: an approve then a withdraw of the same Pending leave: the withdraw is 409, the leave stays Approved, one Leave outbox row")]
    public async Task ApproveWins_TheWithdrawIs409_AndSavesNothing()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, coordinatorId, workerId, leaveId) = await SeedAsync();
        await using var coordinatorDb = Open(tenantId);
        await using var workerDb = Open(tenantId);
        await workerDb.LeaveRequests.SingleAsync(l => l.Id == leaveId, Ct);

        Assert.IsType<OkObjectResult>((await new LeaveController(coordinatorDb) { ControllerContext = Caller(coordinatorId, UserRole.Coordinator) }.ApproveLeave(leaveId, Ct)).Result);
        var portal = new PortalController(workerDb, Mock.Of<ICurrentTenant>(t => t.TenantId == tenantId)) { ControllerContext = Caller(workerId, UserRole.SupportWorker) };
        var withdraw = Assert.IsType<ConflictObjectResult>((await portal.CancelMyLeaveRequest(leaveId, Ct)).Result);

        Assert.Equal("Only pending requests can be withdrawn.", Assert.IsType<ApiResponse<LeaveRequestDto>>(withdraw.Value).Errors!.Single());
        var (status, outbox) = await StoredAsync(tenantId, leaveId);
        Assert.Equal(LeaveStatus.Approved, status);
        Assert.Equal([EmploymentHeroOutboxKind.Leave], outbox);
    }

    [SkippableFact(DisplayName = "Postgres: a withdraw then an approve of the same Pending leave: the approve is 409, the leave stays Cancelled, no outbox row")]
    public async Task WithdrawWins_TheApproveIs409_AndQueuesNothing()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, coordinatorId, workerId, leaveId) = await SeedAsync();
        await using var coordinatorDb = Open(tenantId);
        await using var workerDb = Open(tenantId);
        await coordinatorDb.LeaveRequests.SingleAsync(l => l.Id == leaveId, Ct);

        var portal = new PortalController(workerDb, Mock.Of<ICurrentTenant>(t => t.TenantId == tenantId)) { ControllerContext = Caller(workerId, UserRole.SupportWorker) };
        Assert.IsType<OkObjectResult>((await portal.CancelMyLeaveRequest(leaveId, Ct)).Result);
        var approve = Assert.IsType<ConflictObjectResult>((await new LeaveController(coordinatorDb) { ControllerContext = Caller(coordinatorId, UserRole.Coordinator) }.ApproveLeave(leaveId, Ct)).Result);

        Assert.Equal("This request has already been decided.", Assert.IsType<ApiResponse<LeaveApprovalResultDto>>(approve.Value).Errors!.Single());
        var (status, outbox) = await StoredAsync(tenantId, leaveId);
        Assert.Equal(LeaveStatus.Cancelled, status);
        Assert.Empty(outbox);
    }
}
