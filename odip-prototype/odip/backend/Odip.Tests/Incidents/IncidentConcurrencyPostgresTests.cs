using System.Security.Claims;
using System.Text.Json;
using Odip.Api.Serialization;
using Microsoft.AspNetCore.Http;
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
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): two requests that both loaded an incident before either saved.
/// The ExpectedUpdatedAt check cannot see that gap (the second request's load already holds the old value), so only UpdatedAt as a concurrency token refuses the loser.
/// The loser is made by loading the incident into its context first, which is what a request whose read ran before the other's save looks like.
/// </summary>
public class IncidentConcurrencyPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private const string Refusal = "Someone else changed this incident after you opened it. Cancel, then edit it again to see their changes.";
    private readonly PostgresFixture _pg;
    public IncidentConcurrencyPostgresTests(PostgresFixture pg) => _pg = pg;

    private static Mock<ICurrentTenant> TenantMock(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant;
    }

    private OdipDbContext Open(Guid tenantId) => PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);

    private static ControllerContext Caller(Guid userId) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin"), new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test")),
        },
    };

    private static IncidentsController As(OdipDbContext db, Guid userId) => new(db) { ControllerContext = Caller(userId) };

    private async Task<(Guid TenantId, Guid UserId, Guid IncidentId, DateTime Loaded)> SeedAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var user = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Lee", Username = $"sam.{Guid.NewGuid():N}", Email = $"sam.{Guid.NewGuid():N}@example.test", Role = UserRole.Admin, IsActive = true };
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = user.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Medium,
            Status = IncidentStatus.Submitted, Title = "Original", Description = "What happened.", IncidentDateTime = DateTime.UtcNow.AddHours(-2),
            CreatedAt = DateTime.UtcNow.AddHours(-1), IsActive = true,
        };
        db.AddRange(user, incident);
        await db.SaveChangesAsync(Ct);
        return (tenantId, user.Id, incident.Id, (await db.IncidentReports.AsNoTracking().SingleAsync(i => i.Id == incident.Id)).UpdatedAt);
    }

    private static UpdateIncidentDto Form(Guid reporterId, string title, DateTime expected, params CreateIncidentWitnessDto[] witnesses) => new()
    {
        ReportedByStaffId = reporterId, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Medium, Title = title,
        Description = "What happened.", IncidentDateTime = new DateTime(2026, 8, 30, 10, 0, 0, DateTimeKind.Utc), Status = IncidentStatus.Submitted, ExpectedUpdatedAt = expected, Witnesses = witnesses.ToList(),
    };

    private static void AssertRefused<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.Equal(Refusal, Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsType<ConflictObjectResult>(result.Result).Value).Errors!));

    private static async Task<IncidentReport> ReadAsync(OdipDbContext db, Guid id) => await db.IncidentReports.AsNoTracking().SingleAsync(i => i.Id == id);

    [SkippableFact]
    public async Task TwoUpdatesThatBothLoadedFirst_TheSecondIs409_AndTheFirstTitleStays()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, userId, id, loaded) = await SeedAsync();
        await using var first = Open(tenantId);
        await using var second = Open(tenantId);
        await second.IncidentReports.SingleAsync(i => i.Id == id, Ct); // the second request's read, before the first one saves

        Assert.IsType<OkObjectResult>((await As(first, userId).Update(id, Form(userId, "From A", loaded), Ct)).Result);
        AssertRefused(await As(second, userId).Update(id, Form(userId, "From B", loaded), Ct));

        await using var check = Open(tenantId);
        Assert.Equal("From A", (await ReadAsync(check, id)).Title);
    }

    [SkippableFact]
    public async Task PutIncident_EchoingTheGetUpdatedAtString_Returns200_AndTheNextEchoOfTheResponseToo()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, userId, id, _) = await SeedAsync();
        var wire = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(wire);
        async Task<DateTime> Get()
        {
            await using var db = Open(tenantId);
            var ok = Assert.IsType<OkObjectResult>((await As(db, userId).GetById(id, Ct)).Result);
            var json = JsonSerializer.Serialize(Assert.IsType<ApiResponse<IncidentDetailDto>>(ok.Value).Data, wire);
            return JsonSerializer.Deserialize<IncidentDetailDto>(json, wire)!.UpdatedAt;
        }

        for (var edit = 1; edit <= 2; edit++)
        {
            var echoed = await Get();
            await using var db = Open(tenantId);
            Assert.IsType<OkObjectResult>((await As(db, userId).Update(id, Form(userId, $"Edit {edit}", echoed), Ct)).Result);
        }
    }

    [SkippableFact]
    public async Task AReviewThatLostTheRace_IsRefused_AndTheFirstReviewStays()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, userId, id, _) = await SeedAsync();
        await using var first = Open(tenantId);
        await using var second = Open(tenantId);
        await second.IncidentReports.SingleAsync(i => i.Id == id, Ct);

        Assert.IsType<OkObjectResult>((await As(first, userId).RecordReview(id, new RecordIncidentReviewDto { ReviewNotes = "From A", Status = IncidentStatus.UnderReview }, Ct)).Result);
        AssertRefused(await As(second, userId).RecordReview(id, new RecordIncidentReviewDto { ReviewNotes = "From B", Status = IncidentStatus.Resolved }, Ct));

        await using var check = Open(tenantId);
        var row = await ReadAsync(check, id);
        Assert.Equal(("From A", IncidentStatus.UnderReview), (row.ReviewNotes, row.Status));
    }

    [SkippableFact]
    public async Task AnArchiveThatLostTheRace_IsRefused_AndTheIncidentIsNotClosed()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, userId, id, _) = await SeedAsync();
        await using var first = Open(tenantId);
        await using var second = Open(tenantId);
        await second.IncidentReports.SingleAsync(i => i.Id == id, Ct);

        Assert.IsType<OkObjectResult>((await As(first, userId).RecordReview(id, new RecordIncidentReviewDto { ReviewNotes = "From A", Status = IncidentStatus.UnderReview }, Ct)).Result);
        var archive = await As(second, userId).Delete(id, Ct);

        Assert.Equal(Refusal, Assert.Single(Assert.IsType<ApiResponse<bool>>(Assert.IsType<ConflictObjectResult>(archive.Result).Value).Errors!));
        await using var check = Open(tenantId);
        Assert.Equal(IncidentStatus.UnderReview, (await ReadAsync(check, id)).Status);
    }

    [SkippableFact]
    public async Task AWitnessAnswerThatLostTheRace_IsRetriedOnTheNewVersion_AndSaves()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, userId, id, loaded) = await SeedAsync();
        var witnessId = Guid.NewGuid();
        var staffId = Guid.NewGuid();
        await using (var seed = Open(tenantId))
        {
            seed.Users.Add(new User { Id = staffId, TenantId = tenantId, FirstName = "Priya", LastName = "Nair", Username = $"priya.{Guid.NewGuid():N}", Email = $"priya.{Guid.NewGuid():N}@example.test", Role = UserRole.SupportWorker, IsActive = true });
            seed.IncidentWitnesses.Add(new IncidentWitness { Id = witnessId, IncidentReportId = id, WitnessUserId = staffId, WitnessName = "Priya Nair", WitnessStatus = WitnessStatus.Pending });
            await seed.SaveChangesAsync(Ct);
        }
        await using var editor = Open(tenantId);
        await using var witnessDb = Open(tenantId);
        await witnessDb.IncidentReports.SingleAsync(i => i.Id == id, Ct);

        Assert.IsType<OkObjectResult>((await As(editor, userId).Update(id, Form(userId, "Edited", loaded, new CreateIncidentWitnessDto { Id = witnessId, WitnessUserId = staffId, WitnessName = "Priya Nair" }), Ct)).Result);
        var portal = new PortalController(witnessDb, TenantMock(tenantId).Object) { ControllerContext = Caller(staffId) };
        Assert.IsType<OkObjectResult>((await portal.ApproveIncidentWitnessRequest(witnessId, new PortalRespondIncidentWitnessRequestDto("I saw it."), Ct)).Result);

        await using var check = Open(tenantId);
        Assert.Equal(WitnessStatus.Approved, (await check.IncidentWitnesses.AsNoTracking().SingleAsync(w => w.Id == witnessId)).WitnessStatus);
        Assert.Equal("Edited", (await ReadAsync(check, id)).Title);
    }
}
