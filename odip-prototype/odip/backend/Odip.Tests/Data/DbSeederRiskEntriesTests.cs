using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Data;

/// <summary>
/// INTAKE-09 coverage for <see cref="DbSeeder.SeedParticipantRiskEntriesAsync"/> — same
/// EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as DbSeederDiagnosesTests, exercising the demo
/// seed rows across all four <see cref="AtRiskParty"/> categories and the idempotent re-run guard.
/// </summary>
public class DbSeederRiskEntriesTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    [Fact]
    public async Task SeedParticipantRiskEntriesAsync_SeedsEntriesSpanningAllFourAtRiskParties()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantRiskEntriesAsync(db, CancellationToken.None);

        var parties = await db.ParticipantRiskEntries.Select(r => r.AtRiskParty).Distinct().ToListAsync();
        Assert.Contains(AtRiskParty.Participant, parties);
        Assert.Contains(AtRiskParty.OtherParticipants, parties);
        Assert.Contains(AtRiskParty.Public, parties);
        Assert.Contains(AtRiskParty.Staff, parties);
    }

    [Fact]
    public async Task SeedParticipantRiskEntriesAsync_AllSeededRowsAreActiveAndHaveADescription()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantRiskEntriesAsync(db, CancellationToken.None);

        var entries = await db.ParticipantRiskEntries.ToListAsync();
        Assert.NotEmpty(entries);
        Assert.All(entries, e => Assert.True(e.IsActive));
        Assert.All(entries, e => Assert.False(string.IsNullOrWhiteSpace(e.Description)));
    }

    [Fact]
    public async Task SeedParticipantRiskEntriesAsync_RunTwice_DoesNotDuplicateRows()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        await DbSeeder.SeedParticipantRiskEntriesAsync(db, CancellationToken.None);
        var firstRunCount = await db.ParticipantRiskEntries.CountAsync();

        await DbSeeder.SeedParticipantRiskEntriesAsync(db, CancellationToken.None);
        var secondRunCount = await db.ParticipantRiskEntries.CountAsync();

        Assert.True(firstRunCount > 0);
        Assert.Equal(firstRunCount, secondRunCount);
    }

    [Fact]
    public async Task SeedParticipantRiskEntriesAsync_NoDemoTenant_DoesNothing()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        // No SeedAsync call — no "demo.odip.com.au" tenant exists yet.

        await DbSeeder.SeedParticipantRiskEntriesAsync(db, CancellationToken.None);

        Assert.False(await db.ParticipantRiskEntries.AnyAsync());
    }
}
