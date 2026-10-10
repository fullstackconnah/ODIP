using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Notes;

/// <summary>
/// PD-5 — direct coverage of <see cref="SafetyNoteSyncService"/>'s sync algorithm (idempotency,
/// edit-sticks, drift detection, Dismiss/Regenerate). Controller-level trigger-path coverage
/// (proving each write path actually calls this service) lives alongside each controller's own
/// test file — see ParticipantsControllerTests/ParticipantsControllerPatchTests/
/// RestrictivePracticesControllerTests/ParticipantRiskEntriesControllerTests/
/// ParticipantNotesControllerTests.
/// </summary>
public class SafetyNoteSyncServiceTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Sophie", string lastName = "Brown")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    // ── Idempotency ──────────────────────────────────────────────────

    [Fact]
    public async Task SyncFromParticipantAsync_RunTwiceWithSameValue_CreatesOnlyOneNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Peanuts";
        await db.SaveChangesAsync();

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var firstUpdatedAt = (await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey)).UpdatedAt;

        // Re-run with no change to the source value.
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var notes = await db.ParticipantNotes.Where(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey).ToListAsync();
        var note = Assert.Single(notes);
        Assert.Equal(firstUpdatedAt, note.UpdatedAt); // no UpdatedAt churn on an idempotent no-op
    }

    [Fact]
    public async Task SyncFromParticipantAsync_NoAllergyDetail_CreatesNoNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.False(await db.ParticipantNotes.AnyAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey));
    }

    // ── Archive on clear ─────────────────────────────────────────────

    [Fact]
    public async Task SyncFromParticipantAsync_ClearingAllergies_ArchivesNoteWhenNotManuallyEdited()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Peanuts";
        await db.SaveChangesAsync();

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        participant.AllergiesDetail = null;
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var note = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        Assert.True(note.IsArchived);
    }

    // ── Manual edit sticks ───────────────────────────────────────────

    [Fact]
    public async Task SyncFromParticipantAsync_ManuallyEditedNote_ContentNeverOverwritten()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Peanuts";
        await db.SaveChangesAsync();

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var note = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        note.Description = "Clinician's own wording: severe peanut allergy, EpiPen in bag.";
        note.IsManuallyEdited = true;
        await db.SaveChangesAsync();

        // The source field changes again after the manual edit.
        participant.AllergiesDetail = "Peanuts and shellfish";
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        Assert.Equal("Clinician's own wording: severe peanut allergy, EpiPen in bag.", reloaded.Description); // byte-for-byte unchanged
        Assert.True(reloaded.HasSourceDrift);
    }

    [Fact]
    public async Task SyncFromParticipantAsync_ManuallyEditedNote_NeverSpawnsDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Peanuts";
        await db.SaveChangesAsync();

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var note = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        note.IsManuallyEdited = true;
        await db.SaveChangesAsync();

        participant.AllergiesDetail = "Peanuts and shellfish";
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();
        // Run once more for good measure — still exactly one row for this SourceKey.
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var count = await db.ParticipantNotes.CountAsync(n => n.ParticipantId == participant.Id && n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task SyncFromParticipantAsync_ManuallyEditedThenCleared_NotArchivedButDrifts()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Peanuts";
        await db.SaveChangesAsync();

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var note = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        note.IsManuallyEdited = true;
        await db.SaveChangesAsync();

        participant.AllergiesDetail = null;
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        Assert.False(reloaded.IsArchived);
        Assert.True(reloaded.HasSourceDrift);
    }

    // ── Dismiss / Regenerate ─────────────────────────────────────────

    [Fact]
    public async Task DismissDriftAsync_ClearsDriftWithoutTouchingText()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Peanuts";
        await db.SaveChangesAsync();

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var note = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        note.Description = "Custom wording.";
        note.IsManuallyEdited = true;
        await db.SaveChangesAsync();

        participant.AllergiesDetail = "Peanuts and shellfish";
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();
        Assert.True((await db.ParticipantNotes.SingleAsync(n => n.Id == note.Id)).HasSourceDrift);

        var ok = await sync.DismissDriftAsync(note, CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.True(ok);
        var reloaded = await db.ParticipantNotes.SingleAsync(n => n.Id == note.Id);
        Assert.False(reloaded.HasSourceDrift);
        Assert.Equal("Custom wording.", reloaded.Description); // text untouched
        Assert.True(reloaded.IsManuallyEdited); // still manually owned

        // Doesn't re-arm until the source changes again from this new baseline.
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();
        Assert.False((await db.ParticipantNotes.SingleAsync(n => n.Id == note.Id)).HasSourceDrift);
    }

    [Fact]
    public async Task RegenerateAsync_RestoresMachineTextAndReArmsSync()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Peanuts";
        await db.SaveChangesAsync();

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var note = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.AllergiesKey);
        note.Description = "Custom wording.";
        note.IsManuallyEdited = true;
        await db.SaveChangesAsync();

        participant.AllergiesDetail = "Peanuts and shellfish";
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var ok = await sync.RegenerateAsync(note, CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.True(ok);
        var reloaded = await db.ParticipantNotes.SingleAsync(n => n.Id == note.Id);
        Assert.Contains("Peanuts and shellfish", reloaded.Description);
        Assert.False(reloaded.IsManuallyEdited);
        Assert.False(reloaded.HasSourceDrift);

        // Re-armed: a further source change now updates the note's content automatically again.
        participant.AllergiesDetail = "Peanuts, shellfish and dairy";
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();
        var final = await db.ParticipantNotes.SingleAsync(n => n.Id == note.Id);
        Assert.Contains("dairy", final.Description);
    }

    [Fact]
    public async Task DismissDriftAsync_OnManualNote_ReturnsFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var manualNote = new ParticipantNote
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Manual", Description = "d", CreatedByName = "Test",
        };
        db.ParticipantNotes.Add(manualNote);
        await db.SaveChangesAsync();

        var sync = new SafetyNoteSyncService(db);
        var ok = await sync.DismissDriftAsync(manualNote, CancellationToken.None);

        Assert.False(ok);
    }

    // ── Restrictive practices category ───────────────────────────────

    [Fact]
    public async Task SyncRestrictivePracticeNoteAsync_FlagTrue_CreatesNote_FlagFalse_Archives()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var sync = new SafetyNoteSyncService(db);

        participant.HasRestrictivePracticeFlag = true;
        await sync.SyncRestrictivePracticeNoteAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var note = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.RestrictivePracticesKey);
        Assert.False(note.IsArchived);

        participant.HasRestrictivePracticeFlag = false;
        await sync.SyncRestrictivePracticeNoteAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.RestrictivePracticesKey);
        Assert.True(reloaded.IsArchived);
    }

    // ── Risks/hazards via ParticipantRiskEntry rows (item 5a — create-time, tracked-not-saved) ──

    [Fact]
    public async Task SyncFromParticipantAsync_TrackedButUnsavedRiskEntry_CountsAsPresent()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);

        // Mirrors ParticipantsController.Create's RiskEntries loop: the entry is Add()ed to the
        // same DbContext but not yet saved when the sync call runs.
        db.ParticipantRiskEntries.Add(new ParticipantRiskEntry
        {
            Id = Guid.NewGuid(),
            ParticipantId = participant.Id,
            AtRiskParty = AtRiskParty.Participant,
            Description = "Risk of falls during transfers.",
            IsActive = true,
        });

        var sync = new SafetyNoteSyncService(db);
        await sync.SyncFromParticipantAsync(participant, CancellationToken.None);
        await db.SaveChangesAsync();

        var note = await db.ParticipantNotes.SingleAsync(n => n.SourceKey == SafetyNoteSyncService.RisksHazardsKey);
        Assert.Contains("falls during transfers", note.Description);
    }
}
