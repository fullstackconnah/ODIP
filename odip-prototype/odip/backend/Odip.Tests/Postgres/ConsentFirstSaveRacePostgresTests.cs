using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// H74-3: two first saves of one consent type at the same moment. The loser's insert hits the unique index on (participant, type); it must
/// answer the saved row with its own answer on top (last write wins), not a 500. The controller loads its row, then saves, with nothing between
/// that a test can hold open, so this drives the shared save helper in that order: the second context has already looked (no row), the first
/// inserts, then the second saves.
/// </summary>
public class ConsentFirstSaveRacePostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ConsentFirstSaveRacePostgresTests(PostgresFixture pg) => _pg = pg;

    private static ParticipantConsent NewRow(Guid tenantId, Guid participantId) =>
        new() { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, ConsentType = ConsentType.Privacy };

    [SkippableFact]
    public async Task ALostFirstSave_KeepsTheOneRowWithTheSecondAnswer()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (first, tenantId) = await _pg.NewTenantContextAsync(cs);
        await using var _ = first;
        var participantId = Guid.NewGuid();
        first.Participants.Add(new Participant { Id = participantId, FirstName = "Amy", LastName = "Ng", IsActive = true });
        await first.SaveChangesAsync();

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var second = PostgresFixture.NewContext(cs, tenant.Object);
        await using var __ = second;
        var lateRow = NewRow(tenantId, participantId);
        second.ParticipantConsents.Add(lateRow);   // the second request found no row and staged its own

        var winner = NewRow(tenantId, participantId);
        first.ParticipantConsents.Add(winner);
        ParticipantGridRules.ApplyAnswer(winner, true, "First", new DateOnly(2026, 1, 1));
        await first.SaveChangesAsync();             // the first request's insert lands in between

        var saved = await ParticipantGridRules.SaveConsentAnswerAsync(second, lateRow, false, "Second", new DateOnly(2026, 2, 2), CancellationToken.None);

        await using var read = PostgresFixture.NewContext(cs);
        var row = await read.ParticipantConsents.SingleAsync(c => c.ParticipantId == participantId);
        Assert.Equal(winner.Id, row.Id);
        Assert.Equal(winner.Id, saved.Id);
        Assert.False(row.Granted);
        Assert.Equal("Second", row.SignedByName);
        Assert.Equal(new DateOnly(2026, 2, 2), row.SignedDate);
    }

}
