using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// Verifies <see cref="ParticipantFundingSourceBackfill"/> — the C# mirror of the raw SQL the
/// AddParticipantFundingSource migration runs against Postgres. Exercised here via EF Core
/// InMemory since raw SQL migrations can't run against that provider (same pattern as
/// RestrictivePracticeBackfillTests).
/// </summary>
public class ParticipantFundingSourceBackfillTests
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
    public async Task RunAsync_NonEmptyFundingOrganisation_BackfillsOther()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true,
            FundingOrganisation = "NDIA", FundingSource = ParticipantFundingSource.Ndis, // pre-migration default
        };
        db.Participants.Add(participant);
        db.SaveChanges();

        var changed = await ParticipantFundingSourceBackfill.RunAsync(db);

        Assert.Equal(1, changed);
        var row = await db.Participants.SingleAsync();
        Assert.Equal(ParticipantFundingSource.Other, row.FundingSource);
    }

    [Fact]
    public async Task RunAsync_WhitespaceOnlyFundingOrganisation_StaysNdis()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true,
            FundingOrganisation = "   ", FundingSource = ParticipantFundingSource.Ndis,
        };
        db.Participants.Add(participant);
        db.SaveChanges();

        var changed = await ParticipantFundingSourceBackfill.RunAsync(db);

        Assert.Equal(0, changed);
        Assert.Equal(ParticipantFundingSource.Ndis, (await db.Participants.SingleAsync()).FundingSource);
    }

    [Fact]
    public async Task RunAsync_NullOrEmptyFundingOrganisation_StaysNdis()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var nullOrg = new Participant { Id = Guid.NewGuid(), FirstName = "A", LastName = "One", IsActive = true, FundingOrganisation = null };
        var emptyOrg = new Participant { Id = Guid.NewGuid(), FirstName = "B", LastName = "Two", IsActive = true, FundingOrganisation = "" };
        db.Participants.AddRange(nullOrg, emptyOrg);
        db.SaveChanges();

        var changed = await ParticipantFundingSourceBackfill.RunAsync(db);

        Assert.Equal(0, changed);
        Assert.All(await db.Participants.ToListAsync(), p => Assert.Equal(ParticipantFundingSource.Ndis, p.FundingSource));
    }

    [Fact]
    public async Task RunAsync_IsIdempotent_SecondRunChangesNothing()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        db.Participants.Add(new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true,
            FundingOrganisation = "Maple Plan Management", FundingSource = ParticipantFundingSource.Ndis,
        });
        db.SaveChanges();

        var firstRun = await ParticipantFundingSourceBackfill.RunAsync(db);
        var secondRun = await ParticipantFundingSourceBackfill.RunAsync(db);

        Assert.Equal(1, firstRun);
        Assert.Equal(0, secondRun);
        Assert.Equal(ParticipantFundingSource.Other, (await db.Participants.SingleAsync()).FundingSource);
    }
}
