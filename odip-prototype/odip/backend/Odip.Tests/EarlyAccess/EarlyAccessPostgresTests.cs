using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Application.EarlyAccess;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.EarlyAccess;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// One temporary PostgreSQL database per test class, created from the REAL migrations. EF InMemory enforces neither the
/// unique index nor row versions, so the behaviour the early-access endpoint depends on under concurrent submissions
/// can only be shown here.
///
/// Runs wherever POSTGRES_CONNECTION_STRING points at a server (pr-validation.yml provides postgres:16 and sets it for
/// the test step) and SKIPS otherwise — the deploy image's build-time test run has no database. The connection string's
/// role needs CREATEDB; the database it names is only used to connect to the server and is never modified. A configured
/// server that cannot be reached also skips, except on CI; a server that answers with an error (bad password, no
/// CREATEDB) fails the tests everywhere, because that is a misconfiguration worth seeing.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private string? _adminConnectionString;
    private string? _databaseName;

    public string? ConnectionString { get; private set; }

    public bool Available => ConnectionString is not null;

    /// <summary>Why <see cref="Available"/> is false (shown as the skip reason).</summary>
    public string UnavailableReason { get; private set; } = "POSTGRES_CONNECTION_STRING is not set: needs a real PostgreSQL server (pr-validation.yml provides one).";

    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING");
        if (string.IsNullOrWhiteSpace(configured))
            return;

        _adminConnectionString = new NpgsqlConnectionStringBuilder(configured) { Pooling = false }.ConnectionString;
        _databaseName = "odip_early_access_" + Guid.NewGuid().ToString("N");

        try
        {
            await using var admin = new NpgsqlConnection(_adminConnectionString);
            await admin.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{_databaseName}\"", admin);
            await create.ExecuteNonQueryAsync();
        }
        catch (Exception ex) when (ex is (NpgsqlException or System.Net.Sockets.SocketException or TimeoutException) and not PostgresException)
        {
            // A developer who exports POSTGRES_CONNECTION_STRING for the API but has no server running should get a
            // skip, not six red tests. On CI (where a server is guaranteed) an unreachable server must still fail.
            if (IsCi())
                throw;
            UnavailableReason = "POSTGRES_CONNECTION_STRING is set but the server is not reachable: " + ex.GetType().Name;
            _adminConnectionString = null;
            _databaseName = null;
            return;
        }

        // Pooling off: closed connections really close, so the database can be dropped at the end.
        ConnectionString = new NpgsqlConnectionStringBuilder(configured) { Database = _databaseName, Pooling = false }.ConnectionString;

        await using var db = CreateContext();
        await db.Database.MigrateAsync(); // the whole migration history, as CI's `dotnet ef database update` does
    }

    private static bool IsCi() =>
        string.Equals(Environment.GetEnvironmentVariable("CI"), "true", StringComparison.OrdinalIgnoreCase)
        || string.Equals(Environment.GetEnvironmentVariable("GITHUB_ACTIONS"), "true", StringComparison.OrdinalIgnoreCase);

    public async Task DisposeAsync()
    {
        if (_adminConnectionString is null || _databaseName is null)
            return;

        await using var admin = new NpgsqlConnection(_adminConnectionString);
        await admin.OpenAsync();
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)", admin);
        await drop.ExecuteNonQueryAsync();
    }

    public OdipDbContext CreateContext(params IInterceptor[] interceptors)
    {
        // Program.cs sets Npgsql.EnableLegacyTimestampBehavior at startup (DateTime maps to "timestamp without time
        // zone"); Odip.Tests.csproj sets the same switch through runtimeconfig for this test assembly.
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql(ConnectionString ?? throw new InvalidOperationException("No PostgreSQL configured"))
            .AddInterceptors(interceptors)
            .Options;
        return new OdipDbContext(options, new AnonymousTenant());
    }

    public NpgsqlConnection OpenConnection()
    {
        var connection = new NpgsqlConnection(ConnectionString);
        connection.Open();
        return connection;
    }

    private sealed class AnonymousTenant : ICurrentTenant
    {
        public Guid? TenantId => null;
        public bool IsSuperAdmin => false;
        public Guid? ViewAsUserId => null;
    }
}

public class EarlyAccessPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;

    public EarlyAccessPostgresTests(PostgresFixture pg) => _pg = pg;

    private static string NewEmail(string tag) => $"{tag}-{Guid.NewGuid():N}@example.com";

    private EarlyAccessService NewService(OdipDbContext db) => new(db, NullLogger<EarlyAccessService>.Instance);

    private static EarlyAccessValidationResult Checked(
        string name, string organisation, string email, string size = "under-10", string? role = null, string? phone = null, string? message = null) =>
        EarlyAccessRequestValidator.Validate(new EarlyAccessRequestDto
        {
            Name = name, Organisation = organisation, Email = email, OrganisationSize = size, Role = role, Phone = phone, Message = message,
        });

    [SkippableFact]
    public async Task Migration_CreatesTheTable_WithTheAgreedColumns_AndAUniqueEmailIndex()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        await using var connection = _pg.OpenConnection();

        await using var columns = new NpgsqlCommand(
            "SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns " +
            "WHERE table_name = 'EarlyAccessRequests' ORDER BY column_name", connection);
        var found = new List<string>();
        await using (var reader = await columns.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
                found.Add($"{reader.GetString(0)}|{reader.GetString(1)}|{(reader.IsDBNull(2) ? "" : reader.GetInt32(2).ToString())}|{reader.GetString(3)}");
        }

        Assert.Equal(new[]
        {
            "CreatedAtUtc|timestamp without time zone||NO",
            "Email|character varying|254|NO",
            "Id|uuid||NO",
            "LastRequestedAtUtc|timestamp without time zone||NO",
            "Message|character varying|1000|YES",
            "Name|character varying|100|NO",
            "Organisation|character varying|150|NO",
            "OrganisationSize|character varying|16|YES",
            "Phone|character varying|30|YES",
            "RequestCount|integer||NO",
            "Role|character varying|100|YES",
        }, found);

        await using var index = new NpgsqlCommand(
            "SELECT indexdef FROM pg_indexes WHERE tablename = 'EarlyAccessRequests' AND indexname = 'IX_EarlyAccessRequests_Email'", connection);
        var definition = (string?)await index.ExecuteScalarAsync();
        Assert.NotNull(definition);
        Assert.Contains("UNIQUE", definition);
        Assert.Contains("(\"Email\")", definition);
    }

    [SkippableFact]
    public async Task TheExtraFields_RoundTrip_AtTheirLimits_AndARepeatReplacesThem()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("limits");
        var role = new string('é', 100);
        var phone = new string('1', 30);
        var message = new string('€', 1000); // varchar(1000) counts characters, not bytes

        await using (var db = _pg.CreateContext())
            await NewService(db).RecordAsync(Checked("Jane", "Org", email, "200-plus", role, phone, message), CancellationToken.None);

        await using (var db = _pg.CreateContext())
        {
            var row = await db.EarlyAccessRequests.AsNoTracking().SingleAsync(e => e.Email == email);
            Assert.Equal("200-plus", row.OrganisationSize);
            Assert.Equal(role, row.Role);
            Assert.Equal(phone, row.Phone);
            Assert.Equal(message, row.Message);
        }

        await using (var db = _pg.CreateContext())
            await NewService(db).RecordAsync(Checked("Jane", "Org", email, "under-10"), CancellationToken.None);

        await using (var db = _pg.CreateContext())
        {
            var row = await db.EarlyAccessRequests.AsNoTracking().SingleAsync(e => e.Email == email);
            Assert.Equal(2, row.RequestCount);
            Assert.Equal("under-10", row.OrganisationSize);
            Assert.Null(row.Role);
            Assert.Null(row.Phone);
            Assert.Null(row.Message);
        }
    }

    [SkippableFact]
    public async Task TheUniqueIndex_RejectsASecondRowForTheSameEmail()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("unique");
        await using (var db = _pg.CreateContext())
        {
            db.EarlyAccessRequests.Add(Row(email));
            await db.SaveChangesAsync();
        }

        await using var second = _pg.CreateContext();
        second.EarlyAccessRequests.Add(Row(email));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => second.SaveChangesAsync());

        var postgres = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal(PostgresErrorCodes.UniqueViolation, postgres.SqlState);
    }

    [SkippableFact]
    public async Task Service_StoresThenCounts_OnRealPostgres()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("sequence");

        EarlyAccessRecordResult first, second, third;
        await using (var db = _pg.CreateContext()) first = await NewService(db).RecordAsync(Checked("Jane", "Org", email), CancellationToken.None);
        await using (var db = _pg.CreateContext()) second = await NewService(db).RecordAsync(Checked("Other", "Other Org", email), CancellationToken.None);
        await using (var db = _pg.CreateContext()) third = await NewService(db).RecordAsync(Checked("Other", "Other Org", email), CancellationToken.None);

        Assert.Equal(EarlyAccessOutcome.Created, first.Outcome);
        Assert.Equal(EarlyAccessOutcome.Repeated, second.Outcome);
        Assert.Equal(3, third.RequestCount);
        await using var check = _pg.CreateContext();
        var row = await check.EarlyAccessRequests.SingleAsync(e => e.Email == email);
        Assert.Equal(3, row.RequestCount);
        Assert.Equal("Jane", row.Name);
        Assert.True(row.LastRequestedAtUtc >= row.CreatedAtUtc);
        Assert.Equal(DateTimeKind.Unspecified, row.CreatedAtUtc.Kind); // legacy timestamp behaviour, as in production
    }

    /// <summary>
    /// Another request inserts the same address between this request's "is there a row?" read and its INSERT: the INSERT
    /// hits the unique index (23505). The service must retry against the new row — not fail the visitor with a 500.
    /// </summary>
    [SkippableFact]
    public async Task LosingTheInsertRace_RetriesAsARepeat_InsteadOfFailing()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("insert-race");
        var interfered = 0;
        var interceptor = new BeforeFirstSave(async () =>
        {
            interfered++;
            await using var rival = _pg.CreateContext();
            rival.EarlyAccessRequests.Add(Row(email, name: "Rival"));
            await rival.SaveChangesAsync();
        });

        EarlyAccessRecordResult result;
        await using (var db = _pg.CreateContext(interceptor))
            result = await NewService(db).RecordAsync(Checked("Me", "Org", email), CancellationToken.None);

        Assert.Equal(1, interfered);
        Assert.Equal(EarlyAccessOutcome.Repeated, result.Outcome);
        Assert.Equal(2, result.RequestCount);
        await using var check = _pg.CreateContext();
        var row = await check.EarlyAccessRequests.SingleAsync(e => e.Email == email);
        Assert.Equal(2, row.RequestCount);
        Assert.Equal("Rival", row.Name); // the row that got there first keeps its details
    }

    /// <summary>
    /// Another repeat request bumps the count between this request's read and its UPDATE. RequestCount is a concurrency
    /// token, so this UPDATE matches no row; the service must re-read and add ITS increment on top, not overwrite (lost
    /// update) and not fail.
    /// </summary>
    [SkippableFact]
    public async Task LosingTheUpdateRace_RereadsAndCountsBothRequests()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("update-race");
        await using (var seed = _pg.CreateContext())
        {
            seed.EarlyAccessRequests.Add(Row(email));
            await seed.SaveChangesAsync();
        }

        var interceptor = new BeforeFirstSave(async () =>
        {
            await using var connection = _pg.OpenConnection();
            await using var bump = new NpgsqlCommand(
                "UPDATE \"EarlyAccessRequests\" SET \"RequestCount\" = \"RequestCount\" + 1 WHERE \"Email\" = @e", connection);
            bump.Parameters.AddWithValue("e", email);
            await bump.ExecuteNonQueryAsync();
        });

        EarlyAccessRecordResult result;
        await using (var db = _pg.CreateContext(interceptor))
            result = await NewService(db).RecordAsync(Checked("Me", "Org", email), CancellationToken.None);

        Assert.Equal(EarlyAccessOutcome.Repeated, result.Outcome);
        Assert.Equal(3, result.RequestCount); // seed (1) + the rival's bump (1) + this request (1)
        await using var check = _pg.CreateContext();
        Assert.Equal(3, (await check.EarlyAccessRequests.SingleAsync(e => e.Email == email)).RequestCount);
    }

    /// <summary>
    /// The visitor closes the tab while the INSERT is being sent: the commit must still happen (and the operator email
    /// still follow), because a cancelled call can land on the server anyway. Reverting the write to use the request's
    /// token makes Npgsql throw here and this test fails.
    /// </summary>
    [SkippableFact]
    public async Task ARequestCancelledDuringTheWrite_StillCompletesTheWrite()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("cancelled");
        using var cancellation = new CancellationTokenSource();
        var interceptor = new BeforeFirstSave(() =>
        {
            cancellation.Cancel();
            return Task.CompletedTask;
        });

        EarlyAccessRecordResult result;
        await using (var db = _pg.CreateContext(interceptor))
            result = await NewService(db).RecordAsync(Checked("Me", "Org", email), cancellation.Token);

        Assert.Equal(EarlyAccessOutcome.Created, result.Outcome);
        await using var check = _pg.CreateContext();
        Assert.Equal(1, await check.EarlyAccessRequests.CountAsync(e => e.Email == email));
    }

    [SkippableFact]
    public async Task SimultaneousSubmissions_OfOneAddress_YieldOneRow_AndAnExactCount()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);

        for (var round = 0; round < 3; round++)
        {
            var email = NewEmail("stampede");
            const int contenders = 6;
            var gate = new TaskCompletionSource();

            var tasks = Enumerable.Range(0, contenders).Select(i => Task.Run(async () =>
            {
                await gate.Task;
                await using var db = _pg.CreateContext();
                return await NewService(db).RecordAsync(Checked($"Person {i}", "Org", email), CancellationToken.None);
            })).ToArray();
            gate.SetResult();
            var results = await Task.WhenAll(tasks);

            Assert.Equal(1, results.Count(r => r.Outcome == EarlyAccessOutcome.Created));
            Assert.Equal(contenders - 1, results.Count(r => r.Outcome == EarlyAccessOutcome.Repeated));
            await using var check = _pg.CreateContext();
            var row = await check.EarlyAccessRequests.SingleAsync(e => e.Email == email);
            Assert.Equal(contenders, row.RequestCount);
        }
    }

    // ── The 12-month purge (EarlyAccessPurgeBackgroundService) ──

    private EarlyAccessPurgeBackgroundService Purger(CapturingLogger<EarlyAccessPurgeBackgroundService>? log = null)
    {
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseNpgsql(_pg.ConnectionString));
        return new EarlyAccessPurgeBackgroundService(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(), log ?? new CapturingLogger<EarlyAccessPurgeBackgroundService>());
    }

    private async Task<EarlyAccessRequest> SeedRowAsync(string tag, DateTime createdUtc, DateTime lastSentUtc, int count = 1)
    {
        var row = Row(NewEmail(tag), name: "Purge " + tag);
        row.CreatedAtUtc = createdUtc;
        row.LastRequestedAtUtc = lastSentUtc;
        row.RequestCount = count;
        await using var db = _pg.CreateContext();
        db.EarlyAccessRequests.Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    [SkippableFact]
    public async Task ThePurge_DeletesSignupsLastSentMoreThan12MonthsAgo_AndKeepsTheRest()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var now = DateTime.UtcNow;
        var expired = await SeedRowAsync("expired", now.AddMonths(-12).AddMinutes(-1), now.AddMonths(-12).AddMinutes(-1));
        var justInside = await SeedRowAsync("inside", now.AddMonths(-12).AddMinutes(1), now.AddMonths(-12).AddMinutes(1));
        var refreshed = await SeedRowAsync("refreshed", now.AddMonths(-24), now.AddDays(-7), count: 2);
        var log = new CapturingLogger<EarlyAccessPurgeBackgroundService>();

        var deleted = await Purger(log).PurgeExpiredAsync(now, CancellationToken.None);

        Assert.True(deleted >= 1); // the class shares one database
        await using var check = _pg.CreateContext();
        var ids = new[] { expired.Id, justInside.Id, refreshed.Id };
        var remaining = await check.EarlyAccessRequests.Where(e => ids.Contains(e.Id)).Select(e => e.Id).ToListAsync();
        Assert.Equal(new[] { justInside.Id, refreshed.Id }.OrderBy(i => i), remaining.OrderBy(i => i));

        var entry = Assert.Single(log.Entries, e => e.Level == LogLevel.Information);
        Assert.Contains(deleted.ToString(System.Globalization.CultureInfo.InvariantCulture), entry.Message);
        Assert.DoesNotContain("@", entry.Message);
        Assert.DoesNotContain(expired.Name, entry.Message);
        Assert.DoesNotContain(expired.Email, entry.Message);
    }

    [SkippableFact]
    public async Task ThePurge_RunsWhenTheServiceStarts()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var old = DateTime.UtcNow.AddMonths(-13);
        var expired = await SeedRowAsync("at-start", old, old);
        var purger = Purger();

        await purger.StartAsync(CancellationToken.None);
        var gone = false;
        for (var waited = 0; waited < 10_000 && !gone; waited += 100)
        {
            await using var check = _pg.CreateContext();
            gone = !await check.EarlyAccessRequests.AnyAsync(e => e.Id == expired.Id);
            if (!gone) await Task.Delay(100);
        }
        await purger.StopAsync(CancellationToken.None);

        Assert.True(gone, "the first purge should run at start, not a day later");
    }

    // ── SuperAdmin Delete (AdminEarlyAccessController) against the RequestCount concurrency token ──

    [SkippableFact]
    public async Task Delete_ThatRacesARepeatSignup_StillDeletes_InsteadOf500()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var row = await SeedRowAsync();

        var result = await DeleteWhileAsync(row.Id, "UPDATE \"EarlyAccessRequests\" SET \"RequestCount\" = \"RequestCount\" + 1 WHERE \"Id\" = @id");

        Assert.IsType<OkObjectResult>(result.Result);
        await using var check = _pg.CreateContext();
        Assert.False(await check.EarlyAccessRequests.AnyAsync(e => e.Id == row.Id));
        Assert.Equal(1, await check.AuditLogs.CountAsync(a => a.EntityId == row.Id));
    }

    [SkippableFact]
    public async Task Delete_OfARowRemovedMidway_Returns404()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var row = await SeedRowAsync();

        var result = await DeleteWhileAsync(row.Id, "DELETE FROM \"EarlyAccessRequests\" WHERE \"Id\" = @id");

        Assert.IsType<NotFoundObjectResult>(result.Result);
        await using var check = _pg.CreateContext();
        Assert.Equal(0, await check.AuditLogs.CountAsync(a => a.EntityId == row.Id));
    }

    private async Task<EarlyAccessRequest> SeedRowAsync()
    {
        var row = Row(NewEmail("delete"));
        await using var db = _pg.CreateContext();
        db.EarlyAccessRequests.Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    /// <summary>A SuperAdmin's Delete, with <paramref name="sql"/> run on another connection just before its first save.</summary>
    private async Task<ActionResult<Odip.Application.Common.ApiResponse<bool>>> DeleteWhileAsync(Guid id, string sql)
    {
        var interfere = new BeforeFirstSave(async () =>
        {
            await using var connection = _pg.OpenConnection();
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue("id", id);
            await command.ExecuteNonQueryAsync();
        });
        await using var db = _pg.CreateContext(interfere);
        var controller = new AdminEarlyAccessController(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
                        new Claim(ClaimTypes.Role, "SuperAdmin"),
                        new Claim("fullName", "Jordan Lee"),
                    }, "Test")),
                },
            },
        };
        return await controller.Delete(id, CancellationToken.None);
    }

    private static EarlyAccessRequest Row(string email, string name = "Jane") => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        Organisation = "Org",
        Email = email,
        CreatedAtUtc = DateTime.UtcNow,
        LastRequestedAtUtc = DateTime.UtcNow,
        RequestCount = 1,
    };

    /// <summary>Runs <paramref name="interfere"/> once, just before the context's first SaveChanges hits the database.</summary>
    private sealed class BeforeFirstSave : SaveChangesInterceptor
    {
        private readonly Func<Task> _interfere;
        private int _fired;

        public BeforeFirstSave(Func<Task> interfere) => _interfere = interfere;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Exchange(ref _fired, 1) == 0)
                await _interfere();
            return result;
        }
    }
}
