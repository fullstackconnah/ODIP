using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Odip.Api.Serialization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// GET and DELETE api/v1/admin/early-access (Settings › Alpha sign-ups) against a real Kestrel host with the API's auth order
/// and JSON options (the DataExportHttpTests host pattern). SuperAdmin only; the rows are not tenant-scoped. The concurrency-token
/// races on Delete need PostgreSQL and live in <see cref="EarlyAccessPostgresTests"/>.
/// </summary>
public class EarlyAccessAdminHttpTests
{
    private const string Path = "/api/v1/admin/early-access";

    private static EarlyAccessRequest Signup(string name, int createdDaysAgo, int lastSentDaysAgo, int count = 1, bool withAnswers = true) => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        Organisation = name + " Care",
        Email = $"{name.ToLowerInvariant()}@example.org",
        Role = withAnswers ? "Operations manager" : null,
        Phone = withAnswers ? "0491 570 156" : null,
        OrganisationSize = withAnswers ? "10-49" : null,
        Message = withAnswers ? "Please remove my details" : null,
        CreatedAtUtc = DateTime.UtcNow.AddDays(-createdDaysAgo),
        LastRequestedAtUtc = DateTime.UtcNow.AddDays(-lastSentDaysAgo),
        RequestCount = count,
    };

    [Fact]
    public async Task Anonymous_Gets401_OnListAndDelete()
    {
        await using var host = await Host.StartAsync();
        var row = Signup("Amara", 1, 1);
        await host.SeedAsync(row);

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.SendAsync(HttpMethod.Get, Path, role: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.SendAsync(HttpMethod.Delete, $"{Path}/{row.Id}", role: null)).StatusCode);
        Assert.Equal(1, await host.CountRowsAsync());
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task EveryOtherRole_Gets403_AndDeletesNothing(string role)
    {
        await using var host = await Host.StartAsync();
        var row = Signup("Amara", 1, 1);
        await host.SeedAsync(row);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.SendAsync(HttpMethod.Get, Path, role, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.SendAsync(HttpMethod.Delete, $"{Path}/{row.Id}", role, Guid.NewGuid())).StatusCode);
        Assert.Equal(1, await host.CountRowsAsync());
        Assert.Empty(await host.AuditRowsAsync());
    }

    [Fact]
    public async Task SuperAdmin_GetsEverySignup_NewestLastSentFirst_WithEveryField()
    {
        await using var host = await Host.StartAsync();
        var a = Signup("Amara", 30, 1, count: 2);
        var b = Signup("Bella", 5, 5);
        var c = Signup("Cody", 10, 10, withAnswers: false);
        await host.SeedAsync(c, a, b);

        var response = await host.SendAsync(HttpMethod.Get, Path, "SuperAdmin");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var data = json.RootElement.GetProperty("data");
        Assert.Equal(3, data.GetProperty("totalCount").GetInt32());
        var items = data.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(new[] { a.Id, b.Id, c.Id }, items.Select(i => i.GetProperty("id").GetGuid()));

        var first = items[0];
        Assert.Equal("10-49", first.GetProperty("organisationSize").GetString());
        Assert.Equal("Operations manager", first.GetProperty("role").GetString());
        Assert.Equal("0491 570 156", first.GetProperty("phone").GetString());
        Assert.Equal("Please remove my details", first.GetProperty("message").GetString());
        Assert.Equal(2, first.GetProperty("requestCount").GetInt32());
        Assert.EndsWith("Z", first.GetProperty("lastRequestedAtUtc").GetString());

        var last = items[2];
        foreach (var key in new[] { "organisationSize", "role", "phone", "message" })
            Assert.False(last.TryGetProperty(key, out _), $"{key} should be omitted when not given");
    }

    private static EarlyAccessLaterSubmission Later(EarlyAccessRequest parent, string message, int receivedDaysAgo) => new()
    {
        Id = Guid.NewGuid(),
        EarlyAccessRequestId = parent.Id,
        ReceivedAtUtc = DateTime.UtcNow.AddDays(-receivedDaysAgo),
        Name = parent.Name,
        Organisation = parent.Organisation,
        Phone = "0400 000 000",
        Message = message,
    };

    [Fact]
    public async Task SuperAdmin_GetsEachSignupsLaterSubmissions_NewestLast_AndNoneForOthers()
    {
        await using var host = await Host.StartAsync();
        var a = Signup("Amara", 30, 1, count: 3);
        var b = Signup("Bella", 5, 5);
        await host.SeedAsync(a, b);
        await host.SeedLaterAsync(Later(a, "second", 2), Later(a, "first", 9));

        var response = await host.SendAsync(HttpMethod.Get, Path, "SuperAdmin");

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var items = json.RootElement.GetProperty("data").GetProperty("items").EnumerateArray().ToList();
        var later = items[0].GetProperty("laterSubmissions").EnumerateArray().ToList();
        Assert.Equal(new[] { "first", "second" }, later.Select(l => l.GetProperty("message").GetString()));
        Assert.Equal("0400 000 000", later[0].GetProperty("phone").GetString());
        Assert.EndsWith("Z", later[0].GetProperty("receivedAtUtc").GetString());
        Assert.Equal(0, items[1].GetProperty("laterSubmissions").GetArrayLength());
    }

    [Fact]
    public async Task SuperAdmin_Delete_RemovesTheLaterSubmissionsWithTheSignup()
    {
        await using var host = await Host.StartAsync();
        var a = Signup("Amara", 30, 1, count: 3);
        var b = Signup("Bella", 5, 5, count: 2);
        await host.SeedAsync(a, b);
        await host.SeedLaterAsync(Later(a, "one", 2), Later(a, "two", 1), Later(b, "kept", 1));

        var response = await host.SendAsync(HttpMethod.Delete, $"{Path}/{a.Id}", "SuperAdmin");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new[] { "kept" }, await host.LaterMessagesAsync());
    }

    [Fact]
    public async Task SuperAdmin_ListIsPaged_AndClamped()
    {
        await using var host = await Host.StartAsync();
        await host.SeedAsync(Signup("Amara", 1, 1), Signup("Bella", 2, 2), Signup("Cody", 3, 3));

        using (var json = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"{Path}?page=2&pageSize=2", "SuperAdmin")).Content.ReadAsStringAsync()))
        {
            var data = json.RootElement.GetProperty("data");
            Assert.Single(data.GetProperty("items").EnumerateArray());
            Assert.Equal(3, data.GetProperty("totalCount").GetInt32());
            Assert.Equal(2, data.GetProperty("page").GetInt32());
            Assert.True(data.GetProperty("hasPrevious").GetBoolean());
        }

        using (var json = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"{Path}?pageSize=1000", "SuperAdmin")).Content.ReadAsStringAsync()))
            Assert.Equal(200, json.RootElement.GetProperty("data").GetProperty("pageSize").GetInt32());
    }

    [Fact]
    public async Task SuperAdmin_ViewingAnOrganisation_StillSeesEverySignup()
    {
        await using var host = await Host.StartAsync();
        await host.SeedAsync(Signup("Amara", 1, 1), Signup("Bella", 2, 2), Signup("Cody", 3, 3));

        var response = await host.SendAsync(HttpMethod.Get, Path, "SuperAdmin", tenantClaim: Guid.NewGuid(), viewAs: Guid.NewGuid());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(3, json.RootElement.GetProperty("data").GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task SuperAdmin_Delete_RemovesTheRow_AndWritesOneAuditRowWithNoPersonalData()
    {
        await using var host = await Host.StartAsync();
        var a = Signup("Amara", 30, 1, count: 2);
        var b = Signup("Bella", 5, 5);
        var c = Signup("Cody", 10, 10);
        await host.SeedAsync(a, b, c);

        var response = await host.SendAsync(HttpMethod.Delete, $"{Path}/{a.Id}", "SuperAdmin");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using (var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()))
            Assert.True(json.RootElement.GetProperty("data").GetBoolean());
        Assert.Equal(new[] { b.Id, c.Id }.OrderBy(i => i), (await host.RowIdsAsync()).OrderBy(i => i));

        var audit = Assert.Single(await host.AuditRowsAsync());
        Assert.Equal("EarlyAccessRequest", audit.EntityType);
        Assert.Equal(a.Id, audit.EntityId);
        Assert.Equal(AuditAction.Deleted, audit.Action);
        Assert.Equal(Host.CallerId, audit.ChangedById);
        Assert.Equal("Jordan Lee", audit.ChangedByName);
        Assert.Equal("[]", audit.Changes);
        foreach (var value in new[] { a.Name, a.Organisation, a.Email, a.Phone!, a.Role!, a.Message! })
        {
            Assert.DoesNotContain(value, audit.EntityType);
            Assert.DoesNotContain(value, audit.ChangedByName!);
            Assert.DoesNotContain(value, audit.Changes);
        }
    }

    [Fact]
    public async Task Delete_OfAnUnknownId_Returns404_AndWritesNoAuditRow()
    {
        await using var host = await Host.StartAsync();
        await host.SeedAsync(Signup("Amara", 1, 1));

        var response = await host.SendAsync(HttpMethod.Delete, $"{Path}/{Guid.NewGuid()}", "SuperAdmin");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(1, await host.CountRowsAsync());
        Assert.Empty(await host.AuditRowsAsync());
    }

    private sealed class OnlyAdminEarlyAccessController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyAdminEarlyAccessController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(AdminEarlyAccessController).GetTypeInfo() };
    }

    /// <summary>Signs every request in from headers: X-Test-Role (none means anonymous), and X-Test-Tenant as the tenant_id claim, if sent.</summary>
    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Request.Headers["X-Test-Role"].FirstOrDefault() is not { } role) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Host.CallerId.ToString()), new(ClaimTypes.Role, role), new("fullName", "Jordan Lee") };
            if (Request.Headers["X-Test-Tenant"].FirstOrDefault() is { } tenant) claims.Add(new Claim("tenant_id", tenant));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme)));
        }
    }

    private sealed class Host : IAsyncDisposable
    {
        public static readonly Guid CallerId = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
        private readonly WebApplication _app;

        private Host(WebApplication app, HttpClient client) { _app = app; Client = client; }

        public HttpClient Client { get; }

        public static async Task<Host> StartAsync()
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
            builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyAdminEarlyAccessController()); })
                .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

            var app = builder.Build();
            // Program.cs's order: exception handling, then authentication and authorisation, then the endpoints.
            app.UseMiddleware<ExceptionHandlingMiddleware>();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();
            return new Host(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) });
        }

        public Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? role, Guid? tenantClaim = null, Guid? viewAs = null)
        {
            var request = new HttpRequestMessage(method, path);
            if (role is not null) request.Headers.Add("X-Test-Role", role);
            if (tenantClaim is { } tenant) request.Headers.Add("X-Test-Tenant", tenant.ToString());
            if (viewAs is { } viewed) request.Headers.Add("X-View-As-Tenant", viewed.ToString());
            return Client.SendAsync(request);
        }

        public async Task SeedAsync(params EarlyAccessRequest[] rows)
        {
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            db.EarlyAccessRequests.AddRange(rows);
            await db.SaveChangesAsync();
        }

        public async Task SeedLaterAsync(params EarlyAccessLaterSubmission[] rows)
        {
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            db.EarlyAccessLaterSubmissions.AddRange(rows);
            await db.SaveChangesAsync();
        }

        public async Task<List<string?>> LaterMessagesAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().EarlyAccessLaterSubmissions.Select(l => l.Message).ToListAsync();
        }

        public async Task<int> CountRowsAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().EarlyAccessRequests.CountAsync();
        }

        public async Task<List<Guid>> RowIdsAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().EarlyAccessRequests.Select(e => e.Id).ToListAsync();
        }

        public async Task<List<AuditLog>> AuditRowsAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().AuditLogs.AsNoTracking().ToListAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
