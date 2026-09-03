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

namespace Odip.Tests.CommunityAccessRisk;

/// <summary>
/// PF-10.2 — controller-level coverage for ParticipantCommunityAccessRiskItemsController. Mirrors
/// ParticipantChecklistItemsControllerTests exactly: same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern, same fixed-enumerated-set (one row per CommunityAccessRiskItemType, 22 values) shape,
/// so tests focus on GET's synthesis of missing rows and PUT's upsert-by-type semantics.
/// </summary>
public class ParticipantCommunityAccessRiskItemsControllerTests
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
    public async Task GetForParticipant_NoRows_SynthesizesAllTwentyTwoItemTypesAsUnrated()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantCommunityAccessRiskItemsController(db);

        var result = await controller.GetForParticipant(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantCommunityAccessRiskItemDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(22, body.Data!.Count);
        Assert.All(body.Data, a => Assert.Null(a.Id));
        Assert.All(body.Data, a => Assert.Null(a.Rating));
        Assert.All(body.Data, a => Assert.Null(a.StrategyNotes));
        Assert.Equal(Enum.GetValues<CommunityAccessRiskItemType>().ToHashSet(), body.Data.Select(a => a.ItemType).ToHashSet());
    }

    [Fact]
    public async Task GetForParticipant_UnknownParticipant_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantCommunityAccessRiskItemsController(db);

        var result = await controller.GetForParticipant(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_NoExistingRow_CreatesOne()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantCommunityAccessRiskItemsController(db);

        var dto = new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.High, StrategyNotes = "Two staff required for all road crossings." };
        var result = await controller.Upsert(participant.Id, nameof(CommunityAccessRiskItemType.GeneralRoadAwareness), dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantCommunityAccessRiskItemDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.NotNull(body.Data!.Id);
        Assert.Equal(RiskRatingLevel.High, body.Data.Rating);
        Assert.Equal("Two staff required for all road crossings.", body.Data.StrategyNotes);

        Assert.Equal(1, await db.ParticipantCommunityAccessRiskItems.CountAsync(a => a.ParticipantId == participant.Id));
    }

    [Fact]
    public async Task Upsert_ExistingRow_UpdatesInPlace_DoesNotDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantCommunityAccessRiskItemsController(db);

        await controller.Upsert(participant.Id, nameof(CommunityAccessRiskItemType.SeizureInCommunity),
            new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.Low }, CancellationToken.None);
        var result = await controller.Upsert(participant.Id, nameof(CommunityAccessRiskItemType.SeizureInCommunity),
            new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.Critical, StrategyNotes = "Reassessed after a seizure in the community." }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantCommunityAccessRiskItemDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(RiskRatingLevel.Critical, body.Data!.Rating);
        Assert.Equal("Reassessed after a seizure in the community.", body.Data.StrategyNotes);
        Assert.Equal(1, await db.ParticipantCommunityAccessRiskItems.CountAsync(a => a.ParticipantId == participant.Id && a.ItemType == CommunityAccessRiskItemType.SeizureInCommunity));
    }

    /// <summary>Two-row disambiguation across two different categories: set two DIFFERENT
    /// CommunityAccessRiskItemType values with different Rating/StrategyNotes, update only one,
    /// confirm the other is unaffected.</summary>
    [Fact]
    public async Task Upsert_UpdatingOneItem_LeavesADifferentItemFromAnotherCategoryUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantCommunityAccessRiskItemsController(db);

        // Road & Traffic Safety.
        await controller.Upsert(participant.Id, nameof(CommunityAccessRiskItemType.WandersOrGetsLostInCrowds),
            new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.Medium, StrategyNotes = "Hold hands in crowded venues." }, CancellationToken.None);
        // Health & Personal Safety.
        await controller.Upsert(participant.Id, nameof(CommunityAccessRiskItemType.AllergyOrAnaphylaxisExposure),
            new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.Critical, StrategyNotes = "EpiPen carried at all times." }, CancellationToken.None);

        await controller.Upsert(participant.Id, nameof(CommunityAccessRiskItemType.WandersOrGetsLostInCrowds),
            new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.Low, StrategyNotes = "Reassessed — responds reliably to name." }, CancellationToken.None);

        var getResult = await controller.GetForParticipant(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<List<ParticipantCommunityAccessRiskItemDto>>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        var wanders = body.Data!.Single(a => a.ItemType == CommunityAccessRiskItemType.WandersOrGetsLostInCrowds);
        var allergy = body.Data!.Single(a => a.ItemType == CommunityAccessRiskItemType.AllergyOrAnaphylaxisExposure);

        Assert.Equal(RiskRatingLevel.Low, wanders.Rating);
        Assert.Equal("Reassessed — responds reliably to name.", wanders.StrategyNotes);

        Assert.Equal(RiskRatingLevel.Critical, allergy.Rating);
        Assert.Equal("EpiPen carried at all times.", allergy.StrategyNotes);
    }

    [Fact]
    public async Task Upsert_UnrecognisedItemType_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantCommunityAccessRiskItemsController(db);

        var result = await controller.Upsert(participant.Id, "NotARealRiskItemType", new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.Low }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_BlankStrategyNotes_IsStoredAsNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantCommunityAccessRiskItemsController(db);

        var result = await controller.Upsert(participant.Id, nameof(CommunityAccessRiskItemType.HeatSunExposure),
            new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.Medium, StrategyNotes = "   " }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantCommunityAccessRiskItemDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(body.Data!.StrategyNotes);
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

        var controller = new ParticipantCommunityAccessRiskItemsController(db);
        await controller.Upsert(participant.Id, nameof(CommunityAccessRiskItemType.WaterSafety), new UpsertParticipantCommunityAccessRiskItemDto { Rating = RiskRatingLevel.Medium }, CancellationToken.None);

        var saved = await db.ParticipantCommunityAccessRiskItems.IgnoreQueryFilters().SingleAsync(a => a.ParticipantId == participant.Id);
        Assert.Equal(tenantId, saved.TenantId);
    }
}
