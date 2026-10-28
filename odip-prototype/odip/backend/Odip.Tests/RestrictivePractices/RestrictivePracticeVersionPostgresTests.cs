using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.RestrictivePractices;

/// <summary>The restrictive practice version against a real PostgreSQL: the UpdatedAt concurrency token, its microsecond rounding, the JSON round trip and the single-transaction rollback, which EF InMemory cannot check.</summary>
public class RestrictivePracticeVersionPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public RestrictivePracticeVersionPostgresTests(PostgresFixture pg) => _pg = pg;

    private (OdipDbContext Db, RestrictivePracticesController Controller) Request(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, tenant.Object);
        return (db, new RestrictivePracticesController(db, new SafetyNoteSyncService(db)));
    }

    private async Task<(Guid TenantId, Guid PracticeId, Guid ParticipantId)> SeedAsync()
    {
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await using (seed)
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true, HasRestrictivePracticeFlag = true };
            var practice = new RestrictivePractice
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Type = RestrictivePracticeType.Unclassified,
                Description = "Original", IsActive = true,
            };
            seed.Participants.Add(participant);
            seed.RestrictivePractices.Add(practice);
            await seed.SaveChangesAsync();
            return (tenantId, practice.Id, participant.Id);
        }
    }

    /// <summary>MVC's web defaults plus the API's own policy: the options the response formatter and the body binder really use (as ParticipantHubFlowTests).</summary>
    private static readonly JsonSerializerOptions Wire = ProductionOptions();

    private static JsonSerializerOptions ProductionOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    private static UpdateRestrictivePracticeDto Form(string description, DateTime? expected, bool active = true) =>
        new() { Description = description, IsActive = active, ExpectedUpdatedAt = expected };

    /// <summary>The version as the browser gets it: through the list's JSON, so Kind and precision are the wire's.</summary>
    private static async Task<DateTime> LoadedAsync(RestrictivePracticesController c, Guid participantId)
    {
        var list = Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(
            Assert.IsType<OkObjectResult>((await c.GetForParticipant(participantId, true, CancellationToken.None)).Result).Value);
        var json = JsonSerializer.Serialize(list.Data!.Single(), Wire);
        return JsonSerializer.Deserialize<RestrictivePracticeDto>(json, Wire)!.UpdatedAt;
    }

    [SkippableFact]
    public async Task Two_editors_on_one_entry_the_second_save_is_a_409_and_the_first_description_stays()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, practiceId, participantId) = await SeedAsync();
        DateTime loadedA, loadedB;
        { var (db, c) = Request(tenantId); await using var _ = db; loadedA = await LoadedAsync(c, participantId); }
        { var (db, c) = Request(tenantId); await using var _ = db; loadedB = await LoadedAsync(c, participantId); }

        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Update(practiceId, Form("From A", loadedA), CancellationToken.None)).Result); }
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<ConflictObjectResult>((await c.Update(practiceId, Form("From B", loadedB), CancellationToken.None)).Result); }

        var (check, _c) = Request(tenantId);
        await using (check)
            Assert.Equal("From A", (await check.RestrictivePractices.SingleAsync()).Description);
    }

    [SkippableFact]
    public async Task The_version_in_the_update_response_is_accepted_by_the_next_save()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, practiceId, participantId) = await SeedAsync();
        DateTime loaded;
        { var (db, c) = Request(tenantId); await using var _ = db; loaded = await LoadedAsync(c, participantId); }

        DateTime returned;
        {
            var (db, c) = Request(tenantId); await using var _ = db;
            var ok = Assert.IsType<OkObjectResult>((await c.Update(practiceId, Form("First", loaded), CancellationToken.None)).Result);
            returned = Assert.IsType<ApiResponse<RestrictivePracticeDto>>(ok.Value).Data!.UpdatedAt;
        }

        // The returned value is whole microseconds, as stored; with 100 ns ticks the second save would be a false 409.
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Update(practiceId, Form("Second", returned), CancellationToken.None)).Result); }
    }

    [SkippableFact]
    public async Task A_refused_save_leaves_the_participant_flag_and_the_entry_unchanged()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, practiceId, participantId) = await SeedAsync();
        DateTime loaded;
        { var (db, c) = Request(tenantId); await using var _ = db; loaded = await LoadedAsync(c, participantId); }
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Update(practiceId, Form("Edited", loaded), CancellationToken.None)).Result); }

        // The stale save would switch the only active entry off, and with it the participant's flag.
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<ConflictObjectResult>((await c.Update(practiceId, Form("Edited", loaded, active: false), CancellationToken.None)).Result); }

        var (check, _c) = Request(tenantId);
        await using (check)
        {
            Assert.True((await check.Participants.SingleAsync()).HasRestrictivePracticeFlag);
            Assert.True((await check.RestrictivePractices.SingleAsync()).IsActive);
        }
    }

    [SkippableFact]
    public async Task The_version_survives_a_json_round_trip()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, practiceId, participantId) = await SeedAsync();
        DateTime loaded;
        { var (db, c) = Request(tenantId); await using var _ = db; loaded = await LoadedAsync(c, participantId); }

        // The form body as the browser sends it: the version is a string, bound back to a DateTime.
        var body = ToBody("Via JSON", loaded);
        Assert.Equal(DateTimeKind.Utc, body.ExpectedUpdatedAt!.Value.Kind);
        Assert.Equal(loaded, body.ExpectedUpdatedAt);

        var (db2, c2) = Request(tenantId);
        await using (db2)
            Assert.IsType<OkObjectResult>((await c2.Update(practiceId, body, CancellationToken.None)).Result);
    }

    [SkippableFact]
    public async Task A_stale_version_sent_over_the_wire_is_a_409()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, practiceId, participantId) = await SeedAsync();
        DateTime loaded;
        { var (db, c) = Request(tenantId); await using var _ = db; loaded = await LoadedAsync(c, participantId); }
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Update(practiceId, Form("Newer", loaded), CancellationToken.None)).Result); }

        var (db2, c2) = Request(tenantId);
        await using (db2)
            Assert.IsType<ConflictObjectResult>((await c2.Update(practiceId, ToBody("Stale", loaded), CancellationToken.None)).Result);
    }

    private static UpdateRestrictivePracticeDto ToBody(string description, DateTime expected) =>
        JsonSerializer.Deserialize<UpdateRestrictivePracticeDto>(
            JsonSerializer.Serialize(new { description, isActive = true, expectedUpdatedAt = expected }, Wire), Wire)!;
}
