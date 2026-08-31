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

namespace Odip.Tests.ChecklistItems;

/// <summary>
/// INTAKE-03/04 — controller-level coverage for ParticipantChecklistItemsController. Mirrors
/// ParticipantAdlAssessmentsControllerTests exactly: same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern, same fixed-enumerated-set (one row per ChecklistItemType, 21 values) shape, so tests
/// focus on GET's synthesis of missing rows and PUT's upsert-by-type semantics.
/// </summary>
public class ParticipantChecklistItemsControllerTests
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

    [Fact]
    public async Task GetForParticipant_NoRows_SynthesizesAllTwentyOneChecklistItemTypesAsUnassessed()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantChecklistItemsController(db);

        var result = await controller.GetForParticipant(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantChecklistItemDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(21, body.Data!.Count);
        Assert.All(body.Data, a => Assert.Null(a.Id));
        Assert.All(body.Data, a => Assert.Null(a.Value));
        Assert.All(body.Data, a => Assert.Null(a.Notes));
        Assert.Equal(Enum.GetValues<ChecklistItemType>().ToHashSet(), body.Data.Select(a => a.ItemType).ToHashSet());
    }

    [Fact]
    public async Task GetForParticipant_UnknownParticipant_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantChecklistItemsController(db);

        var result = await controller.GetForParticipant(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_NoExistingRow_CreatesOne()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantChecklistItemsController(db);

        var dto = new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.Yes, Notes = "Power wheelchair — confirm restraint on every transfer." };
        var result = await controller.Upsert(participant.Id, nameof(ChecklistItemType.UsesWheelchair), dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantChecklistItemDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.NotNull(body.Data!.Id);
        Assert.Equal(ChecklistItemValue.Yes, body.Data.Value);
        Assert.Equal("Power wheelchair — confirm restraint on every transfer.", body.Data.Notes);

        Assert.Equal(1, await db.ParticipantChecklistItems.CountAsync(a => a.ParticipantId == participant.Id));
    }

    [Fact]
    public async Task Upsert_ExistingRow_UpdatesInPlace_DoesNotDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantChecklistItemsController(db);

        await controller.Upsert(participant.Id, nameof(ChecklistItemType.FallsRisk),
            new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.No }, CancellationToken.None);
        var result = await controller.Upsert(participant.Id, nameof(ChecklistItemType.FallsRisk),
            new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.Yes, Notes = "Reassessed after a fall." }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantChecklistItemDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ChecklistItemValue.Yes, body.Data!.Value);
        Assert.Equal("Reassessed after a fall.", body.Data.Notes);
        Assert.Equal(1, await db.ParticipantChecklistItems.CountAsync(a => a.ParticipantId == participant.Id && a.ItemType == ChecklistItemType.FallsRisk));
    }

    /// <summary>Two-row disambiguation: set two DIFFERENT ChecklistItemType values (one from each
    /// checklist group) with different Value/Notes, update only one of them, and confirm the other
    /// is completely unaffected — exact value/notes still match what was set, not accidentally
    /// swapped or blanked.</summary>
    [Fact]
    public async Task Upsert_UpdatingOneItem_LeavesADifferentItemFromTheOtherGroupUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantChecklistItemsController(db);

        // UsesWheelchair — Community Mobility & Transport Risk group.
        await controller.Upsert(participant.Id, nameof(ChecklistItemType.UsesWheelchair),
            new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.Yes, Notes = "Power wheelchair." }, CancellationToken.None);
        // HarmToSelf — Community Behaviours of Concern group.
        await controller.Upsert(participant.Id, nameof(ChecklistItemType.HarmToSelf),
            new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.No, Notes = "No current self-harm behaviours." }, CancellationToken.None);

        // Update only UsesWheelchair.
        await controller.Upsert(participant.Id, nameof(ChecklistItemType.UsesWheelchair),
            new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.NotApplicable, Notes = "Reassessed — no longer wheelchair-dependent." }, CancellationToken.None);

        var getResult = await controller.GetForParticipant(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<List<ParticipantChecklistItemDto>>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        var wheelchair = body.Data!.Single(a => a.ItemType == ChecklistItemType.UsesWheelchair);
        var harmToSelf = body.Data!.Single(a => a.ItemType == ChecklistItemType.HarmToSelf);

        Assert.Equal(ChecklistItemValue.NotApplicable, wheelchair.Value);
        Assert.Equal("Reassessed — no longer wheelchair-dependent.", wheelchair.Notes);

        Assert.Equal(ChecklistItemValue.No, harmToSelf.Value);
        Assert.Equal("No current self-harm behaviours.", harmToSelf.Notes);
    }

    [Fact]
    public async Task Upsert_UnrecognisedChecklistItemType_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantChecklistItemsController(db);

        var result = await controller.Upsert(participant.Id, "NotARealChecklistItemType", new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.Yes }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_BlankNotes_IsStoredAsNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantChecklistItemsController(db);

        var result = await controller.Upsert(participant.Id, nameof(ChecklistItemType.SensorySensitivities),
            new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.Yes, Notes = "   " }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantChecklistItemDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(body.Data!.Notes);
    }

    [Fact]
    public async Task Upsert_TenantScoped_RowGetsSameTenantIdAsParticipant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenant.Object);

        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantChecklistItemsController(db);
        await controller.Upsert(participant.Id, nameof(ChecklistItemType.HarmToOthers), new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.No }, CancellationToken.None);

        var saved = await db.ParticipantChecklistItems.IgnoreQueryFilters().SingleAsync(a => a.ParticipantId == participant.Id);
        Assert.Equal(tenantId, saved.TenantId);
    }

    /// <summary>A checklist item belonging to a participant in tenant A is not visible via tenant
    /// B's ambient query filter — mirrors ParticipantAdlAssessmentsControllerTests' tenant-scoping
    /// coverage style (a cross-tenant participant lookup 404s before any row visibility even
    /// matters, since OdipDbContext's ambient query filter already hides the tenant-A participant
    /// itself from tenant B's _db.Participants.AnyAsync check).</summary>
    [Fact]
    public async Task GetForParticipant_ParticipantBelongsToDifferentTenant_ReturnsNotFound()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        var tenantASetup = new Mock<ICurrentTenant>();
        tenantASetup.Setup(t => t.TenantId).Returns(tenantA);
        tenantASetup.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;

        Guid participantId;
        using (var dbA = new OdipDbContext(options, tenantASetup.Object))
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantA, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            dbA.Participants.Add(participant);
            dbA.SaveChanges();
            participantId = participant.Id;

            var controllerA = new ParticipantChecklistItemsController(dbA);
            await controllerA.Upsert(participantId, nameof(ChecklistItemType.FallsRisk), new UpsertParticipantChecklistItemDto { Value = ChecklistItemValue.Yes, Notes = "Tenant A note." }, CancellationToken.None);
        }

        var tenantBSetup = new Mock<ICurrentTenant>();
        tenantBSetup.Setup(t => t.TenantId).Returns(tenantB);
        tenantBSetup.Setup(t => t.IsSuperAdmin).Returns(false);
        using var dbB = new OdipDbContext(options, tenantBSetup.Object);
        var controllerB = new ParticipantChecklistItemsController(dbB);

        var result = await controllerB.GetForParticipant(participantId, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }
}
