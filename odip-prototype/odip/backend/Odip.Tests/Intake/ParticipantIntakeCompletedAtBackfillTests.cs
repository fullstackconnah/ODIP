using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Intake;

/// <summary>
/// Verifies <see cref="ParticipantIntakeCompletedAtBackfill"/> — the C# mirror of the raw SQL the
/// BackfillParticipantIntakeCompletedAt migration runs against Postgres (PF-10.7, SPEC-05).
/// Exercised here via EF Core InMemory since raw SQL migrations can't run against that provider
/// (same pattern as ParticipantFundingSourceBackfillTests).
/// </summary>
public class ParticipantIntakeCompletedAtBackfillTests
{
    private static readonly DateTime CreatedAt = new(2026, 1, 15, 8, 30, 0, DateTimeKind.Utc);

    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    [Fact]
    public async Task RunAsync_CompletedNonDraftParticipant_BackfillsIntakeCompletedAtToCreatedAt()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Jamie", LastName = "Smith", IsActive = true,
            IsDraft = false, CreatedAt = CreatedAt, IntakeCompletedAt = null,
        };
        db.Participants.Add(participant);
        db.SaveChanges();

        var changed = await ParticipantIntakeCompletedAtBackfill.RunAsync(db);

        Assert.Equal(1, changed);
        var row = await db.Participants.SingleAsync();
        Assert.Equal(CreatedAt, row.IntakeCompletedAt);
    }

    [Fact]
    public async Task RunAsync_DraftParticipant_LeavesIntakeCompletedAtNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Sam", LastName = "Lee", IsActive = true,
            IsDraft = true, CreatedAt = CreatedAt, IntakeCompletedAt = null,
        };
        db.Participants.Add(participant);
        db.SaveChanges();

        var changed = await ParticipantIntakeCompletedAtBackfill.RunAsync(db);

        Assert.Equal(0, changed);
        var row = await db.Participants.SingleAsync();
        Assert.Null(row.IntakeCompletedAt);
    }

    [Fact]
    public async Task RunAsync_NonDraftParticipantWithIntakeCompletedAtAlreadySet_NeverOverwritesIt()
    {
        // A participant created under the NEW Intake wizard already has a server-set
        // IntakeCompletedAt distinct from CreatedAt — the idempotency guard must never clobber it.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var existingValue = CreatedAt.AddDays(3);
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Alex", LastName = "Rivera", IsActive = true,
            IsDraft = false, CreatedAt = CreatedAt, IntakeCompletedAt = existingValue,
        };
        db.Participants.Add(participant);
        db.SaveChanges();

        var changed = await ParticipantIntakeCompletedAtBackfill.RunAsync(db);

        Assert.Equal(0, changed);
        var row = await db.Participants.SingleAsync();
        Assert.Equal(existingValue, row.IntakeCompletedAt);
    }

    [Fact]
    public async Task RunAsync_DraftParticipantWithIntakeCompletedAtAlreadySet_NeverOverwritesIt()
    {
        // Intake-complete-but-profile-incomplete participants (PF-10.5) are IsDraft=true WITH a
        // non-null IntakeCompletedAt — the idempotency guard must win over the draft check for
        // these, not null them back out.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var existingValue = CreatedAt.AddDays(1);
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Morgan", LastName = "Blake", IsActive = true,
            IsDraft = true, CreatedAt = CreatedAt, IntakeCompletedAt = existingValue,
        };
        db.Participants.Add(participant);
        db.SaveChanges();

        var changed = await ParticipantIntakeCompletedAtBackfill.RunAsync(db);

        Assert.Equal(0, changed);
        var row = await db.Participants.SingleAsync();
        Assert.Equal(existingValue, row.IntakeCompletedAt);
    }

    [Fact]
    public async Task RunAsync_IsIdempotent_SecondRunChangesNothing()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        db.Participants.Add(new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Jamie", LastName = "Smith", IsActive = true,
            IsDraft = false, CreatedAt = CreatedAt, IntakeCompletedAt = null,
        });
        db.SaveChanges();

        var firstRun = await ParticipantIntakeCompletedAtBackfill.RunAsync(db);
        var secondRun = await ParticipantIntakeCompletedAtBackfill.RunAsync(db);

        Assert.Equal(1, firstRun);
        Assert.Equal(0, secondRun);
        Assert.Equal(CreatedAt, (await db.Participants.SingleAsync()).IntakeCompletedAt);
    }

    [Fact]
    public async Task RunAsync_MixOfDraftAndCompletedParticipants_OnlyBackfillsTheCompletedOne()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var completed = new Participant { Id = Guid.NewGuid(), FirstName = "A", LastName = "One", IsActive = true, IsDraft = false, CreatedAt = CreatedAt, IntakeCompletedAt = null };
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "B", LastName = "Two", IsActive = true, IsDraft = true, CreatedAt = CreatedAt, IntakeCompletedAt = null };
        db.Participants.AddRange(completed, draft);
        db.SaveChanges();

        var changed = await ParticipantIntakeCompletedAtBackfill.RunAsync(db);

        Assert.Equal(1, changed);
        Assert.Equal(CreatedAt, (await db.Participants.SingleAsync(p => p.Id == completed.Id)).IntakeCompletedAt);
        Assert.Null((await db.Participants.SingleAsync(p => p.Id == draft.Id)).IntakeCompletedAt);
    }
}
