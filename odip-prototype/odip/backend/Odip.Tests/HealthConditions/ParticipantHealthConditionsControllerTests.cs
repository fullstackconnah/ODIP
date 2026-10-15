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
using Odip.Tests.Support;

namespace Odip.Tests.HealthConditions;

/// <summary>
/// INTAKE sub-wave C1 — controller-level coverage for ParticipantHealthConditionsController.
/// Mirrors ParticipantConsentsControllerTests exactly: same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern, same fixed-enumerated-set (one row per HealthConditionType) shape, so tests focus on
/// GET's synthesis of missing rows and PUT's upsert-by-type semantics.
/// </summary>
public class ParticipantHealthConditionsControllerTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Sophie", string lastName = "Brown")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    [Fact]
    public async Task GetForParticipant_NoRows_SynthesizesAllTenConditionTypesAsUnanswered()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantHealthConditionsController(db);

        var result = await controller.GetForParticipant(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantHealthConditionDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(10, body.Data!.Count);
        Assert.All(body.Data, c => Assert.Null(c.Id));
        Assert.All(body.Data, c => Assert.Null(c.Has));
        Assert.Equal(Enum.GetValues<HealthConditionType>().ToHashSet(), body.Data.Select(c => c.ConditionType).ToHashSet());
    }

    [Fact]
    public async Task GetForParticipant_UnknownParticipant_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantHealthConditionsController(db);

        var result = await controller.GetForParticipant(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_NoExistingRow_CreatesOne()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantHealthConditionsController(db);

        var dto = new UpsertParticipantHealthConditionDto { Has = true, Severity = "GrandMal", PlanProvided = true, TrainingRequired = true, Notes = "See seizure plan" };
        var result = await controller.Upsert(participant.Id, nameof(HealthConditionType.Epilepsy), dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantHealthConditionDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.NotNull(body.Data!.Id);
        Assert.True(body.Data.Has);
        Assert.Equal("GrandMal", body.Data.Severity);
        Assert.True(body.Data.PlanProvided);
        Assert.True(body.Data.TrainingRequired);

        Assert.Equal(1, await db.ParticipantHealthConditions.CountAsync(c => c.ParticipantId == participant.Id));
    }

    [Fact]
    public async Task Upsert_ExistingRow_UpdatesInPlace_DoesNotDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantHealthConditionsController(db);

        await controller.Upsert(participant.Id, nameof(HealthConditionType.Diabetes),
            new UpsertParticipantHealthConditionDto { Has = false }, CancellationToken.None);
        var result = await controller.Upsert(participant.Id, nameof(HealthConditionType.Diabetes),
            new UpsertParticipantHealthConditionDto { Has = true, Severity = "Type2", PlanProvided = true }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantHealthConditionDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Has);
        Assert.Equal("Type2", body.Data.Severity);
        Assert.Equal(1, await db.ParticipantHealthConditions.CountAsync(c => c.ParticipantId == participant.Id && c.ConditionType == HealthConditionType.Diabetes));
    }

    [Fact]
    public async Task Upsert_HasFalse_IsDistinctFromNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantHealthConditionsController(db);

        await controller.Upsert(participant.Id, nameof(HealthConditionType.Asthma), new UpsertParticipantHealthConditionDto { Has = false }, CancellationToken.None);

        var getResult = await controller.GetForParticipant(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<List<ParticipantHealthConditionDto>>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        var asthma = body.Data!.Single(c => c.ConditionType == HealthConditionType.Asthma);
        var untouched = body.Data.Single(c => c.ConditionType == HealthConditionType.WoundCare);

        Assert.False(asthma.Has); // explicitly answered "no"
        Assert.NotNull(asthma.Id);
        Assert.Null(untouched.Has); // never answered
        Assert.Null(untouched.Id); // still a synthesized placeholder
    }

    [Fact]
    public async Task Upsert_UnrecognisedConditionType_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantHealthConditionsController(db);

        var result = await controller.Upsert(participant.Id, "NotARealConditionType", new UpsertParticipantHealthConditionDto { Has = true }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_BlankSeverityAndNotes_AreStoredAsNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantHealthConditionsController(db);

        var result = await controller.Upsert(participant.Id, nameof(HealthConditionType.HighBloodPressure),
            new UpsertParticipantHealthConditionDto { Has = true, Severity = "   ", Notes = "" }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantHealthConditionDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(body.Data!.Severity);
        Assert.Null(body.Data.Notes);
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

        var controller = new ParticipantHealthConditionsController(db);
        await controller.Upsert(participant.Id, nameof(HealthConditionType.Dysphagia), new UpsertParticipantHealthConditionDto { Has = true }, CancellationToken.None);

        var saved = await db.ParticipantHealthConditions.IgnoreQueryFilters().SingleAsync(c => c.ParticipantId == participant.Id);
        Assert.Equal(tenantId, saved.TenantId);
    }
}
