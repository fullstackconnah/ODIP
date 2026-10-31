using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>The grouped month query against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): InMemory cannot show that Npgsql translates the composite-key GroupBy and the filtered count.</summary>
public class IncidentTrendPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public IncidentTrendPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task TheGroupedQuery_TranslatesAndCounts_OnPostgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var reporter = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Support", Username = $"sam.{tenantId:N}", Email = $"sam@{tenantId:N}.example.com", Role = UserRole.SupportWorker, IsActive = true };
        db.Users.Add(reporter);
        IncidentReport Report(string when, IncidentType type, IncidentStatus status = IncidentStatus.Submitted, bool active = true) => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = reporter.Id, Title = "T", Description = "D", IncidentType = type, Status = status, IsActive = active,
            IncidentDateTime = DateTime.Parse(when, System.Globalization.CultureInfo.InvariantCulture)
        };
        db.IncidentReports.AddRange(
            Report("2026-09-02T09:00", IncidentType.RestrictivePracticeUse), Report("2026-09-20T09:00", IncidentType.Other),
            Report("2026-10-05T09:00", IncidentType.RestrictivePracticeUse), Report("2026-10-06T09:00", IncidentType.Other, IncidentStatus.Draft),
            Report("2026-10-07T09:00", IncidentType.Other, active: false));
        await db.SaveChangesAsync();

        var result = await new IncidentTrendController(db, Medications.FakeClock.AtUtc(2026, 10, 15, 2, 0)).GetTrend(CancellationToken.None);

        var months = Assert.IsType<ApiResponse<IncidentTrendDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Months;
        Assert.Equal((2, 1, 1), (months[4].Incidents, months[4].RpUses, months[4].OtherIncidents));
        Assert.Equal((1, 1, 0), (months[5].Incidents, months[5].RpUses, months[5].OtherIncidents));
    }
}
