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

namespace Odip.Tests.AdlAssessments;

/// <summary>
/// INTAKE sub-wave C2 — controller-level coverage for ParticipantAdlAssessmentsController. Mirrors
/// ParticipantHealthConditionsControllerTests exactly: same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern, same fixed-enumerated-set (one row per AdlType, 20 values) shape, so tests focus on
/// GET's synthesis of missing rows and PUT's upsert-by-type semantics.
/// </summary>
public class ParticipantAdlAssessmentsControllerTests
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
    public async Task GetForParticipant_NoRows_SynthesizesAllTwentyAdlTypesAsUnassessed()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        var result = await controller.GetForParticipant(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantAdlAssessmentDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(20, body.Data!.Count);
        Assert.All(body.Data, a => Assert.Null(a.Id));
        Assert.All(body.Data, a => Assert.Null(a.Level));
        Assert.Equal(Enum.GetValues<AdlType>().ToHashSet(), body.Data.Select(a => a.AdlType).ToHashSet());
    }

    [Fact]
    public async Task GetForParticipant_UnknownParticipant_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantAdlAssessmentsController(db);

        var result = await controller.GetForParticipant(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_NoExistingRow_CreatesOne()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        var dto = new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Supervision, Notes = "Standby supervision in the shower." };
        var result = await controller.Upsert(participant.Id, nameof(AdlType.Bathing), dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantAdlAssessmentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.NotNull(body.Data!.Id);
        Assert.Equal(AdlLevel.Supervision, body.Data.Level);
        Assert.Equal("Standby supervision in the shower.", body.Data.Notes);

        Assert.Equal(1, await db.ParticipantAdlAssessments.CountAsync(a => a.ParticipantId == participant.Id));
    }

    [Fact]
    public async Task Upsert_ExistingRow_UpdatesInPlace_DoesNotDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        await controller.Upsert(participant.Id, nameof(AdlType.Kitchen),
            new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Independent }, CancellationToken.None);
        var result = await controller.Upsert(participant.Id, nameof(AdlType.Kitchen),
            new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Assistance, Notes = "Reassessed after a fall." }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantAdlAssessmentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(AdlLevel.Assistance, body.Data!.Level);
        Assert.Equal("Reassessed after a fall.", body.Data.Notes);
        Assert.Equal(1, await db.ParticipantAdlAssessments.CountAsync(a => a.ParticipantId == participant.Id && a.AdlType == AdlType.Kitchen));
    }

    /// <summary>Tri-state round-trip incl. not-assessed: an explicit level, then explicitly cleared back to null, is distinct from a row that was never touched.</summary>
    [Fact]
    public async Task Upsert_LevelClearedBackToNull_IsDistinctFromNeverAssessed()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        await controller.Upsert(participant.Id, nameof(AdlType.Dressing), new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Independent }, CancellationToken.None);
        await controller.Upsert(participant.Id, nameof(AdlType.Dressing), new UpsertParticipantAdlAssessmentDto { Level = null }, CancellationToken.None);

        var getResult = await controller.GetForParticipant(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<List<ParticipantAdlAssessmentDto>>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        var dressing = body.Data!.Single(a => a.AdlType == AdlType.Dressing);
        var untouched = body.Data!.Single(a => a.AdlType == AdlType.Banking);

        Assert.Null(dressing.Level);
        Assert.NotNull(dressing.Id); // explicitly answered then cleared — a real row exists
        Assert.Null(untouched.Level);
        Assert.Null(untouched.Id); // still a synthesized placeholder — never touched at all
    }

    [Fact]
    public async Task Upsert_UnrecognisedAdlType_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        var result = await controller.Upsert(participant.Id, "NotARealAdlType", new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Independent }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_BlankNotes_IsStoredAsNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        var result = await controller.Upsert(participant.Id, nameof(AdlType.Shopping),
            new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Supervision, Notes = "   " }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantAdlAssessmentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
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

        var controller = new ParticipantAdlAssessmentsController(db);
        await controller.Upsert(participant.Id, nameof(AdlType.CommunityAccess), new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Assistance }, CancellationToken.None);

        var saved = await db.ParticipantAdlAssessments.IgnoreQueryFilters().SingleAsync(a => a.ParticipantId == participant.Id);
        Assert.Equal(tenantId, saved.TenantId);
    }

    /// <summary>INTAKE-03 — HowToHelpNotes round-trip: set via create, confirm it persists and
    /// round-trips via GET.</summary>
    [Fact]
    public async Task Upsert_HowToHelpNotes_NoExistingRow_PersistsAndRoundTripsViaGet()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        var result = await controller.Upsert(participant.Id, nameof(AdlType.CommunityAccess),
            new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Supervision, HowToHelpNotes = "Stay within sight at all times; watch for early-warning seizure signs." }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantAdlAssessmentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Stay within sight at all times; watch for early-warning seizure signs.", body.Data!.HowToHelpNotes);

        var getResult = await controller.GetForParticipant(participant.Id, CancellationToken.None);
        var getBody = Assert.IsType<ApiResponse<List<ParticipantAdlAssessmentDto>>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        var row = getBody.Data!.Single(a => a.AdlType == AdlType.CommunityAccess);
        Assert.Equal("Stay within sight at all times; watch for early-warning seizure signs.", row.HowToHelpNotes);
    }

    /// <summary>INTAKE-03 — HowToHelpNotes update: a second Upsert call changes the value in place.</summary>
    [Fact]
    public async Task Upsert_HowToHelpNotes_ExistingRow_UpdatesInPlace()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        await controller.Upsert(participant.Id, nameof(AdlType.MedicationAdministration),
            new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Assistance, HowToHelpNotes = "Prompt gently and confirm the tablet was swallowed." }, CancellationToken.None);
        var result = await controller.Upsert(participant.Id, nameof(AdlType.MedicationAdministration),
            new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Assistance, HowToHelpNotes = "Administer via PEG per plan; confirm site looks normal before and after." }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantAdlAssessmentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Administer via PEG per plan; confirm site looks normal before and after.", body.Data!.HowToHelpNotes);
        Assert.Equal(1, await db.ParticipantAdlAssessments.CountAsync(a => a.ParticipantId == participant.Id && a.AdlType == AdlType.MedicationAdministration));
    }

    /// <summary>INTAKE-03 — HowToHelpNotes null-handling: whitespace-only is stored as null, matching
    /// the Notes convention (see ParticipantGridRules.ApplyAnswer).</summary>
    [Fact]
    public async Task Upsert_HowToHelpNotes_WhitespaceOnly_IsStoredAsNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantAdlAssessmentsController(db);

        await controller.Upsert(participant.Id, nameof(AdlType.Bathing),
            new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Assistance, HowToHelpNotes = "Confirm each step with her via the AAC device before proceeding." }, CancellationToken.None);
        var result = await controller.Upsert(participant.Id, nameof(AdlType.Bathing),
            new UpsertParticipantAdlAssessmentDto { Level = AdlLevel.Assistance, HowToHelpNotes = "   " }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantAdlAssessmentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(body.Data!.HowToHelpNotes);
    }
}
