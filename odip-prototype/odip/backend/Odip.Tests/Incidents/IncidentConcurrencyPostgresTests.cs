using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Odip.Api.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
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

    /// <summary>The same echo over a real pipeline: the PUT body carries the updatedAt text exactly as the GET returned it (no DateTime round trip in the test).</summary>
    [SkippableFact]
    public async Task PutIncident_EchoingTheGetUpdatedAtString_Returns200()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, userId, id, _) = await SeedAsync();
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddScoped(_ => Open(tenantId));
        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, AdminAuth>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddControllers()
            .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyIncidentsController()); })
            .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));
        await using var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) };
        var wire = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(wire);

        var get = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/incidents/{id}");
        get.Headers.Add("X-Test-User", userId.ToString());
        var got = await client.SendAsync(get, Ct);
        Assert.Equal(HttpStatusCode.OK, got.StatusCode);
        var updatedAt = JsonNode.Parse(await got.Content.ReadAsStringAsync(Ct))!["data"]!["updatedAt"]!.GetValue<string>();

        var body = JsonSerializer.SerializeToNode(Form(userId, "Edited over HTTP", default), wire)!;
        body["expectedUpdatedAt"] = updatedAt;
        var put = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/incidents/{id}") { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        put.Headers.Add("X-Test-User", userId.ToString());
        var saved = await client.SendAsync(put, Ct);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    }

    private sealed class OnlyIncidentsController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyIncidentsController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(IncidentsController).GetTypeInfo() };
    }

    /// <summary>Signs in an Admin whose id is the X-Test-User header.</summary>
    private sealed class AdminAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Request.Headers["X-Test-User"].FirstOrDefault() is not { } user) return Task.FromResult(AuthenticateResult.NoResult());
            var identity = new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin"), new Claim(ClaimTypes.NameIdentifier, user)], "Test");
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), "Test")));
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
        // Only the retry reloads the stale copy this context held; with no concurrency token the first save would just win and this would still say "Original".
        Assert.Equal("Edited", witnessDb.IncidentReports.Local.Single(i => i.Id == id).Title);
    }

    [SkippableFact]
    public async Task AWitnessAnswerThatLosesTheRetryToo_Is409_AndTheAnswerIsNotSaved()
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
        await using var other = Open(tenantId);
        await using var witnessDb = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(new BumpBeforeSecondSave(other, id)).Options, TenantMock(tenantId).Object);
        await witnessDb.IncidentReports.SingleAsync(i => i.Id == id, Ct);

        Assert.IsType<OkObjectResult>((await As(editor, userId).Update(id, Form(userId, "Edited", loaded, new CreateIncidentWitnessDto { Id = witnessId, WitnessUserId = staffId, WitnessName = "Priya Nair" }), Ct)).Result);
        var portal = new PortalController(witnessDb, TenantMock(tenantId).Object) { ControllerContext = Caller(staffId) };
        var result = await portal.ApproveIncidentWitnessRequest(witnessId, new PortalRespondIncidentWitnessRequestDto("I saw it."), Ct);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal("This incident changed while you were answering. Please send your answer again.", Assert.Single(Assert.IsType<ApiResponse<PortalWitnessRequestDto>>(conflict.Value).Errors!));
        await using var check = Open(tenantId);
        Assert.Equal(WitnessStatus.Pending, (await check.IncidentWitnesses.AsNoTracking().SingleAsync(w => w.Id == witnessId)).WitnessStatus);
    }

    /// <summary>Another editor saves between the witness answer's reload and its retry: the second save is the one that must lose.</summary>
    private sealed class BumpBeforeSecondSave(OdipDbContext other, Guid incidentId) : SaveChangesInterceptor
    {
        private int _saves;
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (++_saves == 2)
                await other.IncidentReports.Where(i => i.Id == incidentId).ExecuteUpdateAsync(u => u.SetProperty(i => i.UpdatedAt, DateTime.UtcNow.AddSeconds(30)), ct);
            return result;
        }
    }
}
