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

namespace Odip.Tests.Consents;

/// <summary>
/// INTAKE sub-wave B — controller-level coverage for ParticipantConsentsController. Same EF
/// InMemory + Moq&lt;ICurrentTenant&gt; pattern as ParticipantRiskEntriesControllerTests, but this
/// entity is a FIXED enumerated set (one row per ConsentType) rather than a free-form add/remove
/// list, so the tests focus on GET's synthesis of missing rows and PUT's upsert-by-type semantics
/// instead of Create/Delete.
/// </summary>
public class ParticipantConsentsControllerTests
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
    public async Task GetForParticipant_NoRows_SynthesizesAllSevenConsentTypesAsUnanswered()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantConsentsController(db);

        var result = await controller.GetForParticipant(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantConsentDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(7, body.Data!.Count);
        Assert.All(body.Data, c => Assert.Null(c.Id));
        Assert.All(body.Data, c => Assert.Null(c.Granted));
        Assert.Equal(Enum.GetValues<ConsentType>().ToHashSet(), body.Data.Select(c => c.ConsentType).ToHashSet());
    }

    [Fact]
    public async Task GetForParticipant_UnknownParticipant_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantConsentsController(db);

        var result = await controller.GetForParticipant(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_NoExistingRow_CreatesOne()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantConsentsController(db);

        var dto = new UpsertParticipantConsentDto { Granted = true, SignedByName = "Sophie Brown", SignedDate = new DateOnly(2026, 1, 15) };
        var result = await controller.Upsert(participant.Id, nameof(ConsentType.PhotoVideo), dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantConsentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.NotNull(body.Data!.Id);
        Assert.True(body.Data.Granted);
        Assert.Equal("Sophie Brown", body.Data.SignedByName);
        Assert.NotNull(body.Data.RecordedAt);

        Assert.Equal(1, await db.ParticipantConsents.CountAsync(c => c.ParticipantId == participant.Id));
    }

    [Fact]
    public async Task Upsert_ExistingRow_UpdatesInPlace_DoesNotDuplicate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantConsentsController(db);

        await controller.Upsert(participant.Id, nameof(ConsentType.Privacy),
            new UpsertParticipantConsentDto { Granted = false }, CancellationToken.None);
        var result = await controller.Upsert(participant.Id, nameof(ConsentType.Privacy),
            new UpsertParticipantConsentDto { Granted = true, SignedByName = "Sophie Brown", SignedDate = new DateOnly(2026, 2, 1) }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantConsentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Granted);
        Assert.Equal(1, await db.ParticipantConsents.CountAsync(c => c.ParticipantId == participant.Id && c.ConsentType == ConsentType.Privacy));
    }

    [Fact]
    public async Task Upsert_GrantedFalse_IsDistinctFromNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantConsentsController(db);

        await controller.Upsert(participant.Id, nameof(ConsentType.Alcohol), new UpsertParticipantConsentDto { Granted = false }, CancellationToken.None);

        var getResult = await controller.GetForParticipant(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<List<ParticipantConsentDto>>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        var alcohol = body.Data!.Single(c => c.ConsentType == ConsentType.Alcohol);
        var untouched = body.Data.Single(c => c.ConsentType == ConsentType.EmergencyMedical);

        Assert.False(alcohol.Granted); // explicitly declined
        Assert.NotNull(alcohol.Id);
        Assert.Null(untouched.Granted); // never answered
        Assert.Null(untouched.Id); // still a synthesized placeholder
    }

    [Fact]
    public async Task Upsert_UnrecognisedConsentType_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantConsentsController(db);

        var result = await controller.Upsert(participant.Id, "NotARealConsentType", new UpsertParticipantConsentDto { Granted = true }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upsert_ClearingAnswerBackToUnanswered_ClearsRecordedAt()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantConsentsController(db);

        await controller.Upsert(participant.Id, nameof(ConsentType.TermsAndConditions), new UpsertParticipantConsentDto { Granted = true }, CancellationToken.None);
        var result = await controller.Upsert(participant.Id, nameof(ConsentType.TermsAndConditions), new UpsertParticipantConsentDto { Granted = null }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantConsentDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(body.Data!.Granted);
        Assert.Null(body.Data.RecordedAt);
    }

    /// <summary>
    /// Review-round polish: ApplyAnswer only re-stamps RecordedAt when Granted actually CHANGES
    /// (see its own doc) — resaving the exact same answer (e.g. re-opening and re-confirming the
    /// same consent row without changing anything) must leave the original recorded timestamp
    /// alone, not bump it to "now" on every unrelated save.
    /// </summary>
    [Fact]
    public async Task Upsert_ResavingTheSameAnswer_LeavesRecordedAtUnchanged()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantConsentsController(db);

        var first = await controller.Upsert(participant.Id, nameof(ConsentType.Privacy), new UpsertParticipantConsentDto { Granted = true }, CancellationToken.None);
        var firstBody = Assert.IsType<ApiResponse<ParticipantConsentDto>>(Assert.IsType<OkObjectResult>(first.Result).Value);
        var firstRecordedAt = firstBody.Data!.RecordedAt;
        Assert.NotNull(firstRecordedAt);

        // Same Granted value, resaved — a different SignedByName doesn't count as an answer
        // change (only Granted does, per ApplyAnswer), so RecordedAt must not move.
        var second = await controller.Upsert(participant.Id, nameof(ConsentType.Privacy), new UpsertParticipantConsentDto { Granted = true, SignedByName = "Sophie Brown" }, CancellationToken.None);
        var secondBody = Assert.IsType<ApiResponse<ParticipantConsentDto>>(Assert.IsType<OkObjectResult>(second.Result).Value);

        Assert.Equal(firstRecordedAt, secondBody.Data!.RecordedAt);
        Assert.True(secondBody.Data.Granted);
    }

    [Fact]
    public async Task Upsert_TenantScoped_ConsentGetsSameTenantIdAsParticipant()
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

        var controller = new ParticipantConsentsController(db);
        await controller.Upsert(participant.Id, nameof(ConsentType.EmergencyMedical), new UpsertParticipantConsentDto { Granted = true }, CancellationToken.None);

        var saved = await db.ParticipantConsents.IgnoreQueryFilters().SingleAsync(c => c.ParticipantId == participant.Id);
        Assert.Equal(tenantId, saved.TenantId);
    }
}
