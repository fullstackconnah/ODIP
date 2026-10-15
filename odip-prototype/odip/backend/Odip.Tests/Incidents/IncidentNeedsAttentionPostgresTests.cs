using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// The dashboard's Incidents group reads GET /incidents?needsAttention=true: open, or a QSC report overdue (even resolved or closed). Against a real PostgreSQL
/// (skipped, never failed, without POSTGRES_CONNECTION_STRING): the union translates, another organisation's incident is in neither the page nor the total,
/// and the total counts the whole set while the page holds five.
/// </summary>
public class IncidentNeedsAttentionPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public IncidentNeedsAttentionPostgresTests(PostgresFixture pg) => _pg = pg;

    private static async Task<Guid> SeedAsync(Odip.Infrastructure.Data.OdipDbContext db, Guid tenantId, int open, int resolvedOwing)
    {
        var reporter = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Lee", Username = $"sam.{Guid.NewGuid():N}", Email = $"sam.{Guid.NewGuid():N}@example.com", Role = UserRole.Coordinator, IsActive = true };
        db.Users.Add(reporter);
        for (var n = 0; n < open + resolvedOwing; n++)
        {
            var owes = n >= open;
            db.IncidentReports.Add(new IncidentReport
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = reporter.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Low,
                Status = owes ? IncidentStatus.Resolved : IncidentStatus.Submitted, Title = $"Incident {n}", Description = "What happened.",
                IncidentDateTime = new DateTime(2026, 10, 1, 9, n, 0, DateTimeKind.Utc), CreatedAt = DateTime.UtcNow.AddHours(owes ? -30 : -1),
                QscReportingStatus = owes ? QscReportingStatus.Required : QscReportingStatus.NotRequired, IsActive = true,
            });
        }
        await db.SaveChangesAsync(Ct);
        return reporter.Id;
    }

    [SkippableFact]
    public async Task NeedsAttention_OverNpgsql_IsTheOrganisationsOwnUnion_PagedWithTheWholeTotal()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (own, ownTenant) = await _pg.NewTenantContextAsync();
        await using var _own = own;
        var (other, otherTenant) = await _pg.NewTenantContextAsync();
        await using var _other = other;
        await SeedAsync(own, ownTenant, open: 4, resolvedOwing: 3);
        await SeedAsync(other, otherTenant, open: 2, resolvedOwing: 1);
        var controller = new IncidentsController(own);

        var result = await controller.GetAll(null, null, null, null, null, null, null, null, 1, 5, Ct, needsAttention: true);

        var page = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(7, page.TotalCount);
        Assert.Equal(5, page.Items.Count);
        Assert.DoesNotContain(page.Items, i => own.IncidentReports.Local.All(l => l.Id != i.Id));
    }
}
