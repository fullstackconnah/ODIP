using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Leave;

/// <summary>
/// D4 (2026-10-16) on a real PostgreSQL, in a tenant: a coordinator's own leave and own recurring unavailability are refused on approve and decline
/// (403 LEAVE_OWN_REQUEST) and stay Pending, while a colleague's request in the same tenant is still decided. Skipped, never failed, without
/// POSTGRES_CONNECTION_STRING.
/// </summary>
public class LeaveOwnRequestPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Day = new(2026, 11, 4);
    private readonly PostgresFixture _pg;
    public LeaveOwnRequestPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static User Person(Guid tenantId, UserRole role) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ada", LastName = role.ToString(),
        Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = role, IsActive = true,
    };

    private static LeaveController As(OdipDbContext db, Guid callerId) => new(db)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerId.ToString())], "Test")) },
        },
    };

    private async Task<(OdipDbContext Db, User Coordinator, User Worker)> SeedAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", db.Database.ProviderName);   // so an InMemory run can never satisfy this class
        var coordinator = Person(tenantId, UserRole.Coordinator);
        var worker = Person(tenantId, UserRole.SupportWorker);
        db.Users.AddRange(coordinator, worker);
        await db.SaveChangesAsync(Ct);
        return (db, coordinator, worker);
    }

    private static LeaveRequest Leave(Guid userId) => new()
    {
        Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual, StartDate = Day, EndDate = Day,
        Status = LeaveStatus.Pending, RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
    };

    private static RecurringUnavailability Rule(Guid userId) => new()
    {
        Id = Guid.NewGuid(), UserId = userId, DayOfWeek = DayOfWeek.Wednesday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
        EffectiveFrom = Day, Status = LeaveStatus.Pending, RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
    };

    private static void AssertRefused<T>(ActionResult<ApiResponse<T>> result)
    {
        var refused = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, refused.StatusCode);
        Assert.Equal(LeaveErrorCodes.LeaveOwnRequest, Assert.IsType<ApiResponse<T>>(refused.Value).Code);
    }

    [SkippableFact(DisplayName = "Postgres: a coordinator's own leave is refused on approve and decline and stays Pending; a colleague's is approved")]
    public async Task OwnLeave_IsRefusedBothWays_AColleaguesIsApproved()
    {
        RequirePostgres();
        var (db, coordinator, worker) = await SeedAsync();
        await using var _ = db;
        var own = Leave(coordinator.Id);
        var theirs = Leave(worker.Id);
        db.LeaveRequests.AddRange(own, theirs);
        await db.SaveChangesAsync(Ct);

        AssertRefused(await As(db, coordinator.Id).ApproveLeave(own.Id, Ct));
        AssertRefused(await As(db, coordinator.Id).DeclineLeave(own.Id, new LeaveDecisionDto(), Ct));
        Assert.IsType<OkObjectResult>((await As(db, coordinator.Id).ApproveLeave(theirs.Id, Ct)).Result);

        db.ChangeTracker.Clear();
        var stored = await db.LeaveRequests.SingleAsync(l => l.Id == own.Id, Ct);
        Assert.Equal(LeaveStatus.Pending, stored.Status);
        Assert.Null(stored.DecidedByUserId);
        Assert.Equal(LeaveStatus.Approved, (await db.LeaveRequests.SingleAsync(l => l.Id == theirs.Id, Ct)).Status);
    }

    [SkippableFact(DisplayName = "Postgres: a coordinator's own recurring unavailability is refused on approve and decline and stays Pending; a colleague's is approved")]
    public async Task OwnUnavailability_IsRefusedBothWays_AColleaguesIsApproved()
    {
        RequirePostgres();
        var (db, coordinator, worker) = await SeedAsync();
        await using var _ = db;
        var own = Rule(coordinator.Id);
        var theirs = Rule(worker.Id);
        db.RecurringUnavailabilities.AddRange(own, theirs);
        await db.SaveChangesAsync(Ct);

        AssertRefused(await As(db, coordinator.Id).ApproveUnavailability(own.Id, Ct));
        AssertRefused(await As(db, coordinator.Id).DeclineUnavailability(own.Id, new LeaveDecisionDto(), Ct));
        Assert.IsType<OkObjectResult>((await As(db, coordinator.Id).ApproveUnavailability(theirs.Id, Ct)).Result);

        db.ChangeTracker.Clear();
        Assert.Equal(LeaveStatus.Pending, (await db.RecurringUnavailabilities.SingleAsync(r => r.Id == own.Id, Ct)).Status);
        Assert.Equal(LeaveStatus.Approved, (await db.RecurringUnavailabilities.SingleAsync(r => r.Id == theirs.Id, Ct)).Status);
    }
}
