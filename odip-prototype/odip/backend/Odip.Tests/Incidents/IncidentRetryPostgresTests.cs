using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
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
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): the filtered unique index on
/// (TenantId, IdempotencyKey) that makes a retried incident submit safe, and the race the controller answers as a replay.
/// </summary>
public class IncidentRetryPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public IncidentRetryPostgresTests(PostgresFixture pg) => _pg = pg;

    private static User NewReporter(Guid tenantId) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Lee", Username = $"sam.{Guid.NewGuid():N}",
        Email = $"sam.{Guid.NewGuid():N}@example.com", Role = UserRole.Coordinator, IsActive = true,
    };

    private static IncidentReport NewIncident(Guid tenantId, Guid reporterId, string? key) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = reporterId, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Medium,
        Status = IncidentStatus.Submitted, Title = "Incident", Description = "What happened.", IncidentDateTime = DateTime.UtcNow.AddHours(-1), IdempotencyKey = key,
    };

    [SkippableFact]
    public async Task TheIndex_RefusesTheSameKeyTwiceInATenant_ButNotNullKeys_OrAnotherTenant()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenant) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (otherDb, otherTenant) = await _pg.NewTenantContextAsync();
        await using var _other = otherDb;
        var reporter = NewReporter(tenant);
        var otherReporter = NewReporter(otherTenant);
        db.Users.Add(reporter);
        otherDb.Users.Add(otherReporter);
        await db.SaveChangesAsync(Ct);
        await otherDb.SaveChangesAsync(Ct);

        db.IncidentReports.AddRange(NewIncident(tenant, reporter.Id, null), NewIncident(tenant, reporter.Id, null), NewIncident(tenant, reporter.Id, "key-1"));
        await db.SaveChangesAsync(Ct); // two null keys are outside the filtered index
        otherDb.IncidentReports.Add(NewIncident(otherTenant, otherReporter.Id, "key-1"));
        await otherDb.SaveChangesAsync(Ct); // the same key in another tenant is its own row

        db.IncidentReports.Add(NewIncident(tenant, reporter.Id, "key-1"));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync(Ct));
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal(IncidentReport.IdempotencyIndexName, pg.ConstraintName);
    }

    /// <summary>Hands the first save a rival that commits the same (tenant, key) just before it, which is what two submits passing the lookup together look like.</summary>
    private sealed class RivalFirstInterceptor(Func<Task> rival) : SaveChangesInterceptor
    {
        private bool _fired;
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!_fired) { _fired = true; await rival(); }
            return result;
        }
    }

    [SkippableFact]
    public async Task ARacingSubmitWithTheSameKey_AnswersAsAReplayOfTheWinner_OverNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setup, tenant) = await _pg.NewTenantContextAsync();
        await using var _setup = setup;
        var reporter = NewReporter(tenant);
        setup.Users.Add(reporter);
        await setup.SaveChangesAsync(Ct);
        var winner = NewIncident(tenant, reporter.Id, "race-key");

        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString)
            .AddInterceptors(new RivalFirstInterceptor(async () =>
            {
                await using var rival = PostgresFixture.NewContext(_pg.ConnectionString);
                rival.IncidentReports.Add(winner);
                await rival.SaveChangesAsync(Ct);
            })).Options;
        var tenantMock = new Moq.Mock<Odip.Domain.Interfaces.ICurrentTenant>();
        tenantMock.Setup(t => t.TenantId).Returns(tenant);
        tenantMock.Setup(t => t.IsSuperAdmin).Returns(false);
        await using var db = new OdipDbContext(options, tenantMock.Object);

        var result = await new IncidentsController(db).Create(new CreateIncidentDto
        {
            ReportedByStaffId = reporter.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Medium, Title = "Incident title",
            Description = "What happened.", IncidentDateTime = DateTime.UtcNow.AddHours(-1), IdempotencyKey = "race-key",
        }, Ct);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(winner.Id, Assert.IsType<ApiResponse<IncidentListDto>>(ok.Value).Data!.Id);
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
        Assert.Equal(1, await check.IncidentReports.CountAsync(i => i.TenantId == tenant && i.IdempotencyKey == "race-key", Ct));
    }
}
