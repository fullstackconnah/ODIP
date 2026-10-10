using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Data;

/// <summary>
/// INTAKE-03/04 coverage for <see cref="DbSeeder.SeedCommunityAccessDailyLivingAsync"/> — same EF
/// InMemory + Moq&lt;ICurrentTenant&gt; pattern as DbSeederAdlAssessmentsTests, including its
/// idempotency test pattern (task 10): re-running the seeder must not create duplicate
/// ParticipantChecklistItem rows for the same participant+item.
/// </summary>
public class DbSeederCommunityAccessDailyLivingTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    [Fact]
    public async Task SeedCommunityAccessDailyLivingAsync_SeedsChecklistItemsAndCaFlatFieldsForTargetedParticipants()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);
        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db, CancellationToken.None);

        await DbSeeder.SeedCommunityAccessDailyLivingAsync(db, CancellationToken.None);

        var checklistRows = await db.ParticipantChecklistItems.ToListAsync();
        Assert.NotEmpty(checklistRows);

        var distinctParticipants = checklistRows.Select(c => c.ParticipantId).Distinct().Count();
        Assert.True(distinctParticipants >= 2, $"Expected checklist rows for multiple CA-targeted demo participants, got {distinctParticipants}.");

        var withCaFlag = await db.Participants.IgnoreQueryFilters()
            .CountAsync(p => (p.ServiceStreams & ServiceStreams.CommunityAccessDailyLiving) == ServiceStreams.CommunityAccessDailyLiving);
        Assert.True(withCaFlag >= 2, $"Expected the CommunityAccessDailyLiving flag on multiple demo participants, got {withCaFlag}.");

        Assert.True(await db.Participants.IgnoreQueryFilters().AnyAsync(p => p.SignsHappyAndSettled != null));
        Assert.True(await db.ParticipantAdlAssessments.AnyAsync(a => a.HowToHelpNotes != null));
    }

    [Fact]
    public async Task SeedCommunityAccessDailyLivingAsync_IsIdempotent()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);
        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db, CancellationToken.None);

        await DbSeeder.SeedCommunityAccessDailyLivingAsync(db, CancellationToken.None);
        var firstCount = await db.ParticipantChecklistItems.CountAsync();
        var firstIds = await db.ParticipantChecklistItems.Select(c => c.Id).OrderBy(id => id).ToListAsync();

        await DbSeeder.SeedCommunityAccessDailyLivingAsync(db, CancellationToken.None);
        var secondCount = await db.ParticipantChecklistItems.CountAsync();
        var secondIds = await db.ParticipantChecklistItems.Select(c => c.Id).OrderBy(id => id).ToListAsync();

        Assert.Equal(firstCount, secondCount);
        Assert.Equal(firstIds, secondIds);

        // No duplicate (ParticipantId, ItemType) pairs.
        var rows = await db.ParticipantChecklistItems.ToListAsync();
        var distinctPairs = rows.Select(r => (r.ParticipantId, r.ItemType)).Distinct().Count();
        Assert.Equal(rows.Count, distinctPairs);
    }
}
