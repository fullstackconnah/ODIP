using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Integrations;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Dashboard;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): the correlated plan subquery and the earliest-shift
/// ordering translate on Npgsql, and a SuperAdmin who chose an organisation sees only that organisation's counts.
/// </summary>
public class SetupStatusPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public SetupStatusPostgresTests(PostgresFixture pg) => _pg = pg;

    /// <summary>A SuperAdmin who chose <paramref name="tenantId"/>, resolved by the real <see cref="CurrentTenant"/> from the role and the view-as header.</summary>
    private static ICurrentTenant SuperAdminViewing(Guid tenantId)
    {
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, "SuperAdmin"), new Claim("tenant_id", Guid.NewGuid().ToString()) }, "Test")) };
        http.Request.Headers["X-View-As-Tenant"] = tenantId.ToString();
        return new CurrentTenant(new HttpContextAccessor { HttpContext = http });
    }

    private static async Task Plant(OdipDbContext db, Guid tenant, string shiftDate)
    {
        var p = new Participant { Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Ben", LastName = "Lee", NdisNumber = Guid.NewGuid().ToString("N")[..11], PlanType = PlanType.SelfManaged };
        db.Participants.Add(p);
        db.Users.Add(new User { Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Sam", LastName = "Hill", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true });
        db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30) });
        db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, ServiceDate = DateOnly.Parse(shiftDate), Status = ShiftStatus.Published });
        await db.SaveChangesAsync(Ct);
    }

    [SkippableFact]
    public async Task Setup_ViewingSuperAdminCountsOnlyThatOrganisation()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (own, ownTenant) = await _pg.NewTenantContextAsync();
        await using var _own = own;
        var (other, otherTenant) = await _pg.NewTenantContextAsync();
        await using var _other = other;
        await Plant(own, ownTenant, "2026-11-04");
        await Plant(other, otherTenant, "2026-10-14");
        await Plant(other, otherTenant, "2026-10-21");

        var keys = IntegrationKeyProtectorTests.Protector(null);
        var viewing = SuperAdminViewing(ownTenant);
        Assert.False(viewing.IsSuperAdmin);
        await using var asSuperAdmin = PostgresFixture.NewContext(_pg.ConnectionString, viewing);
        foreach (var (db, tenant) in new[] { (own, (ICurrentTenant)viewing), (asSuperAdmin, viewing) })
        {
            var result = await new DashboardController(db).GetSetup(tenant, keys, Ct);
            var data = Assert.IsType<ApiResponse<SetupStatusDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
            Assert.Equal((1, 1, 1, (DateOnly?)new DateOnly(2026, 11, 2)), (data.StaffCount, data.ParticipantCount, data.ParticipantsWithPlanCount, data.FirstPublishedWeekStart));
        }
    }
}
