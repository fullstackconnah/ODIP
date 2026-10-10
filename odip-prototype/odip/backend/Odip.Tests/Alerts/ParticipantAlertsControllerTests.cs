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
using Odip.Tests.Support;

namespace Odip.Tests.Alerts;

/// <summary>
/// Controller-level coverage for <see cref="ParticipantAlertsController"/> — the thin HTTP layer
/// over <see cref="ParticipantAlertsService"/> (see ParticipantAlertsServiceTests for the rule
/// logic itself).
/// </summary>
public class ParticipantAlertsControllerTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    private static Participant SeedParticipant(OdipDbContext db, bool isHighSupport = false, bool isActive = true)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = isActive,
            IsHighSupport = isHighSupport,
        };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    [Fact]
    public async Task GetForParticipant_ParticipantMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantAlertsController(new ParticipantAlertsService(db), db);

        var result = await controller.GetForParticipant(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetForParticipant_Valid_ReturnsAlertsDto()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, isHighSupport: true);
        var controller = new ParticipantAlertsController(new ParticipantAlertsService(db), db);

        var result = await controller.GetForParticipant(participant.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantAlertsDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(participant.Id, body.Data!.ParticipantId);
        Assert.Single(body.Data.Alerts);
        Assert.Equal(1, body.Data.WarningCount);
    }

    [Fact]
    public async Task GetAggregate_ReturnsEntryPerParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        SeedParticipant(db, isHighSupport: true);
        SeedParticipant(db, isHighSupport: false);
        var controller = new ParticipantAlertsController(new ParticipantAlertsService(db), db);

        var result = await controller.GetAggregate(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<ParticipantAlertsDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(2, body.Data!.Count);
        Assert.Contains(body.Data, d => d.WarningCount == 1);
        Assert.Contains(body.Data, d => d.WarningCount == 0 && d.Alerts.Count == 0);
    }

    // ── activeOnly wiring (fix round 1 — review finding) ────────────────────

    [Fact]
    public async Task GetAggregate_ExcludesInactiveParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var active = SeedParticipant(db, isHighSupport: true, isActive: true);
        var churned = SeedParticipant(db, isHighSupport: true, isActive: false);
        var controller = new ParticipantAlertsController(new ParticipantAlertsService(db), db);

        var result = await controller.GetAggregate(CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantAlertsDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var dto = Assert.Single(body.Data!);
        Assert.Equal(active.Id, dto.ParticipantId);
        Assert.DoesNotContain(body.Data!, d => d.ParticipantId == churned.Id);
    }

    [Fact]
    public async Task GetForParticipant_InactiveParticipant_StillReturnsAlerts()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var churned = SeedParticipant(db, isHighSupport: true, isActive: false);
        var controller = new ParticipantAlertsController(new ParticipantAlertsService(db), db);

        var result = await controller.GetForParticipant(churned.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantAlertsDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(churned.Id, body.Data!.ParticipantId);
        Assert.Single(body.Data.Alerts);
        Assert.False(body.Data.IsActive);
    }
}
