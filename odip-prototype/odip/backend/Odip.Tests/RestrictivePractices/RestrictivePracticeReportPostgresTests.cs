using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
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
        var fk = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.RestrictivePractices.Where(p => p.Id == practiceId).ExecuteDeleteAsync());
        Assert.Equal("23503", fk.SqlState);
    }

    private static readonly DateTime Dec3 = new(2026, 12, 3, 2, 0, 0, DateTimeKind.Utc);

    /// <summary>An incident time is the provider's wall clock in a timestamp-without-time-zone column: the bounds must compare it as written, not shift it.</summary>
    [SkippableFact]
    public async Task IncidentWallClockBounds_OnNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId, practiceId) = await SeedAsync();
        await using var _ = db;
        var practice = await db.RestrictivePractices.SingleAsync(p => p.Id == practiceId);
        practice.UseKind = RestrictivePracticeUseKind.Prn;
        practice.ReportingFromMonth = new DateOnly(2026, 10, 1);
        var reporter = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Lee", Username = $"sam.{Guid.NewGuid():N}", Email = $"sam.{Guid.NewGuid():N}@example.com", Role = UserRole.Coordinator, IsActive = true };
        db.Users.Add(reporter);
        foreach (var at in new[] { new DateTime(2026, 10, 31, 23, 30, 0), new DateTime(2026, 11, 1, 0, 0, 0) })
            db.IncidentReports.Add(new IncidentReport
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = reporter.Id, IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeId = practiceId, IsRestrictivePracticeAuthorised = true,
                Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft, Title = "Use", Description = "Use", IncidentDateTime = at, CreatedAt = DateTime.UtcNow, IsActive = true,
            });
        await db.SaveChangesAsync();

        var lines = await RestrictivePracticeReportWorklist.LinesAsync(db, Dec3, tenantId, null, withDetails: true, CancellationToken.None);

        Assert.Equal(1, lines.Single(l => l.Month == new DateOnly(2026, 10, 1)).Uses.Count);
        Assert.Equal(1, lines.Single(l => l.Month == new DateOnly(2026, 11, 1)).Uses.Count);
    }

    /// <summary>A dose time is UTC: 12:30Z on 31 Oct is 23:30 in Sydney (October), 13:30Z is 00:30 on 1 Nov (November).</summary>
    [SkippableFact]
    public async Task DoseUtcBounds_OnNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId, practiceId) = await SeedAsync();
        await using var _ = db;
        var practice = await db.RestrictivePractices.SingleAsync(p => p.Id == practiceId);
        var medication = new ParticipantMedication { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = practice.ParticipantId, Name = "Risperidone", DoseDescription = "1 tablet", Type = MedicationType.Prn, IsChemicalRestraint = true };
        db.ParticipantMedications.Add(medication);
        practice.Type = RestrictivePracticeType.ChemicalRestraint;
        practice.RelatedMedicationId = medication.Id;
        practice.ReportingFromMonth = new DateOnly(2026, 10, 1);
        foreach (var at in new[] { new DateTime(2026, 10, 31, 12, 30, 0, DateTimeKind.Utc), new DateTime(2026, 10, 31, 13, 30, 0, DateTimeKind.Utc) })
            db.MedicationAdministrations.Add(new MedicationAdministration
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantMedicationId = medication.Id, ParticipantId = practice.ParticipantId, Status = MedicationAdministrationStatus.Administered, AdministeredAt = at,
            });
        await db.SaveChangesAsync();

        var lines = await RestrictivePracticeReportWorklist.LinesAsync(db, Dec3, tenantId, null, withDetails: true, CancellationToken.None);

        Assert.Equal(new DateTime(2026, 10, 31, 23, 30, 0), Assert.Single(lines.Single(l => l.Month == new DateOnly(2026, 10, 1)).Uses).LocalDateTime);
        Assert.Single(lines.Single(l => l.Month == new DateOnly(2026, 11, 1)).Uses);
    }
}
