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
}
