using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>
/// INTAKE sub-wave C1 coverage for <see cref="DbSeeder.SeedParticipantHealthConditionsAsync"/> and
/// <see cref="DbSeeder.SeedParticipantClinicalEnrichmentAsync"/> — same EF InMemory +
/// Moq&lt;ICurrentTenant&gt; pattern as DbSeederConsentsTests.
/// </summary>
public class DbSeederHealthConditionsTests
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
    public async Task SeedParticipantHealthConditionsAsync_SeedsRowsAcrossAMajorityOfParticipants()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantHealthConditionsAsync(db, CancellationToken.None);

        var distinctParticipants = await db.ParticipantHealthConditions.Select(c => c.ParticipantId).Distinct().CountAsync();
        Assert.True(distinctParticipants >= 9, $"Expected health-condition rows for a broad set of the 20 demo participants, got {distinctParticipants}.");
    }

    [Fact]
    public async Task SeedParticipantHealthConditionsAsync_IncludesTrueFalseAndUnansweredHasStates()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantHealthConditionsAsync(db, CancellationToken.None);

        var rows = await db.ParticipantHealthConditions.ToListAsync();
        Assert.Contains(rows, r => r.Has == true);
        Assert.Contains(rows, r => r.Has == false);
        Assert.Contains(rows, r => r.Has == null);
    }

    [Fact]
    public async Task SeedParticipantHealthConditionsAsync_IncludesPlanProvidedAndTrainingRequiredVariety()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantHealthConditionsAsync(db, CancellationToken.None);

        var rows = await db.ParticipantHealthConditions.ToListAsync();
        Assert.Contains(rows, r => r.PlanProvided == true);
        Assert.Contains(rows, r => r.PlanProvided == false);
        Assert.Contains(rows, r => r.TrainingRequired == true);
        Assert.Contains(rows, r => r.TrainingRequired == false);
    }

    [Fact]
    public async Task SeedParticipantHealthConditionsAsync_SophieBrownsEpilepsyRowIsCoherentWithHerExistingDiagnosis()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);
        await DbSeeder.SeedParticipantHealthConditionsAsync(db, CancellationToken.None);

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var sophie = await db.Participants.IgnoreQueryFilters().SingleAsync(p => p.Id == sophieId);
        Assert.Contains("Epilepsy", sophie.OtherDiagnoses);
        Assert.True(sophie.HidpaSupportCategories.HasFlag(HidpaSupportCategory.EpilepsyManagement));

        var epilepsyRow = await db.ParticipantHealthConditions.SingleAsync(c => c.ParticipantId == sophieId && c.ConditionType == HealthConditionType.Epilepsy);
        Assert.True(epilepsyRow.Has);
    }

    [Fact]
    public async Task SeedParticipantHealthConditionsAsync_RunTwice_DoesNotDuplicateRows()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantHealthConditionsAsync(db, CancellationToken.None);
        var firstRunCount = await db.ParticipantHealthConditions.CountAsync();

        await DbSeeder.SeedParticipantHealthConditionsAsync(db, CancellationToken.None);
        var secondRunCount = await db.ParticipantHealthConditions.CountAsync();

        Assert.True(firstRunCount > 0);
        Assert.Equal(firstRunCount, secondRunCount);
    }

    [Fact]
    public async Task SeedParticipantHealthConditionsAsync_NoDemoTenant_DoesNothing()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        // No SeedAsync call — no "demo.odip.com.au" tenant exists yet.

        await DbSeeder.SeedParticipantHealthConditionsAsync(db, CancellationToken.None);

        Assert.False(await db.ParticipantHealthConditions.AnyAsync());
    }

    // ── SeedParticipantClinicalEnrichmentAsync (flat Mobility/Behaviour/Allergy columns) ──────

    [Fact]
    public async Task SeedParticipantClinicalEnrichmentAsync_UpdatesAMajorityOfParticipants()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantClinicalEnrichmentAsync(db, CancellationToken.None);

        var withAnyFieldSet = await db.Participants.IgnoreQueryFilters()
            .CountAsync(p => p.AmbulantStatus != null || p.FallsRiskRating != null || p.AllergiesDetail != null || p.Memory != null);
        Assert.True(withAnyFieldSet >= 10, $"Expected clinical-enrichment fields set for a majority (>=10) of the 20 demo participants, got {withAnyFieldSet}.");
    }

    [Fact]
    public async Task SeedParticipantClinicalEnrichmentAsync_MiaAndersonIsAnAnaphylaxisRisk()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantClinicalEnrichmentAsync(db, CancellationToken.None);

        var miaId = Guid.Parse("d1000000-0000-0000-0000-000000000006");
        var mia = await db.Participants.IgnoreQueryFilters().SingleAsync(p => p.Id == miaId);
        Assert.True(mia.IsAnaphylaxisRisk);
        Assert.False(string.IsNullOrWhiteSpace(mia.AllergiesDetail));
        Assert.False(string.IsNullOrWhiteSpace(mia.AllergyManagementNotes));
    }

    [Fact]
    public async Task SeedParticipantClinicalEnrichmentAsync_RunTwice_DoesNotChangeValuesAgain()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantClinicalEnrichmentAsync(db, CancellationToken.None);
        var noahId = Guid.Parse("d1000000-0000-0000-0000-000000000003");
        var firstUpdatedAt = (await db.Participants.IgnoreQueryFilters().SingleAsync(p => p.Id == noahId)).UpdatedAt;

        await DbSeeder.SeedParticipantClinicalEnrichmentAsync(db, CancellationToken.None);
        var secondUpdatedAt = (await db.Participants.IgnoreQueryFilters().SingleAsync(p => p.Id == noahId)).UpdatedAt;

        Assert.Equal(firstUpdatedAt, secondUpdatedAt);
    }

    [Fact]
    public async Task SeedParticipantClinicalEnrichmentAsync_NoDemoTenant_DoesNothing()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        await DbSeeder.SeedParticipantClinicalEnrichmentAsync(db, CancellationToken.None);

        Assert.False(await db.Participants.IgnoreQueryFilters().AnyAsync(p => p.AmbulantStatus != null));
    }
}
