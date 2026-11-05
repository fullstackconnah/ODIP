using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.RestrictivePractices;

/// <summary>The monthly restrictive practice report against a real PostgreSQL (skipped without POSTGRES_CONNECTION_STRING): the unique (practice, month) index and the Restrict foreign key, which EF InMemory does not enforce.</summary>
public class RestrictivePracticeReportPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public RestrictivePracticeReportPostgresTests(PostgresFixture pg) => _pg = pg;

    private static RestrictivePracticeMonthlyReport Report(Guid tenantId, Guid practiceId, DateOnly month) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, RestrictivePracticeId = practiceId, Month = month, ReportType = RestrictivePracticeReportType.NotUsed,
        LodgedOn = month.AddMonths(1).AddDays(2), LodgedByName = "A staff member", PracticeType = RestrictivePracticeType.PhysicalRestraint, PracticeDescription = "Hold",
    };

    private async Task<(OdipDbContext Db, Guid TenantId, Guid PracticeId)> SeedAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var practice = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Type = RestrictivePracticeType.PhysicalRestraint, Description = "Hold", AuthorisedBy = "Dr Lee",
            AuthorisationDate = new DateOnly(2026, 1, 1),
        };
        db.Participants.Add(participant);
        db.RestrictivePractices.Add(practice);
        await db.SaveChangesAsync();
        return (db, tenantId, practice.Id);
    }

    [SkippableFact]
    public async Task UniquePracticeMonth_SecondInsertThrows()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId, practiceId) = await SeedAsync();
        await using var _ = db;
        db.RestrictivePracticeMonthlyReports.Add(Report(tenantId, practiceId, new DateOnly(2026, 10, 1)));
        await db.SaveChangesAsync();
        db.RestrictivePracticeMonthlyReports.Add(Report(tenantId, practiceId, new DateOnly(2026, 10, 1)));
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal("23505", ((Npgsql.PostgresException)ex.InnerException!).SqlState);
    }

    [SkippableFact]
    public async Task PracticeWithReport_FkRestrictBlocksRawDelete()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId, practiceId) = await SeedAsync();
        await using var _ = db;
        db.RestrictivePracticeMonthlyReports.Add(Report(tenantId, practiceId, new DateOnly(2026, 10, 1)));
        await db.SaveChangesAsync();
        db.RestrictivePractices.Remove(await db.RestrictivePractices.SingleAsync(p => p.Id == practiceId));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
