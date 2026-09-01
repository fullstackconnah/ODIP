using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Notes;

/// <summary>
/// Controller-level coverage for the Participant Notes API slice (ParticipantNotesController),
/// using the same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as MedicationsControllerTests.
/// </summary>
public class ParticipantNotesControllerTests
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

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Sophie", string lastName = "Brown")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static CreateParticipantNoteDto CreateDto(string title = "Haircut preference", string description = "Short bob, above the shoulders.", bool isPinned = false) => new()
    {
        Title = title,
        Description = description,
        IsPinned = isPinned,
    };

    // ── Create ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ParticipantMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));

        var result = await controller.Create(Guid.NewGuid(), CreateDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_Valid_SavesAndReturnsDto()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));

        var result = await controller.Create(participant.Id, CreateDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantNoteDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Haircut preference", body.Data!.Title);
        Assert.Equal(participant.Id, body.Data.ParticipantId);
        Assert.False(body.Data.IsArchived);

        var saved = await db.ParticipantNotes.SingleAsync();
        Assert.Equal(participant.Id, saved.ParticipantId);
        // CreatedByName is set server-side — no authenticated user in this unit test context
        // falls back to "Unknown" rather than trusting anything client-supplied.
        Assert.Equal("Unknown", saved.CreatedByName);
    }

    // ── Ordering: pinned-first then CreatedAt desc ──────────────────────────

    [Fact]
    public async Task GetForParticipant_OrdersPinnedFirstThenCreatedAtDescending()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var now = DateTime.UtcNow;

        db.ParticipantNotes.AddRange(
            new ParticipantNote
            {
                Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Oldest plain", Description = "d",
                CreatedByName = "Test", CreatedAt = now.AddDays(-3), UpdatedAt = now.AddDays(-3),
            },
            new ParticipantNote
            {
                Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Newest plain", Description = "d",
                CreatedByName = "Test", CreatedAt = now.AddDays(-1), UpdatedAt = now.AddDays(-1),
            },
            new ParticipantNote
            {
                Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Pinned but older", IsPinned = true, Description = "d",
                CreatedByName = "Test", CreatedAt = now.AddDays(-5), UpdatedAt = now.AddDays(-5),
            });
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        var result = await controller.GetForParticipant(participant.Id, includeArchived: false, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<ParticipantNoteDto>>>(ok.Value);
        Assert.Equal(3, body.Data!.Count);
        Assert.Equal("Pinned but older", body.Data[0].Title); // pinned wins despite being oldest
        Assert.Equal("Newest plain", body.Data[1].Title);     // then newest-first among the rest
        Assert.Equal("Oldest plain", body.Data[2].Title);
    }

    // ── Archive filter ───────────────────────────────────────────────────

    [Fact]
    public async Task GetForParticipant_DefaultExcludesArchived()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.ParticipantNotes.AddRange(
            new ParticipantNote { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Active note", Description = "d", CreatedByName = "Test" },
            new ParticipantNote { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Archived note", Description = "d", CreatedByName = "Test", IsArchived = true });
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        var result = await controller.GetForParticipant(participant.Id, includeArchived: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var note = Assert.Single(body.Data!);
        Assert.Equal("Active note", note.Title);
    }

    [Fact]
    public async Task GetForParticipant_IncludeArchivedTrue_ReturnsBoth()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.ParticipantNotes.AddRange(
            new ParticipantNote { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Active note", Description = "d", CreatedByName = "Test" },
            new ParticipantNote { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Archived note", Description = "d", CreatedByName = "Test", IsArchived = true });
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        var result = await controller.GetForParticipant(participant.Id, includeArchived: true, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, body.Data!.Count);
    }

    // ── Update ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_NoteMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));

        var dto = new UpdateParticipantNoteDto { Title = "t", Description = "d", IsPinned = false, IsArchived = false };
        var result = await controller.Update(Guid.NewGuid(), dto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Valid_UpdatesFieldsIncludingArchive()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var note = new ParticipantNote
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Original", Description = "Original desc",
            CreatedByName = "Test",
        };
        db.ParticipantNotes.Add(note);
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        var dto = new UpdateParticipantNoteDto { Title = "Updated", Description = "Updated desc", IsPinned = true, IsArchived = true };

        var result = await controller.Update(note.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantNoteDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Updated", body.Data!.Title);
        Assert.True(body.Data.IsPinned);
        Assert.True(body.Data.IsArchived);

        var saved = await db.ParticipantNotes.SingleAsync();
        Assert.Equal("Updated desc", saved.Description);
        Assert.True(saved.IsArchived);
    }

    // ── PD-5 ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_OnAutoNote_SetsIsManuallyEdited()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var note = new ParticipantNote
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Allergies (auto)", Description = "Auto text",
            CreatedByName = "System", SourceKey = "safety:allergies", SourceValueSnapshot = "Peanuts||",
        };
        db.ParticipantNotes.Add(note);
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        // Title-only edit — still counts as a human edit per spec.
        var dto = new UpdateParticipantNoteDto { Title = "Allergies (edited)", Description = "Auto text", IsPinned = false, IsArchived = false };
        await controller.Update(note.Id, dto, CancellationToken.None);

        var saved = await db.ParticipantNotes.SingleAsync();
        Assert.True(saved.IsManuallyEdited);
        Assert.Equal("safety:allergies", saved.SourceKey); // SourceKey never cleared — keeps the idempotency slot
    }

    [Fact]
    public async Task GetForParticipant_ReconciliationCreatesMissingSafetyAutoNote()
    {
        // PD-5 item 5d: a write path that (hypothetically) forgot to call the sync service still
        // shows the correct auto-note the next time the Notes tab loads.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Latex";
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        var result = await controller.GetForParticipant(participant.Id, includeArchived: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantNoteDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var note = Assert.Single(body.Data!);
        Assert.Equal("safety:allergies", note.SourceKey);
        Assert.Contains("Latex", note.Description);
    }

    [Fact]
    public async Task GetForParticipant_ReconciliationDoesNotDuplicateExistingNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Latex";
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        await controller.GetForParticipant(participant.Id, includeArchived: false, CancellationToken.None);
        await controller.GetForParticipant(participant.Id, includeArchived: false, CancellationToken.None);

        var count = await db.ParticipantNotes.CountAsync(n => n.ParticipantId == participant.Id && n.SourceKey == "safety:allergies");
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task DismissDrift_NoteNotFound_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));

        var result = await controller.DismissDrift(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task DismissDrift_OnManualNote_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var note = new ParticipantNote { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Manual", Description = "d", CreatedByName = "Test" };
        db.ParticipantNotes.Add(note);
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        var result = await controller.DismissDrift(note.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task DismissDrift_OnDriftedAutoNote_ClearsDriftAndLeavesTextAlone()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var note = new ParticipantNote
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Allergies (auto)", Description = "Custom clinician wording",
            CreatedByName = "System", SourceKey = "safety:allergies", IsManuallyEdited = true,
            SourceValueSnapshot = "Peanuts||", HasSourceDrift = true,
        };
        db.ParticipantNotes.Add(note);
        db.SaveChanges();
        participant.AllergiesDetail = "Peanuts and tree nuts";
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        var result = await controller.DismissDrift(note.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantNoteDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.False(body.Data!.HasSourceDrift);
        var saved = await db.ParticipantNotes.SingleAsync();
        Assert.Equal("Custom clinician wording", saved.Description);
        Assert.True(saved.IsManuallyEdited);
    }

    [Fact]
    public async Task Regenerate_OnDriftedAutoNote_RestoresMachineTextAndClearsManualFlag()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.AllergiesDetail = "Peanuts and tree nuts";
        var note = new ParticipantNote
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Allergies (auto)", Description = "Custom clinician wording",
            CreatedByName = "System", SourceKey = "safety:allergies", IsManuallyEdited = true,
            SourceValueSnapshot = "Peanuts||", HasSourceDrift = true,
        };
        db.ParticipantNotes.Add(note);
        db.SaveChanges();

        var controller = new ParticipantNotesController(db, new SafetyNoteSyncService(db));
        var result = await controller.Regenerate(note.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantNoteDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.False(body.Data!.HasSourceDrift);
        var saved = await db.ParticipantNotes.SingleAsync();
        Assert.Contains("Peanuts and tree nuts", saved.Description);
        Assert.False(saved.IsManuallyEdited);
    }
}
