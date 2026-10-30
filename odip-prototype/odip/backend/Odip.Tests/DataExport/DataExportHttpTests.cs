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
using Odip.Api.RateLimiting;
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
        Assert.Matches("^bunya-support-export-sunrise-care-[0-9]{4}-[0-9]{2}-[0-9]{2}[.]zip$", response.Content.Headers.ContentDisposition!.FileName!.Trim('"'));
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
    public async Task A_second_export_of_one_organisation_while_one_runs_gets_429_and_another_organisation_still_exports()
    {
        var release = new ManualResetEventSlim();
        Guid? hold = null;
        await using var host = await Host.StartAsync(new OnVehicle(v => { if (v.TenantId == hold) release.Wait(TimeSpan.FromSeconds(20)); }));
        var tenantId = await host.SeedAsync("Sunrise Care");
        var otherTenantId = await host.SeedAsync("Bravo Care");
        hold = tenantId;

        // Its 200 is sent from inside the action, so once the headers are here the first export holds the organisation's slot.
        using var running = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId, completion: HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.OK, running.StatusCode);

        using (var refused = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId))
        {
            Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
            using var json = JsonDocument.Parse(await refused.Content.ReadAsStringAsync());
            Assert.Equal("An export for this organisation is already running. Try again when it finishes.", json.RootElement.GetProperty("errors")[0].GetString());
        }
        using (var other = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: otherTenantId))
        {
            Assert.Equal(HttpStatusCode.OK, other.StatusCode);
            using var zip = new ZipArchive(new MemoryStream(await other.Content.ReadAsByteArrayAsync()), ZipArchiveMode.Read);
            Assert.Equal(DataExportWriter.ManifestName, zip.Entries[^1].FullName);
        }

        release.Set();
        await running.Content.ReadAsByteArrayAsync();
    }

    [Fact]
    public async Task The_organisations_slot_is_free_again_after_a_failed_export_and_after_a_finished_one()
    {
        var failNext = true;
        await using var host = await Host.StartAsync(new OnVehicle(_ =>
        {
            if (!failNext) return;
            failNext = false;
            throw new InvalidOperationException("The disk went away");
        }));
        var tenantId = await host.SeedAsync("Sunrise Care");

        // The server resets the connection as soon as the export fails, and on a busy machine that can beat the headers to the client (CI: the reset
        // surfaced from SendAsync, "Connection reset by peer", before any byte). So the headers read is inside the Record too: this test is about the
        // slot, and either way the download broke.
        var failure = await Record.ExceptionAsync(async () =>
        {
            using var failed = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId, completion: HttpCompletionOption.ResponseHeadersRead);
            await failed.Content.ReadAsByteArrayAsync(); // aborted part-way
        });
        Assert.True(failure is HttpRequestException or IOException, $"The first export must break the download; it saw {failure?.GetType().Name ?? "a clean end"}.");

        using (var afterFailure = await host.ExportOnceTheSlotIsFreeAsync(tenantId)) Assert.Equal(HttpStatusCode.OK, afterFailure.StatusCode);
        using (var afterSuccess = await host.ExportOnceTheSlotIsFreeAsync(tenantId)) Assert.Equal(HttpStatusCode.OK, afterSuccess.StatusCode);
    }

    [Fact]
    public async Task A_client_that_leaves_after_the_last_byte_still_gets_its_audit_row()
    {
        // The client reads the ZIP to its last byte, then closes the connection. Only then is the row saved: the server sees the client go
        // (RequestAborted), and the save is handed a token that Npgsql would honour. (Faking the leave with a server-side Abort raced the
        // client: the reset made the client drop bytes it hadn't read yet, the headers included, on a fast machine.)
        var clientLeft = new ManualResetEventSlim();
        var serverSawTheClientGo = false;
        await using var host = await Host.StartAsync(new OnAuditSave(token =>
        {
            clientLeft.Wait(TimeSpan.FromSeconds(20));
            serverSawTheClientGo = new HttpContextAccessor().HttpContext!.RequestAborted.WaitHandle.WaitOne(TimeSpan.FromSeconds(10));
            token.ThrowIfCancellationRequested();
        }));
        var tenantId = await host.SeedAsync("Sunrise Care");

        var zip = new MemoryStream();
        using (var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId, completion: HttpCompletionOption.ResponseHeadersRead))
        {
            await using var body = await response.Content.ReadAsStreamAsync();
            var buffer = new byte[8192];
            // The ZIP's last 22 bytes are its end-of-central-directory record (PK 05 06, no comment): once they are here, the client has it all.
            while (!(zip.Length >= 22 && zip.GetBuffer().AsSpan((int)zip.Length - 22, 4).SequenceEqual(new byte[] { 0x50, 0x4B, 0x05, 0x06 })))
            {
                var read = await body.ReadAsync(buffer);
                Assert.True(read > 0, "The response ended before the ZIP was complete.");
                zip.Write(buffer, 0, read);
            }
        } // the client closes the connection here, with the whole ZIP and before the response has formally ended
        clientLeft.Set();

        zip.Position = 0;
        using (var archive = new ZipArchive(zip, ZipArchiveMode.Read)) Assert.Equal(DataExportWriter.ManifestName, archive.Entries[^1].FullName);
        Assert.Single(await host.ExportRowsEventuallyAsync(tenantId));
        Assert.True(serverSawTheClientGo, "The server never saw the client leave, so the save was not tested with a cancelled request.");
    }

    [Fact]
    public async Task An_audit_save_that_fails_after_a_complete_zip_is_logged_and_the_client_keeps_its_whole_zip()
    {
        await using var host = await Host.StartAsync(new OnAuditSave(_ => throw new InvalidOperationException("The audit table is locked")));
        var tenantId = await host.SeedAsync("Sunrise Care");

        using var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId);

        using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()), ZipArchiveMode.Read);
        Assert.Equal(DataExportWriter.ManifestName, zip.Entries[^1].FullName);
        Assert.Contains(host.Logs, l => l.Category == typeof(DataExportController).FullName && l.Level == LogLevel.Error
            && l.Message.Contains("audit row not written") && l.Message.Contains(tenantId.ToString()));
        Assert.Empty(await host.ExportRowsAsync(tenantId));
    }

    [Fact]
    public async Task An_audit_save_that_hangs_is_cut_off_by_its_own_timeout_logged_and_the_client_keeps_its_whole_zip()
    {
        // A save that never finishes on its own (a lock, a dead connection) and gives up only when its token is cancelled, as Npgsql does.
        await using var host = await Host.StartAsync(new OnAuditSave(token =>
        {
            token.WaitHandle.WaitOne(TimeSpan.FromSeconds(60));
            token.ThrowIfCancellationRequested();
        }));
        var tenantId = await host.SeedAsync("Sunrise Care");
        var watch = System.Diagnostics.Stopwatch.StartNew();

        using var response = await host.GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId);

        using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()), ZipArchiveMode.Read);
        Assert.Equal(DataExportWriter.ManifestName, zip.Entries[^1].FullName);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(30), $"The audit save is bounded at about 15 s; the request took {watch.Elapsed.TotalSeconds:0} s.");
        Assert.Contains(host.Logs, l => l.Category == typeof(DataExportController).FullName && l.Level == LogLevel.Error
            && l.Message.Contains("audit row not written") && l.Message.Contains(tenantId.ToString()));
    }

    [Fact]
    public async Task The_organisations_slot_is_free_again_after_the_client_cancels_a_download()
    {
        // The first export is held at its vehicles until the server itself has seen the client go. Released any earlier, the rest of a small
        // ZIP fits in the socket buffers, the export finishes and is recorded: TCP can't tell a client that left from one that got every byte.
        var holdFirst = true;
        await using var host = await Host.StartAsync(new OnVehicle(_ =>
        {
            if (!holdFirst) return;
            holdFirst = false;
            new HttpContextAccessor().HttpContext!.RequestAborted.WaitHandle.WaitOne(TimeSpan.FromSeconds(20));
        }));
        var tenantId = await host.SeedAsync("Sunrise Care");

        using (var cancelled = new CancellationTokenSource())
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/data-export");
            request.Headers.Add("X-Test-Role", "Admin");
            request.Headers.Add("X-Test-Tenant", tenantId.ToString());
            using var running = await host.Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancelled.Token);
            Assert.Equal(HttpStatusCode.OK, running.StatusCode); // it holds the slot
            cancelled.Cancel(); // the browser tab is closed mid-download
        }

        using var next = await host.ExportOnceTheSlotIsFreeAsync(tenantId);
        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
        // The cancel was seen: the cancelled export logged the client going away and wrote no row; only the next one did.
        Assert.Contains(host.Logs, l => l.Category == typeof(DataExportController).FullName && l.Level == LogLevel.Information && l.Message.Contains("stopped: the client went away"));
        Assert.Single(await host.ExportRowsEventuallyAsync(tenantId));
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

    /// <summary>Runs <paramref name="onEach"/> as each vehicle is read, with the row, so a test can hold or fail one organisation's export.</summary>
    private sealed class OnVehicle(Action<Vehicle> onEach) : IMaterializationInterceptor
    {
        public object InitializedInstance(MaterializationInterceptionData materializationData, object entity)
        {
            if (entity is Vehicle vehicle) onEach(vehicle);
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
            // Each host passes its own interceptor instances, and EF builds an internal service provider per distinct set; past twenty in one test
            // process it raises ManyServiceProvidersCreatedWarning as an error. That is expected for these hosts, so it is switched off here only.
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName).AddInterceptors(interceptors)
                .ConfigureWarnings(w => w.Ignore(CoreEventId.ManyServiceProvidersCreatedWarning)));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
            // As Program.cs registers them: the download's one-export-per-organisation filter.
            builder.Services.AddKeyedSingleton(DataExportConcurrencyFilter.LimiterKey, (_, _) => new PlanQuoteConcurrencyLimiter(DataExportConcurrencyFilter.PermitsPerOrganisation));
            builder.Services.AddScoped<DataExportConcurrencyFilter>();
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

        /// <summary>A whole export for the organisation, retried while it answers 429: the client can have the last byte a moment before the slot is released.</summary>
        public async Task<HttpResponseMessage> ExportOnceTheSlotIsFreeAsync(Guid tenantId)
        {
            var until = DateTime.UtcNow.AddSeconds(10);
            while (true)
            {
                var response = await GetAsync("/api/v1/data-export", "Admin", tenantClaim: tenantId);
                if (response.StatusCode != HttpStatusCode.TooManyRequests || DateTime.UtcNow > until) return response;
                response.Dispose();
                await Task.Delay(50);
            }
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
