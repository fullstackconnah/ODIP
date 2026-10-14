using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
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
using Odip.Infrastructure.DataExport;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.DataExport;

/// <summary>
/// GET /api/v1/data-export and /last on a REAL Kestrel host, as EarlyAccessHttpTests hosts its controller.
/// Only a real server:
/// - refuses synchronous writes;
/// - sends the 200 before the body;
/// - resets a connection that is aborted.
/// The caller's role and tenant claim come from test headers (X-Test-Role, X-Test-Tenant). The real CurrentTenant reads X-View-As-Tenant.
/// </summary>
public class DataExportHttpTests
{
    [Fact]
    public async Task An_admin_gets_the_whole_zip_under_the_organisations_name_and_one_audit_row_naming_them()
    {
        await using var host = await Host.StartAsync();
        var tenantId = await host.SeedAsync("Sunrise Care");

        using var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType!.MediaType);
        Assert.Matches("^odip-export-sunrise-care-[0-9]{4}-[0-9]{2}-[0-9]{2}[.]zip$", response.Content.Headers.ContentDisposition!.FileName!.Trim('"'));
        using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()), ZipArchiveMode.Read);
        Assert.Equal(DataExportWriter.ManifestName, zip.Entries[^1].FullName);
        Assert.Equal(2, DataExportTestKit.Csv(zip, "vehicles.csv").Count);
        var audit = Assert.Single(await host.ExportRowsAsync(tenantId));
        Assert.Equal(("Jordan Lee", (Guid?)Host.CallerId, "[]"), (audit.ChangedByName, audit.ChangedById, audit.Changes));
    }

    [Fact]
    public async Task The_first_bytes_reach_the_client_while_the_export_is_still_reading()
    {
        var clientHasBytes = new ManualResetEventSlim();
        var heldUntilTheClientHadBytes = false;
        await using var host = await Host.StartAsync(new OnMaterialize<Vehicle>(() => heldUntilTheClientHadBytes = clientHasBytes.Wait(TimeSpan.FromSeconds(20))));
        var tenantId = await host.SeedAsync("Sunrise Care");

        using var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId, completion: HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        Assert.Equal(1, await body.ReadAsync(new byte[1]));
        clientHasBytes.Set();
        await body.CopyToAsync(Stream.Null);

        Assert.True(heldUntilTheClientHadBytes,
            "The ZIP's first bytes reached the client only after the export had read every table: it is being buffered, not streamed.");
    }

    [Fact]
    public async Task A_failure_after_the_first_bytes_resets_the_connection_and_writes_no_audit_row()
    {
        await using var host = await Host.StartAsync(new OnMaterialize<Vehicle>(() => throw new InvalidOperationException("The disk went away")));
        var tenantId = await host.SeedAsync("Sunrise Care");

        using var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId, completion: HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); // the 200 had gone before the failure

        var error = await Record.ExceptionAsync(() => response.Content.ReadAsByteArrayAsync());
        Assert.True(error is HttpRequestException or IOException,
            $"The client must see a broken download, never a clean end of a truncated ZIP; it saw {error?.GetType().Name ?? "a clean end"}.");
        Assert.Empty(await host.ExportRowsAsync(tenantId));
    }

    [Fact]
    public async Task A_client_that_leaves_after_the_last_byte_still_gets_its_audit_row()
    {
        await using var host = await Host.StartAsync(new OnAuditSave(token =>
        {
            // The client leaves just as the row is saved. Kestrel cancels RequestAborted on the thread pool, so wait for it, then do what
            // Npgsql does with a cancelled token.
            var http = new HttpContextAccessor().HttpContext!;
            http.Abort();
            http.RequestAborted.WaitHandle.WaitOne(TimeSpan.FromSeconds(5));
            token.ThrowIfCancellationRequested();
        }));
        var tenantId = await host.SeedAsync("Sunrise Care");

        using var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId, completion: HttpCompletionOption.ResponseHeadersRead);
        await Record.ExceptionAsync(() => response.Content.ReadAsByteArrayAsync()); // the connection is gone, however the read ends

        Assert.Single(await host.ExportRowsEventuallyAsync(tenantId));
    }

    [Fact]
    public async Task An_audit_save_that_fails_after_a_complete_zip_is_logged_and_the_client_keeps_its_whole_zip()
    {
        await using var host = await Host.StartAsync(new OnAuditSave(_ => throw new InvalidOperationException("The audit table is locked")));
        var tenantId = await host.SeedAsync("Sunrise Care");

        using var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId);

        using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()), ZipArchiveMode.Read);
        Assert.Equal(DataExportWriter.ManifestName, zip.Entries[^1].FullName);
        Assert.Contains(host.Logs, l => l.Category == typeof(DataExportController).FullName && l.Level == LogLevel.Error && l.Message.Contains("audit row"));
        Assert.Empty(await host.ExportRowsAsync(tenantId));
    }

    [Theory]
    [InlineData("/api/v1/data-export")]
    [InlineData("/api/v1/data-export/last")]
    public async Task A_superadmin_with_no_organisation_chosen_gets_400_even_when_their_token_names_a_tenant(string path)
    {
        await using var host = await Host.StartAsync();
        var tenantId = await host.SeedAsync("Sunrise Care");

        foreach (var claim in new Guid?[] { null, tenantId })
        {
            using var response = await host.GetAsync(path, "SuperAdmin", tenantClaim: claim);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.Equal(DataExportController.NoOrganisation, json.RootElement.GetProperty("errors")[0].GetString());
        }
        Assert.Empty(await host.ExportRowsAsync(tenantId));
    }

    [Fact]
    public async Task A_superadmin_who_chose_an_organisation_gets_only_its_rows_whatever_tenant_their_token_names()
    {
        await using var host = await Host.StartAsync();
        var (own, other) = await host.PlantTwoAsync();

        // The choice (X-View-As-Tenant) decides; a tenant_id claim naming the other organisation never does.
        foreach (var claim in new Guid?[] { null, other.TenantId })
        {
            using var response = await host.GetAsync("/api/v1/data-export", "SuperAdmin", tenantClaim: claim, viewAs: own.TenantId);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()), ZipArchiveMode.Read);
            DataExportTestKit.AssertHoldsOnly(zip, own, other);
        }
        Assert.All(await host.ExportRowsAsync(own.TenantId), row => Assert.Equal(Host.CallerId, row.ChangedById)); // recorded as themselves
        Assert.Empty(await host.ExportRowsAsync(other.TenantId));
    }

    [Fact]
    public async Task An_admin_gets_only_their_own_organisation_even_when_they_send_a_view_as_header()
    {
        await using var host = await Host.StartAsync();
        var (own, other) = await host.PlantTwoAsync();

        foreach (var viewAs in new Guid?[] { null, other.TenantId })
        {
            using var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: own.TenantId, viewAs: viewAs);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()), ZipArchiveMode.Read);
            DataExportTestKit.AssertHoldsOnly(zip, own, other);
        }
        Assert.Empty(await host.ExportRowsAsync(other.TenantId));
    }

    [Fact]
    public async Task A_superadmin_viewing_an_organisation_that_does_not_exist_gets_404_and_no_audit_row()
    {
        await using var host = await Host.StartAsync();
        var missing = Guid.NewGuid(); // a stale or mistyped X-View-As-Tenant must never give a complete-looking empty ZIP

        using var response = await host.GetAsync("/api/v1/data-export", "SuperAdmin", tenantClaim: null, viewAs: missing);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty(await host.ExportRowsAsync(missing));
    }

    [Fact]
    public async Task An_admin_whose_token_names_no_organisation_gets_403_not_the_superadmin_choose_an_organisation_400()
    {
        await using var host = await Host.StartAsync();
        var tenantId = await host.SeedAsync("Sunrise Care");

        foreach (var path in new[] { "/api/v1/data-export", "/api/v1/data-export/last" })
        {
            using var response = await host.GetAsync(path, "Admin", tenantClaim: null, viewAs: tenantId); // the header is a SuperAdmin's only
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        Assert.Empty(await host.ExportRowsAsync(tenantId));
    }

    [Theory]
    [InlineData("Coordinator")]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task Every_other_role_gets_403(string role)
    {
        await using var host = await Host.StartAsync();
        var tenantId = await host.SeedAsync("Sunrise Care");

        foreach (var path in new[] { "/api/v1/data-export", "/api/v1/data-export/last" })
        {
            using var response = await host.GetAsync(path, role, tenantClaim: tenantId);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
    }

    [Fact]
    public async Task Last_has_no_data_before_any_export_then_names_the_newest_of_this_organisation_as_a_utc_instant()
    {
        await using var host = await Host.StartAsync();
        var tenantId = await host.SeedAsync("Sunrise Care");

        using (var before = await host.GetAsync("/api/v1/data-export/last", "Admin", tenantClaim: tenantId))
        {
            Assert.Equal(HttpStatusCode.OK, before.StatusCode);
            using var json = JsonDocument.Parse(await before.Content.ReadAsStringAsync());
            Assert.False(json.RootElement.TryGetProperty("data", out var data) && data.ValueKind != JsonValueKind.Null);
        }

        await host.AddExportRowAsync(tenantId, new DateTimeOffset(2026, 10, 13, 1, 0, 0, TimeSpan.Zero), "Older Admin");
        await host.AddExportRowAsync(tenantId, new DateTimeOffset(2026, 10, 14, 5, 4, 0, TimeSpan.Zero), "Jordan Lee");
        await host.AddExportRowAsync(Guid.NewGuid(), new DateTimeOffset(2026, 10, 15, 0, 0, 0, TimeSpan.Zero), "Another Organisation");

        using var after = await host.GetAsync("/api/v1/data-export/last", "Admin", tenantClaim: tenantId);
        using var body = JsonDocument.Parse(await after.Content.ReadAsStringAsync());
        var last = body.RootElement.GetProperty("data");
        Assert.Equal(("2026-10-14T05:04:00Z", "Jordan Lee"), (last.GetProperty("exportedAt").GetString(), last.GetProperty("exportedByName").GetString()));
    }

    [Theory]
    [InlineData("Sunrise Care", "sunrise-care")]
    [InlineData("O'Brien & Sons Care Pty Ltd", "o-brien-sons-care-pty-ltd")]
    [InlineData("Café Ōra", "caf-ra")]
    [InlineData("  ***  ", "organisation")]
    [InlineData("", "organisation")]
    public void Slug_keeps_letters_and_digits_and_never_comes_out_empty(string name, string slug) =>
        Assert.Equal(slug, DataExportController.Slug(name));

    /// <summary>Runs <paramref name="onEach"/> as each row of type T is read, to hold the export (or fail it) part-way.</summary>
    private sealed class OnMaterialize<T>(Action onEach) : IMaterializationInterceptor
    {
        public object InitializedInstance(MaterializationInterceptionData materializationData, object entity)
        {
            if (entity is T) onEach();
            return entity;
        }
    }

    /// <summary>Runs <paramref name="onSave"/> with the save's token as the export's audit row is saved; seeding saves pass straight through.</summary>
    private sealed class OnAuditSave(Action<CancellationToken> onSave) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<AuditLog>().Any(e => e.State == EntityState.Added)) onSave(cancellationToken);
            return ValueTask.FromResult(result);
        }
    }

    /// <summary>Every log entry the host writes, so a test can see what the controller logged.</summary>
    private sealed class CapturedLogs : ILoggerProvider
    {
        public ConcurrentQueue<(string Category, LogLevel Level, string Message)> Entries { get; } = new();
        public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);
        public void Dispose() { }

        private sealed class Logger(CapturedLogs logs, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                logs.Entries.Enqueue((category, logLevel, formatter(state, exception)));
        }
    }

    private sealed class OnlyDataExportController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyDataExportController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(DataExportController).GetTypeInfo() };
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

        private readonly CapturedLogs _logs;

        private Host(WebApplication app, HttpClient client, CapturedLogs logs) { _app = app; Client = client; _logs = logs; }

        public HttpClient Client { get; }

        public IReadOnlyCollection<(string Category, LogLevel Level, string Message)> Logs => _logs.Entries;

        public static async Task<Host> StartAsync(params IInterceptor[] interceptors)
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            var logs = new CapturedLogs();
            builder.Logging.AddProvider(logs);
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName).AddInterceptors(interceptors));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
            builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyDataExportController()); })
                .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

            var app = builder.Build();
            // Program.cs's order: exception handling, then authentication and authorisation, then the endpoints.
            app.UseMiddleware<ExceptionHandlingMiddleware>();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();
            return new Host(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) }, logs);
        }

        public Task<HttpResponseMessage> GetAsync(string path, string role, Guid? tenantClaim, Guid? viewAs = null,
            HttpCompletionOption completion = HttpCompletionOption.ResponseContentRead)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.Add("X-Test-Role", role);
            if (tenantClaim is { } tenant) request.Headers.Add("X-Test-Tenant", tenant.ToString());
            if (viewAs is { } viewed) request.Headers.Add("X-View-As-Tenant", viewed.ToString());
            return Client.SendAsync(request, completion);
        }

        /// <summary>An organisation with its Tenant row, one participant and one vehicle (the table the interceptors hold or fail).</summary>
        public async Task<Guid> SeedAsync(string organisation)
        {
            var tenantId = Guid.NewGuid();
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            db.Tenants.Add(new Tenant { Id = tenantId, Name = organisation, EmailDomain = $"{tenantId:N}.example.com" });
            db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sienna", LastName = "Patel", NdisNumber = "431000003" });
            db.Vehicles.Add(new Vehicle { Id = Guid.NewGuid(), TenantId = tenantId, VehicleName = "Van", TotalSeats = 8 });
            await db.SaveChangesAsync();
            return tenantId;
        }

        /// <summary>Two organisations side by side, each with a row in every table reached through a parent (DataExportTestKit.Plant).</summary>
        public async Task<(DataExportTestKit.Planted Own, DataExportTestKit.Planted Other)> PlantTwoAsync()
        {
            var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            db.Tenants.AddRange(new Tenant { Id = a, Name = "Alpha Care", EmailDomain = $"{a:N}.example.com" }, new Tenant { Id = b, Name = "Bravo Care", EmailDomain = $"{b:N}.example.com" });
            await db.SaveChangesAsync();
            var other = DataExportTestKit.Plant(db, b, "43100000001");
            var own = DataExportTestKit.Plant(db, a, "43100000002");
            return (own, other);
        }

        /// <summary>The export rows, waiting up to 10 s for one: the server finishes a request after the client has stopped reading.</summary>
        public async Task<List<AuditLog>> ExportRowsEventuallyAsync(Guid tenantId)
        {
            var until = DateTime.UtcNow.AddSeconds(10);
            List<AuditLog> rows;
            while ((rows = await ExportRowsAsync(tenantId)).Count == 0 && DateTime.UtcNow < until) await Task.Delay(100);
            return rows;
        }

        public async Task<List<AuditLog>> ExportRowsAsync(Guid tenantId)
        {
            using var scope = _app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().AuditLogs
                .Where(a => a.EntityType == nameof(Tenant) && a.EntityId == tenantId && a.Action == AuditAction.Exported)
                .ToListAsync();
        }

        public async Task AddExportRowAsync(Guid tenantId, DateTimeOffset at, string by)
        {
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = nameof(Tenant), EntityId = tenantId, Action = AuditAction.Exported, ChangedAt = at, ChangedByName = by });
            await db.SaveChangesAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
