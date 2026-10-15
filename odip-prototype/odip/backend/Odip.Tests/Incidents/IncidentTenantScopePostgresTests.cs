using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): every incident list and its total hold only the caller's organisation.
/// A count drops the list's projection, so a scope that only rode on the projection's join to the reporter would leave the total counting other organisations.
/// </summary>
public class IncidentTenantScopePostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public IncidentTenantScopePostgresTests(PostgresFixture pg) => _pg = pg;

    /// <summary>One open incident on a trip, its QSC report overdue, so every list and filter matches it.</summary>
    private static async Task<(IncidentReport Incident, TripInstance Trip)> PlantAsync(OdipDbContext db, Guid tenantId)
    {
        var reporter = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Lee", Username = $"sam.{Guid.NewGuid():N}", Email = $"sam.{Guid.NewGuid():N}@example.com", Role = UserRole.Coordinator, IsActive = true };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2026, 10, 1), DurationDays = 3 };
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = reporter.Id, TripInstanceId = trip.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.High,
            Status = IncidentStatus.Submitted, Title = "Incident", Description = "What happened.", IncidentDateTime = DateTime.UtcNow.AddHours(-31),
            CreatedAt = DateTime.UtcNow.AddHours(-30), QscReportingStatus = QscReportingStatus.Required, IsActive = true,
        };
        db.AddRange(reporter, trip, incident);
        await db.SaveChangesAsync(Ct);
        return (incident, trip);
    }

    [SkippableFact]
    public async Task EveryIncidentList_AndItsTotal_HoldOnlyTheCallersOrganisation_OverNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (own, ownTenant) = await _pg.NewTenantContextAsync();
        await using var _own = own;
        var (other, otherTenant) = await _pg.NewTenantContextAsync();
        await using var _other = other;
        var mine = await PlantAsync(own, ownTenant);
        var theirs = await PlantAsync(other, otherTenant);
        var controller = new IncidentsController(own);

        foreach (var (isOverdueQsc, needsAttention) in new (bool?, bool?)[] { (null, null), (true, null), (null, true) })
        {
            var page = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(
                (await controller.GetAll(null, null, null, null, null, isOverdueQsc, null, null, 1, 50, Ct, needsAttention)).Result).Value).Data!;
            Assert.Equal((mine.Incident.Id, 1), (Assert.Single(page.Items).Id, page.TotalCount));
        }

        var byForeignTrip = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(
            (await controller.GetAll(theirs.Trip.Id, null, null, null, null, null, null, null, 1, 50, Ct)).Result).Value).Data!;
        Assert.Equal((0, 0), (byForeignTrip.Items.Count, byForeignTrip.TotalCount));

        var overdue = Assert.IsType<ApiResponse<List<IncidentListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetOverdueQsc(Ct)).Result).Value).Data!;
        Assert.Equal(mine.Incident.Id, Assert.Single(overdue).Id);
        Assert.Empty(Assert.IsType<ApiResponse<List<IncidentListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetByTrip(theirs.Trip.Id, Ct)).Result).Value).Data!);
        Assert.IsType<NotFoundObjectResult>((await controller.GetById(theirs.Incident.Id, Ct)).Result);
    }
}
