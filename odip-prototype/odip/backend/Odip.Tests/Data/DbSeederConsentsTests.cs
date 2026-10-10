using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Data;

/// <summary>
/// INTAKE sub-wave B coverage for <see cref="DbSeeder.SeedParticipantConsentsAsync"/> — same EF
/// InMemory + Moq&lt;ICurrentTenant&gt; pattern as DbSeederRiskEntriesTests.
/// </summary>
public class DbSeederConsentsTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    [Fact]
    public async Task SeedParticipantConsentsAsync_SeedsRowsAcrossAMajorityOfParticipants()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantConsentsAsync(db, CancellationToken.None);

        var distinctParticipants = await db.ParticipantConsents.Select(c => c.ParticipantId).Distinct().CountAsync();
        Assert.True(distinctParticipants > 10, $"Expected consents seeded for a majority (>10) of the 20 demo participants, got {distinctParticipants}.");
    }

    [Fact]
    public async Task SeedParticipantConsentsAsync_IncludesGrantedDeclinedAndUnansweredStates()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantConsentsAsync(db, CancellationToken.None);

        var rows = await db.ParticipantConsents.ToListAsync();
        Assert.Contains(rows, r => r.Granted == true);
        Assert.Contains(rows, r => r.Granted == false);
        Assert.Contains(rows, r => r.Granted == null);
    }

    [Fact]
    public async Task SeedParticipantConsentsAsync_EachSeededParticipantHasAllSevenConsentTypes()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantConsentsAsync(db, CancellationToken.None);

        var allRows = await db.ParticipantConsents.ToListAsync();
        var byParticipant = allRows.GroupBy(c => c.ParticipantId).ToList();
        Assert.All(byParticipant, g => Assert.Equal(7, g.Select(c => c.ConsentType).Distinct().Count()));
        Assert.All(byParticipant, g => Assert.Equal(Enum.GetValues<ConsentType>().ToHashSet(), g.Select(c => c.ConsentType).ToHashSet()));
    }

    [Fact]
    public async Task SeedParticipantConsentsAsync_GrantedRowsHaveASignedByNameAndDate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantConsentsAsync(db, CancellationToken.None);

        var granted = await db.ParticipantConsents.Where(c => c.Granted == true).ToListAsync();
        Assert.NotEmpty(granted);
        Assert.All(granted, c => Assert.False(string.IsNullOrWhiteSpace(c.SignedByName)));
        Assert.All(granted, c => Assert.NotNull(c.SignedDate));
    }

    [Fact]
    public async Task SeedParticipantConsentsAsync_RunTwice_DoesNotDuplicateRows()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantConsentsAsync(db, CancellationToken.None);
        var firstRunCount = await db.ParticipantConsents.CountAsync();

        await DbSeeder.SeedParticipantConsentsAsync(db, CancellationToken.None);
        var secondRunCount = await db.ParticipantConsents.CountAsync();

        Assert.True(firstRunCount > 0);
        Assert.Equal(firstRunCount, secondRunCount);
    }

    [Fact]
    public async Task SeedParticipantConsentsAsync_NoDemoTenant_DoesNothing()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        // No SeedAsync call — no "demo.odip.com.au" tenant exists yet.

        await DbSeeder.SeedParticipantConsentsAsync(db, CancellationToken.None);

        Assert.False(await db.ParticipantConsents.AnyAsync());
    }
}
