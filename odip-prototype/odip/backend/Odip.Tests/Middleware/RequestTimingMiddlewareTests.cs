using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Middleware;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Middleware;

/// <summary>One Information line per /api/ request under "Odip.RequestTiming": route template, status, ms, DB commands; never the raw path or query.</summary>
public class RequestTimingMiddlewareTests : IClassFixture<PostgresFixture>
{
    private const string Category = "Odip.RequestTiming";

    private readonly PostgresFixture _pg;
    public RequestTimingMiddlewareTests(PostgresFixture pg) => _pg = pg;

    private sealed class Sink : ILoggerProvider
    {
        public List<(string Category, LogLevel Level, string Message)> Entries { get; } = new();
        public ILogger CreateLogger(string categoryName) => new L(this, categoryName);
        public void Dispose() { }

        private sealed class L(Sink sink, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                lock (sink.Entries) sink.Entries.Add((category, logLevel, formatter(state, exception)));
            }
        }
    }

    private static async Task<(Sink Sink, WebApplication App, HttpClient Client)> StartAsync(string? connectionString = null)
    {
        var sink = new Sink();
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(sink);
        builder.Services.AddSingleton(Mock.Of<ICurrentTenant>(t => t.IsSuperAdmin == true));
        builder.Services.AddRequestTiming();
        // Only the db= test needs a real server (EF opens the connection before it creates a command); the rest never query.
        builder.Services.AddDbContext<OdipDbContext>((sp, o) => o
            .UseNpgsql(connectionString ?? "Host=127.0.0.1;Port=1;Database=x;Timeout=1;Pooling=false")
            .AddInterceptors(sp.GetRequiredService<DbCommandCountInterceptor>()));

        var app = builder.Build();
        app.UseMiddleware<RequestTimingMiddleware>();
        app.MapGet("/api/v1/things/{id:guid}", (Guid id) => "ok");
        app.MapGet("/api/v1/query", async (OdipDbContext db) =>
        {
            await db.Tenants.CountAsync();
            return "ok";
        });
        app.MapGet("/api/health/live", () => "ok");
        await app.StartAsync();
        return (sink, app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()) });
    }

    private static string[] Lines(Sink sink)
    {
        lock (sink.Entries)
            return sink.Entries.Where(e => e.Category == Category).Select(e => $"{e.Level}|{e.Message}").ToArray();
    }

    [Fact]
    public async Task LogsOneInformationLine_WithTheRouteTemplate_NotTheRawPath()
    {
        var (sink, app, client) = await StartAsync();
        await using var _ = app;
        var id = Guid.NewGuid();

        await client.GetAsync($"/api/v1/things/{id}");

        var line = Assert.Single(Lines(sink));
        Assert.StartsWith("Information|GET /api/v1/things/{id:guid} 200 ", line);
        Assert.DoesNotContain(id.ToString(), line);
        Assert.EndsWith(" db=0", line);
    }

    [Fact]
    public async Task NeverLogsTheQueryString()
    {
        var (sink, app, client) = await StartAsync();
        await using var _ = app;

        await client.GetAsync($"/api/v1/things/{Guid.NewGuid()}?name=Jane%20Citizen&dob=1990-01-01");

        var line = Assert.Single(Lines(sink));
        Assert.DoesNotContain("Jane", line);
        Assert.DoesNotContain("dob", line);
        Assert.DoesNotContain("?", line);
    }

    [Fact]
    public void TheInterceptorBumpsTheRequestCounterOncePerCommand()
    {
        var counter = new RequestDbCommandCounter();
        var interceptor = new DbCommandCountInterceptor(counter);
        using var cmd = new Npgsql.NpgsqlCommand();

        interceptor.CommandCreated(null!, cmd);
        interceptor.CommandCreated(null!, cmd);

        Assert.Equal(2, counter.Count);
    }

    [SkippableFact]
    public async Task CountsTheDbCommandsOfARequestThatQueries()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (sink, app, client) = await StartAsync(_pg.ConnectionString);
        await using var _ = app;

        await client.GetAsync("/api/v1/query");

        var line = Assert.Single(Lines(sink));
        Assert.EndsWith(" db=1", line);
    }

    [Fact]
    public async Task HealthChecksAreNotLogged()
    {
        var (sink, app, client) = await StartAsync();
        await using var _ = app;

        await client.GetAsync("/api/health/live");

        Assert.Empty(Lines(sink));
    }

    [Fact]
    public async Task AnUnmatchedPathLogsAPlaceholder_NotTheRawPath()
    {
        var (sink, app, client) = await StartAsync();
        await using var _ = app;

        await client.GetAsync("/api/v1/nope/abc");

        var line = Assert.Single(Lines(sink));
        Assert.StartsWith("Information|GET (no route) 404 ", line);
        Assert.DoesNotContain("abc", line);
    }

    /// <summary>
    /// Program.cs has no host the tests can start, so the order is read from its source: the timing middleware only observes, so it sits
    /// outside everything it measures, and the rate limiter, auth and ReadOnlyMiddleware keep their places relative to each other.
    /// </summary>
    [Fact]
    public void ProgramCs_KeepsTheDocumentedOrder_WithTimingOutermostAfterSecurityHeaders()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.Api", "Program.cs"))) dir = Path.GetDirectoryName(dir);
        Assert.NotNull(dir);
        var src = File.ReadAllText(Path.Combine(dir!, "Odip.Api", "Program.cs"));

        string[] order =
        [
            "app.UseForwardedHeaders();",
            "// Security headers middleware",
            "app.UseMiddleware<Odip.Api.Middleware.RequestTimingMiddleware>();",
            "app.UseMiddleware<Odip.Api.Middleware.ExceptionHandlingMiddleware>();",
            "app.UseMiddleware<Odip.Api.Middleware.SignInBudgetPartitionWarningMiddleware>();",
            "app.UseRateLimiter();",
            "app.UseCors();",
            "app.UseAuthentication();",
            "app.UseAuthorization();",
            "app.UseMiddleware<Odip.Api.Middleware.ReadOnlyMiddleware>();",
            "app.MapControllers();",
        ];
        var at = order.Select(o => src.IndexOf(o, StringComparison.Ordinal)).ToArray();
        Assert.All(at, i => Assert.True(i >= 0));
        Assert.Equal(at.OrderBy(i => i), at);
    }
}
