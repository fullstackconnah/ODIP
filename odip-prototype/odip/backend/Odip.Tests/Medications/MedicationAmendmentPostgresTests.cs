using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Medications;

public class MedicationAmendmentPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public MedicationAmendmentPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    [SkippableFact]
    public async Task OlderRows_ReadBlankAfterAmendmentMigration_AndRoundTripAnAmendment()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        await migrator.MigrateAsync(all[all.IndexOf(all.Single(m => m.EndsWith("_AddMedicationAdministrationAmendment", StringComparison.Ordinal))) - 1]);

        var tenantId = Guid.NewGuid();
        var participantId = Guid.NewGuid();
        var medId = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Live Provider", EmailDomain = $"{tenantId:N}.example.com" });
        db.Participants.Add(new Participant { Id = participantId, TenantId = tenantId, FirstName = "Live", LastName = "Participant", IsActive = true });
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = medId, TenantId = tenantId, ParticipantId = participantId, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        });
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = adminId, TenantId = tenantId, ParticipantMedicationId = medId, ParticipantId = participantId,
            Status = MedicationAdministrationStatus.Administered, RecordedByName = "Test",
        });
        await OlderSchemaSeeds.SaveWithLaterColumnsAsync(db);

        await migrator.MigrateAsync();
        await using var after = PostgresFixture.NewContext(connectionString);
        var older = await after.MedicationAdministrations.AsNoTracking().IgnoreQueryFilters().SingleAsync();
        var dto = MedicationMapping.ToAdministrationDto(older, "P", "M", "D");
        Assert.Equal((null, null, null, null), ((MedicationAmendmentReason?)dto.AmendmentReason, dto.AmendmentNote, dto.AmendedByName, dto.AmendedAt));

        var at = new DateTime(2026, 11, 6, 1, 2, 3, DateTimeKind.Utc);
        var tracked = await after.MedicationAdministrations.IgnoreQueryFilters().SingleAsync();
        tracked.AmendmentReason = MedicationAmendmentReason.Other;
        tracked.AmendmentNote = new string('x', 500);
        tracked.AmendedByName = "Cora";
        tracked.AmendedAt = at;
        await after.SaveChangesAsync();

        await using var reload = PostgresFixture.NewContext(connectionString);
        var saved = await reload.MedicationAdministrations.AsNoTracking().IgnoreQueryFilters().SingleAsync();
        Assert.Equal((MedicationAmendmentReason.Other, 500, "Cora", at), (saved.AmendmentReason, saved.AmendmentNote!.Length, saved.AmendedByName, saved.AmendedAt));
    }
}
