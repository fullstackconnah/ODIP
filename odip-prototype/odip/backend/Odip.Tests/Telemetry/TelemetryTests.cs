using System.Collections;
using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Api.Middleware;
using Odip.Api.Telemetry;
using OpenTelemetry;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using Xunit;

namespace Odip.Tests.Telemetry;

// A small host with the real middleware and AddOdipTelemetry, like RequestTimingMiddlewareTests: Program itself needs a
// database and a Firebase account, and the telemetry wiring does not.
public class TelemetryTests
{
    private const string Pii = "jane@example.com";

    private sealed record Rec(string? Category, string? Body, string? Formatted, Exception? Exception, Dictionary<string, string> Attrs, string Scopes = "")
    {
        public string All => string.Join("|", Attrs.Select(a => a.Key + "=" + a.Value).Append(Body).Append(Formatted));
    }

    private sealed record Point(Dictionary<string, string> Tags, double Sum);

    private sealed class Host(WebApplication app, List<Metric> metrics, List<LogRecord> logRecords) : IAsyncDisposable
    {
        public WebApplication App => app;
        public HttpClient Client { get; } = new() { BaseAddress = new Uri(app.Urls.Single()) };

        // LogRecords are pooled, so copy what the assertions read.
        public List<Rec> Logs()
        {
            lock (logRecords)
                return logRecords.Select(r => new Rec(r.CategoryName, r.Body, r.FormattedMessage, r.Exception,
                    (r.Attributes ?? []).ToDictionary(a => a.Key, a => a.Value?.ToString() ?? ""), Scopes(r))).ToList();
        }

        private static string Scopes(LogRecord r)
        {
            var sb = new StringBuilder();
            r.ForEachScope((s, b) => { foreach (var a in s) b.Append(a.Key).Append('=').Append(a.Value).Append('|'); }, sb);
            return sb.ToString();
        }

        public List<Point> Points(string name)
        {
            app.Services.GetRequiredService<MeterProvider>().ForceFlush();
            var points = new List<Point>();
            var last = metrics.LastOrDefault(m => m.Name == name);
            if (last == null) return points;
            foreach (var p in last.GetMetricPoints())
            {
                var tags = new Dictionary<string, string>();
                foreach (var t in p.Tags) tags[t.Key] = t.Value?.ToString() ?? "";
                var sum = last.MetricType switch
                {
                    MetricType.LongSum => p.GetSumLong(),
                    MetricType.Histogram => p.GetHistogramCount(),
                    _ => 0
                };
                points.Add(new Point(tags, sum));
            }
            return points;
        }

        public async ValueTask DisposeAsync() { Client.Dispose(); await app.DisposeAsync(); }
    }

    private static async Task<Host> StartAsync(string? endpoint = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"] = endpoint ?? "";
        builder.AddOdipTelemetry();
        var metrics = new List<Metric>();
        var logRecords = new List<LogRecord>();
        builder.Services.ConfigureOpenTelemetryMeterProvider(m => m.AddInMemoryExporter(metrics));
        builder.Services.ConfigureOpenTelemetryLoggerProvider(l => l.AddInMemoryExporter(logRecords));

        var app = builder.Build();
        app.UseMiddleware<ExceptionHandlingMiddleware>();
        app.MapGet("/api/v1/clients/{id:guid}", () => Results.Unauthorized());
        app.MapGet("/api/v1/info", (ILoggerFactory f) => { f.CreateLogger("Odip.Test").LogInformation("hello {Email}", Pii); return "ok"; });
        app.MapPost("/api/v1/boom/{id:int}", () => { throw new Exception(Pii + " row (42)", new InvalidOperationException("inner " + Pii)); });
        app.MapGet("/api/v1/job", (ILoggerFactory f) => { f.CreateLogger("Odip.Jobs.Thing").LogError("Job failed for {Route} {Email}", "x/123", Pii); return "ok"; });
        app.MapGet("/api/v1/scoped", (ILoggerFactory f) =>
        {
            var log = f.CreateLogger("Odip.Jobs.Scoped");
            using (log.BeginScope(new Dictionary<string, object> { ["Email"] = Pii }))
                log.LogError(new Exception("failed for " + Pii), "Scoped failure {Email}", Pii);
            return "ok";
        });
        app.MapGet("/api/health/live", () => "ok");
        await app.StartAsync();
        return new Host(app, metrics, logRecords);
    }

    private static async Task<Host> StartWithBoomAsync()
    {
        var host = await StartAsync();
        using var body = new StringContent("{\"name\":\"Jane Citizen\"}", Encoding.UTF8, "application/json");
        var res = await host.Client.PostAsync("/api/v1/boom/42?email=" + Pii, body);
        Assert.Equal(System.Net.HttpStatusCode.InternalServerError, res.StatusCode);
        return host;
    }

    private static Rec Boom(Host host) =>
        Assert.Single(host.Logs(), r => r.Category == typeof(ExceptionHandlingMiddleware).FullName);

    [Fact]
    public async Task Request_records_route_template_not_raw_path()
    {
        await using var host = await StartAsync();
        var id = Guid.NewGuid();
        await host.Client.GetAsync($"/api/v1/clients/{id}?email={Pii}");

        var points = host.Points("http.server.request.duration");
        Assert.Contains(points, p => p.Tags.GetValueOrDefault("http.route") == "/api/v1/clients/{id:guid}");
        foreach (var t in points.SelectMany(p => p.Tags))
        {
            Assert.DoesNotContain(id.ToString(), t.Key + t.Value);
            Assert.DoesNotContain("jane", t.Key + t.Value);
            Assert.DoesNotContain("?", t.Key + t.Value);
        }
    }

    [Fact]
    public async Task Unmatched_path_has_no_route_label()
    {
        await using var host = await StartAsync();
        var id = Guid.NewGuid();
        await host.Client.GetAsync($"/api/v1/nope/{id}");

        var points = host.Points("http.server.request.duration");
        Assert.NotEmpty(points);
        Assert.All(points, p => Assert.True(string.IsNullOrEmpty(p.Tags.GetValueOrDefault("http.route"))));
        Assert.DoesNotContain(points.SelectMany(p => p.Tags), t => (t.Key + t.Value).Contains(id.ToString()));
    }

    [Fact]
    public async Task Exception_record_is_scrubbed()
    {
        await using var host = await StartWithBoomAsync();
        var rec = Boom(host);

        Assert.Equal("System.Exception,System.InvalidOperationException", rec.Attrs["exception.type"]);
        Assert.False(string.IsNullOrWhiteSpace(rec.Attrs["exception.stacktrace"]));
        Assert.Equal("/api/v1/boom/{id:int}", rec.Attrs["Route"]);
        Assert.Equal("500", rec.Attrs["Status"]);
        Assert.Equal("POST", rec.Attrs["Method"]);
        Assert.Null(rec.Exception);
        Assert.Null(rec.Formatted);
        Assert.Equal("An unhandled exception occurred on {Method} {Route} ({Status}).", rec.Body);
        var visible = string.Join("|", rec.Attrs.Where(a => a.Key != "exception.stacktrace").Select(a => a.Key + "=" + a.Value)) + rec.Body;
        foreach (var bad in new[] { "jane", "Jane", "example.com", "42", "Citizen", "?", "RequestPath" })
            Assert.DoesNotContain(bad, visible);
    }

    [Fact]
    public async Task Exported_stacktrace_holds_no_exception_message()
    {
        await using var host = await StartWithBoomAsync();
        var stack = Boom(host).Attrs["exception.stacktrace"];

        foreach (var bad in new[] { Pii + " row (42)", "inner " + Pii, "example.com" })
            Assert.DoesNotContain(bad, stack);
    }

    [Fact]
    public async Task Other_categories_export_no_template_values()
    {
        await using var host = await StartAsync();
        await host.Client.GetAsync("/api/v1/job");

        var rec = Assert.Single(host.Logs(), r => r.Category == "Odip.Jobs.Thing");
        Assert.Equal("Job failed for {Route} {Email}", rec.Body);
        Assert.DoesNotContain("Route", rec.Attrs.Keys);
        Assert.DoesNotContain("Email", rec.Attrs.Keys);
        Assert.DoesNotContain("123", rec.All);
        Assert.DoesNotContain("jane", rec.All);
    }

    [Fact]
    public async Task Scope_data_and_exception_text_from_other_categories_are_not_exported()
    {
        await using var host = await StartAsync();
        await host.Client.GetAsync("/api/v1/scoped");

        var rec = Assert.Single(host.Logs(), r => r.Category == "Odip.Jobs.Scoped");
        Assert.DoesNotContain("jane", rec.All + rec.Scopes + rec.Exception);
        Assert.DoesNotContain("example.com", rec.All + rec.Scopes + rec.Exception);
        Assert.Equal("", rec.Scopes);
        Assert.Null(rec.Exception);
    }

    [Fact]
    public async Task Health_publisher_runs_only_when_export_is_on()
    {
        await using (var off = await StartAsync())
            Assert.Empty(off.App.Services.GetServices<IHealthCheckPublisher>());
        await using (var on = await StartAsync("http://127.0.0.1:4317"))
            Assert.Single(on.App.Services.GetServices<IHealthCheckPublisher>());
    }

    [Fact]
    public async Task Errors_counter_counts_by_category()
    {
        await using var host = await StartWithBoomAsync();
        var points = host.Points("odip.errors");

        var p = Assert.Single(points, p => p.Tags.GetValueOrDefault("category") == typeof(ExceptionHandlingMiddleware).FullName);
        Assert.Equal(1, p.Sum);
        Assert.Equal(["category"], p.Tags.Keys);
    }

    [Fact]
    public async Task Information_logs_are_not_exported()
    {
        await using var host = await StartAsync();
        await host.Client.GetAsync("/api/v1/info");

        Assert.Empty(host.Logs());
    }

    [Fact]
    public async Task Runtime_memory_metric_present()
    {
        await using var host = await StartAsync();
        Assert.NotEmpty(host.Points("dotnet.process.memory.working_set"));
    }

    [Theory]
    [InlineData(HealthStatus.Unhealthy, 0)]
    [InlineData(HealthStatus.Degraded, 0)]
    [InlineData(HealthStatus.Healthy, 1)]
    public async Task Health_gauge_follows_database_check(HealthStatus status, int expected)
    {
        var report = new HealthReport(new Dictionary<string, HealthReportEntry>(), status, TimeSpan.Zero);
        await new HealthStatusPublisher().PublishAsync(report, CancellationToken.None);

        var metrics = new List<Metric>();
        using var provider = Sdk.CreateMeterProviderBuilder().AddMeter(OdipMetrics.MeterName).AddInMemoryExporter(metrics).Build()!;
        provider.ForceFlush();
        var gauge = metrics.Single(m => m.Name == "odip.health.status");
        foreach (var p in gauge.GetMetricPoints()) Assert.Equal(expected, p.GetGaugeLastValueLong());
    }

    [Fact]
    public async Task No_telemetry_endpoint_is_mapped()
    {
        await using var host = await StartAsync();
        var routes = host.App.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Select(e => e.RoutePattern.RawText ?? "");
        Assert.DoesNotContain(routes, r => r.Contains("metrics", StringComparison.OrdinalIgnoreCase) || r.Contains("otlp", StringComparison.OrdinalIgnoreCase));
        foreach (var path in new[] { "/metrics", "/api/metrics" })
            Assert.NotEqual(System.Net.HttpStatusCode.OK, (await host.Client.GetAsync(path)).StatusCode);
    }

    [Fact]
    public async Task Collector_down_does_not_break_requests()
    {
        await using var host = await StartAsync("http://127.0.0.1:1");
        for (var i = 0; i < 20; i++)
            Assert.Equal(System.Net.HttpStatusCode.OK, (await host.Client.GetAsync("/api/health/live")).StatusCode);
        host.App.Services.GetRequiredService<MeterProvider>().ForceFlush(1000);
        Assert.Equal(System.Net.HttpStatusCode.OK, (await host.Client.GetAsync("/api/health/live")).StatusCode);
    }

    // Walks the providers' object graphs for any OTLP type, so the test needs no internal API. The last case proves the walk can find one.
    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("http://127.0.0.1:1", true)]
    public async Task Otlp_exporter_registered_only_with_an_endpoint(string? endpoint, bool expected)
    {
        await using var host = await StartAsync(endpoint);
        var found = OtlpTypes(host.App.Services.GetRequiredService<MeterProvider>()).Count
                    + OtlpTypes(host.App.Services.GetRequiredService<LoggerProvider>()).Count;
        Assert.Equal(expected, found > 0);
    }

    private static HashSet<string> OtlpTypes(object root)
    {
        var seen = new HashSet<object>(ReferenceEqualityComparer.Instance);
        var found = new HashSet<string>();
        void Walk(object? o, int depth)
        {
            if (o == null || depth > 7 || o is string || o.GetType().IsPrimitive || o.GetType().IsEnum || !seen.Add(o)) return;
            var type = o.GetType();
            if (type.FullName?.Contains("Otlp", StringComparison.OrdinalIgnoreCase) == true) found.Add(type.FullName);
            if (type.Namespace?.StartsWith("OpenTelemetry") != true && depth > 0) return;
            if (o is IEnumerable e && o is not IDictionary) foreach (var x in e) Walk(x, depth + 1);
            foreach (var f in type.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
                if (!f.FieldType.IsPointer) Walk(f.GetValue(o), depth + 1);
        }
        Walk(root, 0);
        return found;
    }
}
