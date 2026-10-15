using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Data;

/// <summary>
/// INTAKE sub-wave C2 coverage for <see cref="DbSeeder.SeedParticipantAdlAssessmentsAsync"/> and
/// <see cref="DbSeeder.SeedParticipantDailyLivingAsync"/> — same EF InMemory +
/// Moq&lt;ICurrentTenant&gt; pattern as DbSeederHealthConditionsTests.
/// </summary>
public class DbSeederAdlAssessmentsTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    [Fact]
    public async Task SeedParticipantAdlAssessmentsAsync_SeedsRowsAcrossAMajorityOfParticipants()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db, CancellationToken.None);

        var distinctParticipants = await db.ParticipantAdlAssessments.Select(a => a.ParticipantId).Distinct().CountAsync();
        Assert.True(distinctParticipants >= 11, $"Expected ADL-assessment rows for a majority of the 20 demo participants, got {distinctParticipants}.");
    }

    [Fact]
    public async Task SeedParticipantAdlAssessmentsAsync_CoversBothPersonalAndCommunityDomesticCategories()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db, CancellationToken.None);

        var types = await db.ParticipantAdlAssessments.Select(a => a.AdlType).Distinct().ToListAsync();
        Assert.Contains(types, t => AdlTypeGroups.Personal.Contains(t));
        Assert.Contains(types, t => AdlTypeGroups.CommunityDomestic.Contains(t));
    }

    [Fact]
    public async Task SeedParticipantAdlAssessmentsAsync_IncludesLevelVarietyAndAnUnassessedRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db, CancellationToken.None);

        var rows = await db.ParticipantAdlAssessments.ToListAsync();
        Assert.Contains(rows, r => r.Level == AdlLevel.Independent);
        Assert.Contains(rows, r => r.Level == AdlLevel.Supervision);
        Assert.Contains(rows, r => r.Level == AdlLevel.Assistance);
        Assert.Contains(rows, r => r.Level == AdlLevel.FullSupport);
        Assert.Contains(rows, r => r.Level == null); // "not assessed" grid state
    }

    [Fact]
    public async Task SeedParticipantAdlAssessmentsAsync_IsIdempotent()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db, CancellationToken.None);
        var firstCount = await db.ParticipantAdlAssessments.CountAsync();
        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db, CancellationToken.None);
        var secondCount = await db.ParticipantAdlAssessments.CountAsync();

        Assert.Equal(firstCount, secondCount);
    }

    [Fact]
    public async Task SeedParticipantDailyLivingAsync_UpdatesAMajorityOfParticipantsWithGoalsAndMeals()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantDailyLivingAsync(db, CancellationToken.None);

        var withGoals = await db.Participants.IgnoreQueryFilters().CountAsync(p => p.Goals != null);
        Assert.True(withGoals >= 10, $"Expected Goals set for a majority of the 20 demo participants, got {withGoals}.");
        Assert.True(await db.Participants.IgnoreQueryFilters().AnyAsync(p => p.FavouriteBreakfast != null));
        Assert.True(await db.Participants.IgnoreQueryFilters().AnyAsync(p => p.LikesDislikes != null));
    }

    [Fact]
    public async Task SeedParticipantDailyLivingAsync_IsIdempotent()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantDailyLivingAsync(db, CancellationToken.None);
        var firstGoals = await db.Participants.IgnoreQueryFilters().Where(p => p.Goals != null).Select(p => p.Goals).ToListAsync();
        await DbSeeder.SeedParticipantDailyLivingAsync(db, CancellationToken.None);
        var secondGoals = await db.Participants.IgnoreQueryFilters().Where(p => p.Goals != null).Select(p => p.Goals).ToListAsync();

        Assert.Equal(firstGoals.OrderBy(g => g), secondGoals.OrderBy(g => g));
    }
}
