using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.RiskEntries;

/// <summary>
/// Controller-level coverage for the Participant Risk Entries API slice (INTAKE-09,
/// ParticipantRiskEntriesController), using the same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern as ParticipantRoutinesControllerTests — this entity/controller mirrors that one
/// closely.
/// </summary>
public class ParticipantRiskEntriesControllerTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    /// <summary>Tenant-scoped (non-SuperAdmin) context — mirrors ParticipantRoutinesControllerTests.</summary>
    private static OdipDbContext CreateTenantScopedDb(string dbName, Guid tenantId) => TestDb.ForTenant(dbName, tenantId);

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Sophie", string lastName = "Brown")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static CreateParticipantRiskEntryDto CreateDto(
        AtRiskParty atRiskParty = AtRiskParty.Participant,
        string description = "Risk of falls during transfers.",
        string? mitigationNotes = "Use the hoist for all transfers.",
        bool isActive = true) => new()
    {
        AtRiskParty = atRiskParty,
        Description = description,
        MitigationNotes = mitigationNotes,
        IsActive = isActive,
    };

    // ── Create ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ParticipantMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        var result = await controller.Create(Guid.NewGuid(), CreateDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_Valid_SavesAndReturnsDto()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        var dto = CreateDto(
            atRiskParty: AtRiskParty.Staff, description: "Risk of aggression towards support staff.",
            mitigationNotes: "Two-person support during personal care.");

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantRiskEntryDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(participant.Id, body.Data!.ParticipantId);
        Assert.Equal(AtRiskParty.Staff, body.Data.AtRiskParty);
        Assert.Equal("Risk of aggression towards support staff.", body.Data.Description);
        Assert.Equal("Two-person support during personal care.", body.Data.MitigationNotes);
        Assert.True(body.Data.IsActive);

        var saved = await db.ParticipantRiskEntries.SingleAsync();
        Assert.Equal(participant.Id, saved.ParticipantId);
        Assert.Equal(AtRiskParty.Staff, saved.AtRiskParty);
    }

    [Fact]
    public async Task Create_TrimsDescriptionAndMitigationNotes()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        var dto = CreateDto(description: "  Risk of wandering.  ", mitigationNotes: "  Door alarms fitted.  ");

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantRiskEntryDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Risk of wandering.", body.Data!.Description);
        Assert.Equal("Door alarms fitted.", body.Data.MitigationNotes);
    }

    [Fact]
    public async Task Create_BlankMitigationNotes_IsStoredAsNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        var dto = CreateDto(mitigationNotes: "   ");

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantRiskEntryDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(body.Data!.MitigationNotes);
    }

    // ── List / filtering ─────────────────────────────────────────────────

    [Fact]
    public async Task GetForParticipant_DefaultExcludesInactive()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.ParticipantRiskEntries.AddRange(
            new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Participant, Description = "Active risk", IsActive = true },
            new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Staff, Description = "Retired risk", IsActive = false });
        db.SaveChanges();

        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));
        var result = await controller.GetForParticipant(participant.Id, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRiskEntryDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!);
        Assert.Equal("Active risk", entry.Description);
    }

    [Fact]
    public async Task GetForParticipant_IncludeInactiveTrue_ReturnsBoth()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.ParticipantRiskEntries.AddRange(
            new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Participant, Description = "Active risk", IsActive = true },
            new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Staff, Description = "Retired risk", IsActive = false });
        db.SaveChanges();

        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));
        var result = await controller.GetForParticipant(participant.Id, includeInactive: true, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRiskEntryDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, body.Data!.Count);
    }

    [Fact]
    public async Task GetForParticipant_OnlyReturnsRowsForThatParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participantA = SeedParticipant(db, "Sophie", "Brown");
        var participantB = SeedParticipant(db, "Harrison", "Lee");
        db.ParticipantRiskEntries.AddRange(
            new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participantA.Id, AtRiskParty = AtRiskParty.Participant, Description = "A's risk", IsActive = true },
            new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participantB.Id, AtRiskParty = AtRiskParty.Participant, Description = "B's risk", IsActive = true });
        db.SaveChanges();

        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));
        var result = await controller.GetForParticipant(participantA.Id, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRiskEntryDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!);
        Assert.Equal("A's risk", entry.Description);
    }

    // ── Update ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_EntryMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        var dto = new UpdateParticipantRiskEntryDto { AtRiskParty = AtRiskParty.Public, Description = "d" };
        var result = await controller.Update(Guid.NewGuid(), dto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Valid_UpdatesFieldsIncludingPartyAndInactive()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var entry = new ParticipantRiskEntry
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Participant,
            Description = "Original", MitigationNotes = null, IsActive = true,
        };
        db.ParticipantRiskEntries.Add(entry);
        db.SaveChanges();

        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));
        var dto = new UpdateParticipantRiskEntryDto
        {
            AtRiskParty = AtRiskParty.OtherParticipants, Description = "Updated", MitigationNotes = "Now mitigated", IsActive = false,
        };

        var result = await controller.Update(entry.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantRiskEntryDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(AtRiskParty.OtherParticipants, body.Data!.AtRiskParty);
        Assert.Equal("Updated", body.Data.Description);
        Assert.Equal("Now mitigated", body.Data.MitigationNotes);
        Assert.False(body.Data.IsActive);

        var saved = await db.ParticipantRiskEntries.SingleAsync();
        Assert.Equal("Updated", saved.Description);
        Assert.False(saved.IsActive);
    }

    // ── Delete ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_EntryMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        var result = await controller.Delete(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Delete_Valid_RemovesRowFromDatabase()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var entry = new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Public, Description = "To delete" };
        db.ParticipantRiskEntries.Add(entry);
        db.SaveChanges();

        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));
        var result = await controller.Delete(entry.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<bool>>(ok.Value);
        Assert.True(body.Success);
        Assert.True(body.Data);

        Assert.False(await db.ParticipantRiskEntries.AnyAsync(r => r.Id == entry.Id));
    }

    // ── Tenant scoping ───────────────────────────────────────────────────

    [Fact]
    public async Task GetForParticipant_TenantScoped_DoesNotReturnOtherTenantsEntries()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        Guid participantId;
        using (var seedDb = CreateDb(dbName))
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantA, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            seedDb.Participants.Add(participant);
            participantId = participant.Id;
            seedDb.ParticipantRiskEntries.AddRange(
                new ParticipantRiskEntry { Id = Guid.NewGuid(), TenantId = tenantA, ParticipantId = participantId, AtRiskParty = AtRiskParty.Participant, Description = "Tenant A risk", IsActive = true },
                new ParticipantRiskEntry { Id = Guid.NewGuid(), TenantId = tenantB, ParticipantId = participantId, AtRiskParty = AtRiskParty.Participant, Description = "Tenant B risk", IsActive = true });
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantA);
        var controller = new ParticipantRiskEntriesController(scopedDb, new SafetyNoteSyncService(scopedDb));

        var result = await controller.GetForParticipant(participantId, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRiskEntryDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!);
        Assert.Equal("Tenant A risk", entry.Description);
    }

    [Fact]
    public async Task Create_TenantScoped_AutoAssignsTenantIdFromCurrentTenant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();

        Guid participantId;
        using (var seedDb = CreateDb(dbName))
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            seedDb.Participants.Add(participant);
            participantId = participant.Id;
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantId);
        var controller = new ParticipantRiskEntriesController(scopedDb, new SafetyNoteSyncService(scopedDb));

        var result = await controller.Create(participantId, CreateDto(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);

        using var verifyDb = CreateDb(dbName);
        var saved = await verifyDb.ParticipantRiskEntries.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(tenantId, saved.TenantId);
    }

    // ── PD-5 item 5b: ongoing (post-creation) risk-entry edit path syncs the auto-note ──────

    [Fact]
    public async Task Create_ActiveEntry_SyncsRisksHazardsSafetyAutoNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        await controller.Create(participant.Id, CreateDto(description: "Risk of choking on hard foods."), CancellationToken.None);

        var note = await db.ParticipantNotes.SingleAsync(n => n.ParticipantId == participant.Id && n.SourceKey == "safety:risksHazards");
        Assert.Contains("choking on hard foods", note.Description);
    }

    [Fact]
    public async Task Update_ChangingDescription_SyncsRisksHazardsSafetyAutoNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        var createResult = await controller.Create(participant.Id, CreateDto(), CancellationToken.None);
        var created = Assert.IsType<ApiResponse<ParticipantRiskEntryDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value);

        var updateDto = new UpdateParticipantRiskEntryDto
        {
            AtRiskParty = AtRiskParty.Participant, Description = "Risk of skin breakdown from prolonged sitting.", IsActive = true,
        };
        await controller.Update(created.Data!.Id, updateDto, CancellationToken.None);

        var note = await db.ParticipantNotes.SingleAsync(n => n.ParticipantId == participant.Id && n.SourceKey == "safety:risksHazards");
        Assert.Contains("skin breakdown", note.Description);
    }

    [Fact]
    public async Task Delete_LastActiveEntry_ArchivesRisksHazardsSafetyAutoNote()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRiskEntriesController(db, new SafetyNoteSyncService(db));

        var createResult = await controller.Create(participant.Id, CreateDto(), CancellationToken.None);
        var created = Assert.IsType<ApiResponse<ParticipantRiskEntryDto>>(Assert.IsType<OkObjectResult>(createResult.Result).Value);
        Assert.False((await db.ParticipantNotes.SingleAsync(n => n.SourceKey == "safety:risksHazards")).IsArchived);

        await controller.Delete(created.Data!.Id, CancellationToken.None);

        var note = await db.ParticipantNotes.SingleAsync(n => n.ParticipantId == participant.Id && n.SourceKey == "safety:risksHazards");
        Assert.True(note.IsArchived);
    }
}
