using System.Linq;
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
using Xunit;

namespace Odip.Tests.RestrictivePractices;

/// <summary>
/// Controller-level coverage for the restrictive practices register API slice
/// (RestrictivePracticesController), using the same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern as ParticipantRoutinesControllerTests/MedicationsControllerTests.
/// </summary>
public class RestrictivePracticesControllerTests
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

    /// <summary>Tenant-scoped (non-SuperAdmin) context — mirrors ParticipantRoutinesControllerTests.</summary>
    private static OdipDbContext CreateTenantScopedDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

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

    private static ParticipantMedication SeedMedication(OdipDbContext db, Guid participantId, string name = "Risperidone")
    {
        var medication = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = name,
            DoseDescription = "1 tablet", IsChemicalRestraint = true,
        };
        db.ParticipantMedications.Add(medication);
        db.SaveChanges();
        return medication;
    }

    private static CreateRestrictivePracticeDto CreateDto(
        string description = "Locked doors overnight for safety.",
        RestrictivePracticeType type = RestrictivePracticeType.EnvironmentalRestraint,
        string? authorisedBy = null, DateOnly? authorisationDate = null, DateOnly? reviewDate = null,
        Guid? relatedMedicationId = null, bool isActive = true) => new()
    {
        Description = description,
        Type = type,
        AuthorisedBy = authorisedBy,
        AuthorisationDate = authorisationDate,
        ReviewDate = reviewDate,
        RelatedMedicationId = relatedMedicationId,
        IsActive = isActive,
    };

    // ── Create ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ParticipantMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new RestrictivePracticesController(db);

        var result = await controller.Create(Guid.NewGuid(), CreateDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_Valid_SavesAndReturnsDto()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = CreateDto(
            description: "Seclusion room used during acute crisis periods only.",
            type: RestrictivePracticeType.Seclusion,
            authorisedBy: "Dr. Chen", authorisationDate: new DateOnly(2026, 1, 15),
            reviewDate: new DateOnly(2026, 7, 15));

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RestrictivePracticeDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(participant.Id, body.Data!.ParticipantId);
        Assert.Equal(RestrictivePracticeType.Seclusion, body.Data.Type);
        Assert.Equal("Dr. Chen", body.Data.AuthorisedBy);
        Assert.True(body.Data.IsActive);

        var saved = await db.RestrictivePractices.SingleAsync();
        Assert.Equal(participant.Id, saved.ParticipantId);
        Assert.Equal(RestrictivePracticeType.Seclusion, saved.Type);
    }

    [Fact]
    public async Task Create_ChemicalRestraintWithValidMedication_LinksAndReturnsMedicationName()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var medication = SeedMedication(db, participant.Id, "Risperidone");
        var controller = new RestrictivePracticesController(db);

        var dto = CreateDto(
            description: "Chemical restraint linked to prescribed antipsychotic.",
            type: RestrictivePracticeType.ChemicalRestraint,
            relatedMedicationId: medication.Id);

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<RestrictivePracticeDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(medication.Id, body.Data!.RelatedMedicationId);
        Assert.Equal("Risperidone", body.Data.RelatedMedicationName);
    }

    [Fact]
    public async Task Create_RelatedMedicationBelongsToDifferentParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participantA = SeedParticipant(db, "Sophie", "Brown");
        var participantB = SeedParticipant(db, "Harrison", "Lee");
        var medicationForB = SeedMedication(db, participantB.Id);
        var controller = new RestrictivePracticesController(db);

        var dto = CreateDto(type: RestrictivePracticeType.ChemicalRestraint, relatedMedicationId: medicationForB.Id);

        var result = await controller.Create(participantA.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RestrictivePracticeDto>>(bad.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Errors!, e => e.Contains("does not belong", StringComparison.OrdinalIgnoreCase));

        Assert.Empty(await db.RestrictivePractices.ToListAsync());
    }

    [Fact]
    public async Task Create_RelatedMedicationSetOnNonChemicalRestraintType_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var medication = SeedMedication(db, participant.Id);
        var controller = new RestrictivePracticesController(db);

        // Type is Seclusion (the CreateDto default type below), but RelatedMedicationId is set —
        // only ChemicalRestraint entries may link a medication.
        var dto = CreateDto(type: RestrictivePracticeType.Seclusion, relatedMedicationId: medication.Id);

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RestrictivePracticeDto>>(bad.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Errors!, e => e.Contains("only be set when Type is ChemicalRestraint", StringComparison.OrdinalIgnoreCase));

        Assert.Empty(await db.RestrictivePractices.ToListAsync());
    }

    [Fact]
    public async Task Create_RelatedMedicationDoesNotExist_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = CreateDto(type: RestrictivePracticeType.ChemicalRestraint, relatedMedicationId: Guid.NewGuid());

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ── List / filtering ─────────────────────────────────────────────────

    [Fact]
    public async Task GetForParticipant_DefaultExcludesInactive()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.RestrictivePractices.AddRange(
            new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Active", IsActive = true },
            new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Inactive", IsActive = false });
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        var result = await controller.GetForParticipant(participant.Id, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!);
        Assert.Equal("Active", entry.Description);
    }

    [Fact]
    public async Task GetForParticipant_IncludeInactiveTrue_ReturnsBoth()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.RestrictivePractices.AddRange(
            new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Active", IsActive = true },
            new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Inactive", IsActive = false });
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        var result = await controller.GetForParticipant(participant.Id, includeInactive: true, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, body.Data!.Count);
    }

    [Fact]
    public async Task GetForParticipant_OnlyReturnsRowsForThatParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participantA = SeedParticipant(db, "Sophie", "Brown");
        var participantB = SeedParticipant(db, "Harrison", "Lee");
        db.RestrictivePractices.AddRange(
            new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = participantA.Id, Description = "A's entry", IsActive = true },
            new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = participantB.Id, Description = "B's entry", IsActive = true });
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        var result = await controller.GetForParticipant(participantA.Id, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!);
        Assert.Equal("A's entry", entry.Description);
    }

    // ── Update ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_EntryMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new RestrictivePracticesController(db);

        var dto = new UpdateRestrictivePracticeDto { Description = "d" };
        var result = await controller.Update(Guid.NewGuid(), dto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Valid_UpdatesFieldsIncludingReviewDateAndInactive()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var practice = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Type = RestrictivePracticeType.Unclassified,
            Description = "Original", IsActive = true,
        };
        db.RestrictivePractices.Add(practice);
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        var dto = new UpdateRestrictivePracticeDto
        {
            Type = RestrictivePracticeType.PhysicalRestraint,
            Description = "Updated description",
            AuthorisedBy = "Dr. Nguyen",
            AuthorisationDate = new DateOnly(2026, 2, 1),
            ReviewDate = new DateOnly(2026, 8, 1),
            IsActive = false,
        };

        var result = await controller.Update(practice.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<RestrictivePracticeDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Updated description", body.Data!.Description);
        Assert.Equal(RestrictivePracticeType.PhysicalRestraint, body.Data.Type);
        Assert.False(body.Data.IsActive);

        var saved = await db.RestrictivePractices.SingleAsync();
        Assert.Equal("Dr. Nguyen", saved.AuthorisedBy);
        Assert.False(saved.IsActive);
    }

    [Fact]
    public async Task Update_RelatedMedicationBelongsToDifferentParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participantA = SeedParticipant(db, "Sophie", "Brown");
        var participantB = SeedParticipant(db, "Harrison", "Lee");
        var medicationForB = SeedMedication(db, participantB.Id);
        var practice = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participantA.Id, Description = "d", IsActive = true,
        };
        db.RestrictivePractices.Add(practice);
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        var dto = new UpdateRestrictivePracticeDto
        {
            Type = RestrictivePracticeType.ChemicalRestraint, Description = "d",
            RelatedMedicationId = medicationForB.Id, IsActive = true,
        };

        var result = await controller.Update(practice.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ── Delete ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_EntryMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new RestrictivePracticesController(db);

        var result = await controller.Delete(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Delete_Valid_RemovesRowFromDatabase()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var practice = new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "To delete" };
        db.RestrictivePractices.Add(practice);
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        var result = await controller.Delete(practice.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<bool>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Success);
        Assert.True(body.Data);

        Assert.False(await db.RestrictivePractices.AnyAsync(r => r.Id == practice.Id));
    }

    // ── Derived Participant.HasRestrictivePracticeFlag sync-write ──────────
    // Fix round 1: RosteringController/PortalController read the raw column directly (not the
    // derived-on-read computation ParticipantsController uses), so every register mutation here
    // must keep that column in sync in the same SaveChangesAsync call.

    [Fact]
    public async Task Create_ActiveEntry_SetsParticipantFlagTrue()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        Assert.False(participant.HasRestrictivePracticeFlag);
        var controller = new RestrictivePracticesController(db);

        await controller.Create(participant.Id, CreateDto(isActive: true), CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.True(saved.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task Create_InactiveEntry_LeavesParticipantFlagFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        await controller.Create(participant.Id, CreateDto(isActive: false), CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.False(saved.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task Update_DeactivateOnlyActiveEntry_ClearsParticipantFlag()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.HasRestrictivePracticeFlag = true; // simulates a prior Create having set it
        var practice = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "d", IsActive = true,
        };
        db.RestrictivePractices.Add(practice);
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        var dto = new UpdateRestrictivePracticeDto { Type = RestrictivePracticeType.Unclassified, Description = "d", IsActive = false };

        await controller.Update(practice.Id, dto, CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.False(saved.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task Update_ReactivateEntry_SetsParticipantFlagTrue()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var practice = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "d", IsActive = false,
        };
        db.RestrictivePractices.Add(practice);
        db.SaveChanges();
        Assert.False(participant.HasRestrictivePracticeFlag);

        var controller = new RestrictivePracticesController(db);
        var dto = new UpdateRestrictivePracticeDto { Type = RestrictivePracticeType.Unclassified, Description = "d", IsActive = true };

        await controller.Update(practice.Id, dto, CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.True(saved.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task Update_DeactivateOneOfTwoActiveEntries_KeepsParticipantFlagTrue()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var practiceToDeactivate = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "First", IsActive = true,
        };
        var otherActivePractice = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Second", IsActive = true,
        };
        db.RestrictivePractices.AddRange(practiceToDeactivate, otherActivePractice);
        participant.HasRestrictivePracticeFlag = true;
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        var dto = new UpdateRestrictivePracticeDto { Type = RestrictivePracticeType.Unclassified, Description = "First", IsActive = false };

        await controller.Update(practiceToDeactivate.Id, dto, CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.True(saved.HasRestrictivePracticeFlag); // otherActivePractice is still active
    }

    [Fact]
    public async Task Delete_LastActiveEntry_ClearsParticipantFlag()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        participant.HasRestrictivePracticeFlag = true;
        var practice = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "d", IsActive = true,
        };
        db.RestrictivePractices.Add(practice);
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        await controller.Delete(practice.Id, CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.False(saved.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task Delete_OneOfTwoActiveEntries_KeepsParticipantFlagTrue()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var practiceToDelete = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "First", IsActive = true,
        };
        var otherActivePractice = new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Second", IsActive = true,
        };
        db.RestrictivePractices.AddRange(practiceToDelete, otherActivePractice);
        participant.HasRestrictivePracticeFlag = true;
        db.SaveChanges();

        var controller = new RestrictivePracticesController(db);
        await controller.Delete(practiceToDelete.Id, CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.True(saved.HasRestrictivePracticeFlag); // otherActivePractice is still active
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
            seedDb.RestrictivePractices.AddRange(
                new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), TenantId = tenantA, ParticipantId = participantId, Description = "Tenant A entry", IsActive = true },
                new Domain.Entities.RestrictivePractice { Id = Guid.NewGuid(), TenantId = tenantB, ParticipantId = participantId, Description = "Tenant B entry", IsActive = true });
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantA);
        var controller = new RestrictivePracticesController(scopedDb);

        var result = await controller.GetForParticipant(participantId, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var entry = Assert.Single(body.Data!);
        Assert.Equal("Tenant A entry", entry.Description);
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
        var controller = new RestrictivePracticesController(scopedDb);

        var result = await controller.Create(participantId, CreateDto(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);

        using var verifyDb = CreateDb(dbName);
        var saved = await verifyDb.RestrictivePractices.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(tenantId, saved.TenantId);
    }

    // ── Bulk create (RP-01) ─────────────────────────────────────────────────

    private static BulkCreateRestrictivePracticeRowDto BulkRow(
        string description = "Locked doors overnight for safety.",
        RestrictivePracticeType type = RestrictivePracticeType.EnvironmentalRestraint,
        string? authorisedBy = null, DateOnly? authorisationDate = null, DateOnly? reviewDate = null,
        bool isActive = true) => new()
    {
        Description = description,
        Type = type,
        AuthorisedBy = authorisedBy,
        AuthorisationDate = authorisationDate,
        ReviewDate = reviewDate,
        IsActive = isActive,
    };

    [Fact]
    public async Task CreateBulk_ParticipantMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto { Items = new() { BulkRow() } };
        var result = await controller.CreateBulk(Guid.NewGuid(), dto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateBulk_MoreThan50Rows_ReturnsBadRequestAndPersistsNothing()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = Enumerable.Range(1, 51).Select(i => BulkRow(description: $"Row {i}")).ToList(),
        };

        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(bad.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Errors!, e => e.Contains("maximum of 50 rows", StringComparison.OrdinalIgnoreCase));

        Assert.Empty(await db.RestrictivePractices.ToListAsync());
    }

    [Fact]
    public async Task CreateBulk_Exactly50Rows_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = Enumerable.Range(1, 50).Select(i => BulkRow(description: $"Row {i}")).ToList(),
        };

        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(50, body.Data!.Count);
        Assert.Equal(50, await db.RestrictivePractices.CountAsync());
    }

    [Fact]
    public async Task CreateBulk_NoItems_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto { Items = new() };
        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("At least one row", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task CreateBulk_AllRowsValid_CreatesOneEntryPerRowAndReturnsThem()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new()
            {
                BulkRow(description: "Row one description.", type: RestrictivePracticeType.Seclusion, authorisedBy: "Dr. Chen"),
                BulkRow(description: "Row two description.", type: RestrictivePracticeType.Seclusion, reviewDate: new DateOnly(2026, 12, 1)),
                BulkRow(description: "Row three description.", type: RestrictivePracticeType.Seclusion),
            },
        };

        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Success);
        Assert.Equal(3, body.Data!.Count);
        Assert.All(body.Data, d => Assert.Equal(RestrictivePracticeType.Seclusion, d.Type));
        Assert.All(body.Data, d => Assert.Equal(participant.Id, d.ParticipantId));

        var saved = await db.RestrictivePractices.ToListAsync();
        Assert.Equal(3, saved.Count);
        Assert.Contains(saved, r => r.Description == "Row one description." && r.AuthorisedBy == "Dr. Chen");
        Assert.Contains(saved, r => r.ReviewDate == new DateOnly(2026, 12, 1));
    }

    [Fact]
    public async Task CreateBulk_OneInvalidRow_CreatesNothingAndReportsRowError()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new()
            {
                BulkRow(description: "Valid row."),
                BulkRow(description: "   "), // blank/whitespace-only description
                BulkRow(description: "Another valid row."),
            },
        };

        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(bad.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Errors!, e => e.StartsWith("Row 2:") && e.Contains("Description is required"));

        // All-or-nothing: neither of the valid rows was persisted either.
        Assert.Empty(await db.RestrictivePractices.ToListAsync());
    }

    [Fact]
    public async Task CreateBulk_DescriptionTooLong_ReturnsRowError()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new() { BulkRow(description: new string('x', 2001)) },
        };

        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("2000 characters or fewer"));
        Assert.Empty(await db.RestrictivePractices.ToListAsync());
    }

    [Fact]
    public async Task CreateBulk_AuthorisedByTooLong_ReturnsRowError()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new() { BulkRow(authorisedBy: new string('x', 201)) },
        };

        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.Contains("200 characters or fewer"));
        Assert.Empty(await db.RestrictivePractices.ToListAsync());
    }

    [Fact]
    public async Task CreateBulk_ChemicalRestraintRow_RejectedWithClearMessage_AndNothingCreated()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new()
            {
                BulkRow(description: "Valid environmental row."),
                BulkRow(description: "Chemical row.", type: RestrictivePracticeType.ChemicalRestraint),
            },
        };

        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(bad.Value);
        Assert.Contains(body.Errors!, e => e.StartsWith("Row 2:") && e.Contains("linked medication", StringComparison.OrdinalIgnoreCase));

        // All-or-nothing: the valid row before it was not persisted either.
        Assert.Empty(await db.RestrictivePractices.ToListAsync());
    }

    [Fact]
    public async Task CreateBulk_MultipleInvalidRows_ReportsOneErrorPerRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new()
            {
                BulkRow(description: ""),
                BulkRow(type: RestrictivePracticeType.ChemicalRestraint),
            },
        };

        var result = await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(bad.Value);
        Assert.Equal(2, body.Errors!.Count);
        Assert.Contains(body.Errors, e => e.StartsWith("Row 1:"));
        Assert.Contains(body.Errors, e => e.StartsWith("Row 2:"));
    }

    [Fact]
    public async Task CreateBulk_ActiveRows_SetParticipantFlagTrue()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        Assert.False(participant.HasRestrictivePracticeFlag);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new() { BulkRow(isActive: true), BulkRow(isActive: false) },
        };

        await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.True(saved.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task CreateBulk_AllRowsInactive_LeavesParticipantFlagFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new RestrictivePracticesController(db);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new() { BulkRow(isActive: false), BulkRow(isActive: false) },
        };

        await controller.CreateBulk(participant.Id, dto, CancellationToken.None);

        var saved = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.False(saved.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task CreateBulk_TenantScoped_AutoAssignsTenantIdToEveryRow()
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
        var controller = new RestrictivePracticesController(scopedDb);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new() { BulkRow(description: "Row A"), BulkRow(description: "Row B") },
        };

        var result = await controller.CreateBulk(participantId, dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);

        using var verifyDb = CreateDb(dbName);
        var saved = await verifyDb.RestrictivePractices.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(2, saved.Count);
        Assert.All(saved, r => Assert.Equal(tenantId, r.TenantId));
    }

    [Fact]
    public async Task CreateBulk_TenantScoped_OtherTenantsActiveEntriesDoNotLeakIntoFlagComputation()
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
            // A pre-existing active row for the SAME participant id but a different tenant should
            // never be visible through tenant-scoped queries — this pins that the bulk endpoint's
            // "hasOtherActiveEntry" lookup goes through the same tenant-filtered DbContext as
            // everything else, not a raw cross-tenant query.
            seedDb.RestrictivePractices.Add(new Domain.Entities.RestrictivePractice
            {
                Id = Guid.NewGuid(), TenantId = tenantB, ParticipantId = participantId, Description = "Tenant B entry", IsActive = true,
            });
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantA);
        var controller = new RestrictivePracticesController(scopedDb);

        var dto = new BulkCreateRestrictivePracticeDto
        {
            Items = new() { BulkRow(isActive: false) },
        };

        await controller.CreateBulk(participantId, dto, CancellationToken.None);

        var saved = await scopedDb.Participants.SingleAsync(p => p.Id == participantId);
        // Only tenant B's active row exists; tenant A's own bulk row is inactive. Since tenant
        // scoping hides tenant B's row from tenant A's context, the flag must stay false.
        Assert.False(saved.HasRestrictivePracticeFlag);
    }
}
