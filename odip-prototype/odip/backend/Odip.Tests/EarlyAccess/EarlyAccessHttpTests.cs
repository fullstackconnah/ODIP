using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Odip.Api.RateLimiting;
using Odip.Application.Interfaces;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.EarlyAccess;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// The wire-level contract of POST /api/public/early-access, against a REAL Kestrel host on a loopback port:
/// the same ExceptionHandlingMiddleware -> rate limiter -> controllers order and the same limiter code
/// (<see cref="EarlyAccessRateLimiting"/>, <see cref="RateLimitRejection"/>) Program.cs uses. WebApplicationFactory
/// is not an option here (Program.cs needs Postgres, Firebase and a JWT secret to start, and the test project has
/// no Mvc.Testing reference), so this hosts just the one controller. Client IPs are simulated with an
/// X-Test-Client header because every loopback request shares one real address.
/// </summary>
public class EarlyAccessHttpTests
{
    private const string ValidJson = "{\"name\":\"Jane Citizen\",\"organisation\":\"Sample Support Co\",\"email\":\"jane@example.com\",\"website\":\"\"}";

    // ── Success ────────────────────────────────────────────────

    [Fact]
    public async Task ValidRequest_Returns202_WithStatusReceived_AndStoresTheRow()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(ValidJson);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.StartsWith("application/json", response.Content.Headers.ContentType!.MediaType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("received", json.RootElement.GetProperty("status").GetString());
        Assert.Single(json.RootElement.EnumerateObject()); // nothing else in the body
        Assert.Equal(1, await host.CountRowsAsync());
    }

    [Fact]
    public async Task Duplicate_Returns_TheSame202Body_AndOneRowWithCountTwo()
    {
        await using var host = await TestHost.StartAsync();

        var first = await host.PostAsync(ValidJson);
        var second = await host.PostAsync(ValidJson.Replace("jane@example.com", "JANE@example.COM"));

        Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);
        Assert.Equal(await first.Content.ReadAsStringAsync(), await second.Content.ReadAsStringAsync());
        Assert.Equal(1, await host.CountRowsAsync());
        Assert.Equal(2, await host.RequestCountAsync("jane@example.com"));
    }

    [Fact]
    public async Task FilledHoneypot_Returns202_AndStoresNothing()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(ValidJson.Replace("\"website\":\"\"", "\"website\":\"http://spam.example\""));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(0, await host.CountRowsAsync());
    }

    [Fact]
    public async Task UnknownProperties_AreIgnored()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(ValidJson.TrimEnd('}') + ",\"extra\":\"ignored\"}");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task PropertyNames_AreCaseInsensitive()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync("{\"Name\":\"Jane\",\"ORGANISATION\":\"Org\",\"Email\":\"j@example.com\"}");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    // ── 400 ────────────────────────────────────────────────────

    [Fact]
    public async Task InvalidFields_Return400_ProblemJson_WithCamelCaseFieldKeys()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync("{\"name\":\"\",\"organisation\":\"\",\"email\":\"nope\",\"website\":\"\"}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType!.MediaType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(400, json.RootElement.GetProperty("status").GetInt32());
        var errors = json.RootElement.GetProperty("errors");
        Assert.Equal(new[] { "email", "name", "organisation" },
            errors.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
        Assert.All(errors.EnumerateObject(), p => Assert.NotEmpty(p.Value.EnumerateArray()));
        Assert.Equal(0, await host.CountRowsAsync());
    }

    [Fact]
    public async Task MissingProperties_AreNamedToo()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync("{\"organisation\":\"Org\"}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(new[] { "email", "name" },
            json.RootElement.GetProperty("errors").EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public async Task EmptyBody_Returns400_NotA500()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(string.Empty);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(3, json.RootElement.GetProperty("errors").EnumerateObject().Count());
    }

    [Theory]
    [InlineData("{\"name\": ")]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    [InlineData("{\"name\":123,\"organisation\":\"o\",\"email\":\"a@b.co\"}")]
    public async Task MalformedOrMistypedJson_Returns400_NotA500(string body)
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await host.CountRowsAsync());
    }

    // ── Media type, method, size ───────────────────────────────

    [Theory]
    [InlineData("text/plain")]
    [InlineData("application/x-www-form-urlencoded")]
    public async Task NonJsonContentType_Returns415(string contentType)
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync("name=Jane", contentType);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
        Assert.Equal(0, await host.CountRowsAsync());
    }

    [Fact]
    public async Task Get_Returns405()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.Client.GetAsync("/api/public/early-access");

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }

    [Fact]
    public async Task Body_AtExactly4096Bytes_IsAccepted_And4097_Returns413()
    {
        await using var host = await TestHost.StartAsync();

        var atLimit = await host.PostAsync(JsonOfExactly(4096));
        var overLimit = await host.PostAsync(JsonOfExactly(4097), client: "second");

        Assert.Equal(HttpStatusCode.Accepted, atLimit.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, overLimit.StatusCode);
        Assert.Equal(1, await host.CountRowsAsync());
        // The shared ExceptionHandlingMiddleware body, without the framework's message.
        var body = await overLimit.Content.ReadAsStringAsync();
        Assert.DoesNotContain("max request body size", body, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("\"success\":false", body);
    }

    [Fact]
    public async Task ChunkedBody_Over4096Bytes_Returns413()
    {
        await using var host = await TestHost.StartAsync();
        var content = new StreamContent(new MemoryStream(Encoding.UTF8.GetBytes(JsonOfExactly(6000))));
        content.Headers.ContentType = new("application/json");
        // No Content-Length => chunked transfer: the limit must still bite while the body is being read.
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/public/early-access") { Content = content };
        request.Headers.TransferEncodingChunked = true;
        request.Headers.Add("X-Test-Client", "chunked");

        var response = await host.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal(0, await host.CountRowsAsync());
    }

    // ── 500 ────────────────────────────────────────────────────

    [Fact]
    public async Task UnexpectedFailure_Returns500_WithTheGenericBody_AndNoExceptionDetail()
    {
        // An InvalidOperationException from the store: ExceptionHandlingMiddleware alone would answer 400 for it.
        await using var host = await TestHost.StartAsync(failSaves: new InvalidOperationException("kaboom"));

        var response = await host.PostAsync(ValidJson);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("An unexpected error occurred", body);
        Assert.DoesNotContain("kaboom", body);
        Assert.DoesNotContain("ThrowingNotifier", body);
    }

    // ── 429 ────────────────────────────────────────────────────

    [Fact]
    public async Task SixthRequestFromOneClient_Returns429_WithRetryAfter_AndOtherClientsAreUnaffected()
    {
        await using var host = await TestHost.StartAsync();

        for (var i = 1; i <= 5; i++)
            Assert.Equal(HttpStatusCode.Accepted, (await host.PostAsync(ValidJson.Replace("jane@", $"jane{i}@"), client: "A")).StatusCode);

        var limited = await host.PostAsync(ValidJson.Replace("jane@", "jane6@"), client: "A");

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        var retryAfter = Assert.Single(limited.Headers.GetValues("Retry-After"));
        var seconds = int.Parse(retryAfter, System.Globalization.CultureInfo.InvariantCulture);
        Assert.InRange(seconds, 1, 600);
        Assert.Equal(5, await host.CountRowsAsync()); // the limited request stored nothing

        var other = await host.PostAsync(ValidJson.Replace("jane@", "someoneelse@"), client: "B");
        Assert.Equal(HttpStatusCode.Accepted, other.StatusCode);
    }

    [Fact]
    public async Task RejectedRequests_KeepBeingRejected_OnceOverTheLimit()
    {
        await using var host = await TestHost.StartAsync();
        for (var i = 0; i < 5; i++)
            await host.PostAsync(ValidJson, client: "A");

        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.TooManyRequests, (await host.PostAsync(ValidJson, client: "A")).StatusCode);
    }

    [Fact]
    public async Task ClientRejections_DoNotSpendTheGlobalCap_ButTheGlobalCapStillStopsEveryone()
    {
        // per client 2, global 3: A spends 2 of the 3 and is then rejected three times (per-client tier, first in the
        // chain, so those rejections must not touch the global budget); B takes the third global permit; C finds it gone.
        var limits = new EarlyAccessRateLimits(2, TimeSpan.FromMinutes(10), 3, TimeSpan.FromMinutes(10));
        await using var host = await TestHost.StartAsync(limits: limits);

        var a = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
            a.Add((await host.PostAsync(ValidJson.Replace("jane@", $"a{i}@"), client: "A")).StatusCode);
        var b = await host.PostAsync(ValidJson.Replace("jane@", "b@"), client: "B");
        var c = await host.PostAsync(ValidJson.Replace("jane@", "c@"), client: "C");
        var d = await host.PostAsync(ValidJson.Replace("jane@", "d@"), client: "D");

        Assert.Equal(new[]
        {
            HttpStatusCode.Accepted, HttpStatusCode.Accepted,
            HttpStatusCode.TooManyRequests, HttpStatusCode.TooManyRequests, HttpStatusCode.TooManyRequests,
        }, a);
        Assert.Equal(HttpStatusCode.Accepted, b.StatusCode);   // would be 429 if A's rejected requests had spent global permits
        Assert.Equal(HttpStatusCode.TooManyRequests, c.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, d.StatusCode);
        Assert.True(c.Headers.Contains("Retry-After"));
        Assert.Equal(3, await host.CountRowsAsync());
    }

    [Fact]
    public async Task PathSpellings_ShareTheSameBudget()
    {
        await using var host = await TestHost.StartAsync();

        // Trailing slash and different letter case route to the same action, so they must count against the same client.
        var paths = new[]
        {
            "/api/public/early-access", "/api/public/early-access/", "/API/Public/Early-Access",
            "/api/public/early-access/", "/api/public/early-access",
        };
        foreach (var path in paths)
            Assert.Equal(HttpStatusCode.Accepted, (await host.PostAsync(ValidJson, client: "A", path: path)).StatusCode);

        Assert.Equal(HttpStatusCode.TooManyRequests, (await host.PostAsync(ValidJson, client: "A")).StatusCode);
    }

    [Fact]
    public async Task OtherEndpoints_AreNotRateLimitedByIt()
    {
        await using var host = await TestHost.StartAsync();
        for (var i = 0; i < 12; i++)
            await host.PostAsync(ValidJson, client: "A"); // well past the early-access limit for client A

        for (var i = 0; i < 30; i++)
        {
            var response = await host.Client.GetAsync("/api/not-limited");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    [Fact]
    public async Task RequestsThatNeverReachTheAction_DoNotSpendTheBudget()
    {
        await using var host = await TestHost.StartAsync();
        for (var i = 0; i < 10; i++)
            Assert.Equal(HttpStatusCode.MethodNotAllowed, (await host.Client.GetAsync("/api/public/early-access")).StatusCode);

        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Accepted, (await host.PostAsync(ValidJson, client: "A")).StatusCode);
    }

    // ── Helpers ────────────────────────────────────────────────

    /// <summary>A valid JSON body of exactly <paramref name="totalBytes"/> bytes (ASCII), padded with an ignored property.</summary>
    private static string JsonOfExactly(int totalBytes)
    {
        const string prefix = "{\"name\":\"Jane\",\"organisation\":\"Org\",\"email\":\"j@example.com\",\"pad\":\"";
        const string suffix = "\"}";
        var json = prefix + new string('x', totalBytes - prefix.Length - suffix.Length) + suffix;
        Assert.Equal(totalBytes, Encoding.UTF8.GetByteCount(json));
        return json;
    }

    private sealed class ThrowOnSave : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
    {
        private readonly Exception _exception;

        public ThrowOnSave(Exception exception) => _exception = exception;

        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
            Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result,
            CancellationToken cancellationToken = default) => throw _exception;
    }

    private sealed class NoopNotifier : IEarlyAccessNotifier
    {
        public void NotifyNewRequest(EarlyAccessNotification notification) { }
    }

    private sealed class AnonymousTenant : ICurrentTenant
    {
        public Guid? TenantId => null;
        public bool IsSuperAdmin => false;
        public Guid? ViewAsUserId => null;
    }

    /// <summary>Exposes just the early-access controller to MVC, so unrelated controllers' dependencies are never needed.</summary>
    private sealed class OnlyEarlyAccessController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyEarlyAccessController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(EarlyAccessController).GetTypeInfo() };
    }

    private sealed class TestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly string _databaseName;

        private TestHost(WebApplication app, string databaseName, HttpClient client)
        {
            _app = app;
            _databaseName = databaseName;
            Client = client;
        }

        public HttpClient Client { get; }

        public static async Task<TestHost> StartAsync(
            EarlyAccessRateLimits? limits = null, IEarlyAccessNotifier? notifier = null, Exception? failSaves = null)
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();

            builder.Services.AddDbContext<OdipDbContext>(o =>
            {
                o.UseInMemoryDatabase(databaseName);
                if (failSaves is not null)
                    o.AddInterceptors(new ThrowOnSave(failSaves));
            });
            builder.Services.AddScoped<ICurrentTenant, AnonymousTenant>();
            builder.Services.AddScoped<EarlyAccessService>();
            builder.Services.AddSingleton<IEarlyAccessNotifier>(notifier ?? new NoopNotifier());
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m =>
                {
                    m.ApplicationParts.Clear();
                    m.ApplicationParts.Add(new OnlyEarlyAccessController());
                })
                .AddJsonOptions(o =>
                {
                    // Same as Program.cs.
                    o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
                    o.JsonSerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
                });
            builder.Services.AddRateLimiter(o =>
            {
                o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                o.GlobalLimiter = EarlyAccessRateLimiting.CreateLimiter(
                    context => context.Request.Headers["X-Test-Client"].FirstOrDefault() ?? "default-client",
                    limits ?? EarlyAccessRateLimits.Default);
                o.OnRejected = RateLimitRejection.WriteAsync;
            });

            var app = builder.Build();
            // Same order as Program.cs: exception handling, then the rate limiter, then the endpoints.
            app.UseMiddleware<ExceptionHandlingMiddleware>();
            app.UseRateLimiter();
            app.MapControllers();
            app.MapGet("/api/not-limited", () => "ok");
            await app.StartAsync();

            var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) };
            return new TestHost(app, databaseName, client);
        }

        public Task<HttpResponseMessage> PostAsync(
            string body, string contentType = "application/json", string client = "default-client",
            string path = "/api/public/early-access")
        {
            var request = new HttpRequestMessage(HttpMethod.Post, path)
            {
                Content = new StringContent(body, Encoding.UTF8, contentType),
            };
            request.Headers.Add("X-Test-Client", client);
            return Client.SendAsync(request);
        }

        public async Task<int> CountRowsAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().EarlyAccessRequests.CountAsync();
        }

        public async Task<int> RequestCountAsync(string email)
        {
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            return (await db.EarlyAccessRequests.SingleAsync(e => e.Email == email)).RequestCount;
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
