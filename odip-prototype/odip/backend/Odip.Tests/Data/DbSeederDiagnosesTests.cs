using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>
/// DIAG-01/02 coverage for <see cref="DbSeeder"/>: the demo participant seed rows carry
/// PrimaryDiagnosis/OtherDiagnoses/HidpaSupportCategories data, and in particular the seeded
/// "Sophie Brown" participant demonstrates the DIAG-02 epilepsy -&gt; epilepsy-management scenario
/// end to end (an Epilepsy entry in OtherDiagnoses paired with the EpilepsyManagement HIDPA flag)
/// — same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as ParticipantsControllerTests.
/// </summary>
public class DbSeederDiagnosesTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public async Task SeedAsync_SophieBrown_HasEpilepsyOtherDiagnosisAndEpilepsyManagementHidpaFlag()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var sophie = await db.Participants.SingleAsync(p => p.Id == Guid.Parse("d1000000-0000-0000-0000-000000000002"));

        Assert.Equal("Acquired Brain Injury", sophie.PrimaryDiagnosis);
        Assert.Contains("Epilepsy", sophie.OtherDiagnoses);
        Assert.True(sophie.HidpaSupportCategories.HasFlag(HidpaSupportCategory.EpilepsyManagement));
    }

    [Fact]
    public async Task SeedAsync_OliviaWilson_HasCerebralPalsyPrimaryDiagnosisAndEnteralFeedingHidpaFlag()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var olivia = await db.Participants.SingleAsync(p => p.Id == Guid.Parse("d1000000-0000-0000-0000-000000000004"));

        Assert.Equal("Cerebral Palsy", olivia.PrimaryDiagnosis);
        Assert.True(olivia.HidpaSupportCategories.HasFlag(HidpaSupportCategory.EnteralFeeding));
    }

    [Fact]
    public async Task SeedAsync_ParticipantWithNoDiagnosesSet_DefaultsToNullEmptyNone()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        await DbSeeder.SeedAsync(db, CancellationToken.None);

        // Noah Taylor's seed row (d1000000-...-0003) sets no diagnoses/HIDPA fields — proves the
        // additive migration's defaults apply cleanly to seed rows that don't opt in.
        var noah = await db.Participants.SingleAsync(p => p.Id == Guid.Parse("d1000000-0000-0000-0000-000000000003"));

        Assert.Null(noah.PrimaryDiagnosis);
        Assert.Empty(noah.OtherDiagnoses);
        Assert.Equal(HidpaSupportCategory.None, noah.HidpaSupportCategories);
    }

    [Fact]
    public async Task SeedDataDictionaryAsync_LoadsDiagnosesAndHidpaFieldDefinitions()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        await DbSeeder.SeedAsync(db, CancellationToken.None);
        await DbSeeder.SeedDataDictionaryAsync(db, CancellationToken.None);

        // Seeded once per tenant (two tenants exist after SeedAsync — Odip and Demo) — assert on
        // the first row per fieldId rather than SingleOrDefaultAsync, which would see both.
        var diagnosesField = await db.FieldDefinitions.FirstOrDefaultAsync(f => f.FieldId == "MED-016");
        var hidpaField = await db.FieldDefinitions.FirstOrDefaultAsync(f => f.FieldId == "MED-017");

        Assert.NotNull(diagnosesField);
        Assert.Equal("Health & Medical", diagnosesField!.Domain);
        Assert.Contains("Epilepsy", diagnosesField.PicklistOptionsRaw);

        Assert.NotNull(hidpaField);
        Assert.Equal("Health & Medical", hidpaField!.Domain);
    }
}
