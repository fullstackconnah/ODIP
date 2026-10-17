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
    public async Task TheExtraFields_RoundTrip_AtTheirLimits_AndARepeatDoesNotReplaceThem()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("limits");
        var role = new string('é', 100);
        var phone = "(1-1-1-1-1-1-1-1-1-1-1-1-1-1-1"; // 30 characters, 15 digits: the most the validator allows
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
            // The stored answers are the first ones; the repeat is a later submission.
            var row = await db.EarlyAccessRequests.AsNoTracking().Include(e => e.LaterSubmissions).SingleAsync(e => e.Email == email);
            Assert.Equal(2, row.RequestCount);
            Assert.Equal("200-plus", row.OrganisationSize);
            Assert.Equal(role, row.Role);
            Assert.Equal(phone, row.Phone);
            Assert.Equal(message, row.Message);
            var later = Assert.Single(row.LaterSubmissions);
            Assert.Equal("under-10", later.OrganisationSize);
            Assert.Null(later.Role);
            Assert.Null(later.Phone);
            Assert.Null(later.Message);
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

    // ── Later submissions (repeats whose answers differ) ──

    [SkippableFact]
    public async Task ARepeat_KeepsTheStoredAnswers_AndTheLaterSubmissionRoundTripsAtItsLimits()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("later");
        var message = new string('€', 1000);
        await using (var db = _pg.CreateContext())
            await NewService(db).RecordAsync(Checked("Jane", "Org", email, "10-49", "Ops", "0491 570 156", "Rostering"), CancellationToken.None);
        await using (var db = _pg.CreateContext())
            await NewService(db).RecordAsync(Checked("Jane", "Org", email, "under-10", new string('é', 100), "+61 491 570 156", message), CancellationToken.None);
        await using (var db = _pg.CreateContext())
            await NewService(db).RecordAsync(Checked("Jane", "Org", email, "10-49", "Ops", "0491 570 156", "Rostering"), CancellationToken.None); // identical: stores nothing

        await using var check = _pg.CreateContext();
        var row = await check.EarlyAccessRequests.AsNoTracking().Include(e => e.LaterSubmissions).SingleAsync(e => e.Email == email);
        Assert.Equal(3, row.RequestCount);
        Assert.Equal("Rostering", row.Message);
        Assert.Equal("0491 570 156", row.Phone);
        var later = Assert.Single(row.LaterSubmissions);
        Assert.Equal(message, later.Message);
        Assert.Equal(new string('é', 100), later.Role);
        Assert.Equal("under-10", later.OrganisationSize);
    }

    [SkippableFact]
    public async Task OnlyTheFirstTenLaterSubmissions_AreKept_EvenWhenManyArriveTogether_AndEveryOneIsCounted()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("cap");
        await using (var db = _pg.CreateContext())
            await NewService(db).RecordAsync(Checked("Jane", "Org", email), CancellationToken.None);
        for (var i = 0; i < 5; i++)
            await using (var db = _pg.CreateContext())
                await NewService(db).RecordAsync(Checked("Jane", "Org", email, message: $"seq {i}"), CancellationToken.None);

        // 8 more at once, all different: only 5 places are left, so a lost race must recount rather than store a sixth.
        var gate = new TaskCompletionSource();
        var tasks = Enumerable.Range(0, 8).Select(i => Task.Run(async () =>
        {
            await gate.Task;
            await using var db = _pg.CreateContext();
            return await NewService(db).RecordAsync(Checked("Jane", "Org", email, message: $"race {i}"), CancellationToken.None);
        })).ToArray();
        gate.SetResult();
        await Task.WhenAll(tasks);

        await using var check = _pg.CreateContext();
        var row = await check.EarlyAccessRequests.SingleAsync(e => e.Email == email);
        Assert.Equal(14, row.RequestCount);
        Assert.Equal(10, await check.EarlyAccessLaterSubmissions.CountAsync(l => l.EarlyAccessRequestId == row.Id));
    }

    [SkippableFact]
    public async Task TheSameDifferingMessageSentTwice_IsStoredOnce_AndAnyStoredOneCountsAsADuplicate()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("dupes");
        foreach (var message in new[] { "base", "note A", "note B", "note A", "note B", "note A" })
            await using (var db = _pg.CreateContext())
                await NewService(db).RecordAsync(Checked("Jane", "Org", email, message: message), CancellationToken.None);

        await using var check = _pg.CreateContext();
        var row = await check.EarlyAccessRequests.AsNoTracking().Include(e => e.LaterSubmissions).SingleAsync(e => e.Email == email);
        Assert.Equal(6, row.RequestCount);
        Assert.Equal(new[] { "note A", "note B" }, row.LaterSubmissions.OrderBy(l => l.ReceivedAtUtc).Select(l => l.Message).ToArray());
    }

    [SkippableFact]
    public async Task ARepeatThatRacesTheSuperAdminsDelete_IsRetriedAsAFreshSignup_NotA500()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var email = NewEmail("race-delete");
        await using (var db = _pg.CreateContext())
            await NewService(db).RecordAsync(Checked("Jane", "Org", email, message: "first"), CancellationToken.None);
        var interfere = new BeforeFirstSave(async () =>
        {
            await using var connection = _pg.OpenConnection();
            await using var command = new NpgsqlCommand("DELETE FROM \"EarlyAccessRequests\" WHERE \"Email\" = @email", connection);
            command.Parameters.AddWithValue("email", email);
            await command.ExecuteNonQueryAsync();
        });

        EarlyAccessRecordResult result;
        await using (var db = _pg.CreateContext(interfere))
            result = await NewService(db).RecordAsync(Checked("Jane", "Org", email, message: "second"), CancellationToken.None);

        Assert.Equal(EarlyAccessOutcome.Created, result.Outcome);
        await using var check = _pg.CreateContext();
        var row = await check.EarlyAccessRequests.AsNoTracking().SingleAsync(e => e.Email == email);
        Assert.Equal("second", row.Message);
        Assert.Equal(1, row.RequestCount);
    }

    [SkippableFact]
    public async Task TheSuperAdminList_LoadsEachSignupsLaterSubmissions_OldestFirst_AcrossMoreThanOneSignup()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var tag = Guid.NewGuid().ToString("N")[..8];
        var emails = new[] { NewEmail("list-a"), NewEmail("list-b") };
        foreach (var email in emails)
        {
            await using (var db = _pg.CreateContext())
                await NewService(db).RecordAsync(Checked("Listed " + tag, "Org", email), CancellationToken.None);
            foreach (var message in new[] { "first", "second", "third" })
                await using (var db = _pg.CreateContext())
                    await NewService(db).RecordAsync(Checked("Listed " + tag, "Org", email, message: email + message), CancellationToken.None);
        }

        await using var read = _pg.CreateContext();
        var response = await new AdminEarlyAccessController(read).GetAll(page: 1, pageSize: 100, ct: CancellationToken.None);
        var page = Assert.IsType<OkObjectResult>(response.Result).Value;
        var items = Assert.IsType<Odip.Application.Common.ApiResponse<Odip.Application.Common.PagedResult<EarlyAccessSignupDto>>>(page).Data!.Items;
        var rows = items.Where(r => emails.Contains(r.Email)).ToList();

        Assert.Equal(2, rows.Count);
        foreach (var r in rows)
            Assert.Equal(new[] { r.Email + "first", r.Email + "second", r.Email + "third" }, r.LaterSubmissions.Select(l => l.Message).ToArray());
    }

    [Fact]
    public async Task ThePurge_RetriesInFiveMinutesAfterAFailedRun()
    {
        var now = new DateTime(2026, 10, 17, 3, 0, 0, DateTimeKind.Utc);
        var scopes = new Moq.Mock<IServiceScopeFactory>();
        scopes.Setup(f => f.CreateScope()).Throws(new InvalidOperationException("database down"));
        var purger = new EarlyAccessPurgeBackgroundService(scopes.Object, NullLogger<EarlyAccessPurgeBackgroundService>.Instance);

        Assert.Equal(TimeSpan.FromMinutes(5), EarlyAccessPurgeBackgroundService.RetryInterval);
        Assert.Equal(EarlyAccessPurgeBackgroundService.RetryInterval, await purger.RunOnceAsync(now, CancellationToken.None));
    }

    [SkippableFact]
    public async Task ThePurge_WaitsAnHourAfterASuccessfulRun()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var now = new DateTime(2026, 10, 17, 3, 0, 0, DateTimeKind.Utc);

        Assert.Equal(EarlyAccessPurgeBackgroundService.Interval, await Purger().RunOnceAsync(now, CancellationToken.None));
    }

    [SkippableFact]
    public async Task TheLaterSubmissions_GoWithTheirSignup_WhenTheSuperAdminDeletesIt_AndWhenThePurgeDoes()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var deleted = await SeedRowAsync("cascade-delete", DateTime.UtcNow.AddDays(-2), DateTime.UtcNow.AddDays(-1), count: 3);
        var purged = await SeedRowAsync("cascade-purge", DateTime.UtcNow.AddMonths(-13), DateTime.UtcNow.AddMonths(-13), count: 3);
        var kept = await SeedRowAsync("cascade-kept", DateTime.UtcNow.AddDays(-2), DateTime.UtcNow.AddDays(-1), count: 3);
        await using (var db = _pg.CreateContext())
        {
            foreach (var parent in new[] { deleted, purged, kept })
                for (var i = 0; i < 2; i++)
                    db.EarlyAccessLaterSubmissions.Add(new EarlyAccessLaterSubmission
                    {
                        Id = Guid.NewGuid(), EarlyAccessRequestId = parent.Id, ReceivedAtUtc = DateTime.UtcNow, Name = "Jane", Organisation = "Org", Message = $"m{i}",
                    });
            await db.SaveChangesAsync();
        }

        var result = await DeleteWhileAsync(deleted.Id, "UPDATE \"EarlyAccessRequests\" SET \"Name\" = \"Name\" WHERE \"Id\" = @id");
        Assert.IsType<OkObjectResult>(result.Result);
        await Purger().PurgeExpiredAsync(DateTime.UtcNow, CancellationToken.None);

        await using var check = _pg.CreateContext();
        Assert.Equal(0, await check.EarlyAccessLaterSubmissions.CountAsync(l => l.EarlyAccessRequestId == deleted.Id));
        Assert.Equal(0, await check.EarlyAccessLaterSubmissions.CountAsync(l => l.EarlyAccessRequestId == purged.Id));
        Assert.Equal(2, await check.EarlyAccessLaterSubmissions.CountAsync(l => l.EarlyAccessRequestId == kept.Id));
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

    // The purge runs hourly and deletes one interval early, so a row is gone at least an hour before its 12 months and never after.
    private static DateTime EarlyCutoff(DateTime now) => EarlyAccessPurgeBackgroundService.RetentionCutoff(now);

    [Fact]
    public void ThePurge_RunsEveryHour()
    {
        Assert.Equal(TimeSpan.FromHours(1), EarlyAccessPurgeBackgroundService.Interval);
    }

    [SkippableFact]
    public async Task ThePurge_DeletesSignupsAtOrBeforeTheEarlyCutoff_EvenIfSentAgainSince_AndKeepsTheRest()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        // PostgreSQL keeps microseconds, so the clock is cut to them and the boundary can be pinned exactly.
        var now = new DateTime(DateTime.UtcNow.Ticks / 10 * 10, DateTimeKind.Utc);
        var cutoff = EarlyCutoff(now);
        var oneMicrosecond = TimeSpan.FromTicks(10);
        var expired = await SeedRowAsync("expired", cutoff - oneMicrosecond, cutoff - oneMicrosecond);
        var atTheCutoff = await SeedRowAsync("cutoff", cutoff, cutoff);
        var justYounger = await SeedRowAsync("younger", cutoff + oneMicrosecond, cutoff + oneMicrosecond);
        // Anyone can send the form again with someone's address, so a repeat must not extend how long their details are kept.
        var resent = await SeedRowAsync("resent", now.AddMonths(-24), now.AddDays(-7), count: 2);
        var recent = await SeedRowAsync("recent", now.AddDays(-30), now.AddDays(-30));
        var log = new CapturingLogger<EarlyAccessPurgeBackgroundService>();

        var deleted = await Purger(log).PurgeExpiredAsync(now, CancellationToken.None);

        Assert.True(deleted >= 3); // the class shares one database
        await using var check = _pg.CreateContext();
        var ids = new[] { expired.Id, atTheCutoff.Id, justYounger.Id, resent.Id, recent.Id };
        var remaining = await check.EarlyAccessRequests.Where(e => ids.Contains(e.Id)).Select(e => e.Id).ToListAsync();
        Assert.Equal(new[] { justYounger.Id, recent.Id }.OrderBy(i => i), remaining.OrderBy(i => i));

        var entry = Assert.Single(log.Entries, e => e.Level == LogLevel.Information);
        Assert.Contains(deleted.ToString(System.Globalization.CultureInfo.InvariantCulture), entry.Message);
        Assert.DoesNotContain("@", entry.Message);
        Assert.DoesNotContain(expired.Name, entry.Message);
        Assert.DoesNotContain(expired.Email, entry.Message);
    }

    [SkippableFact]
    public async Task ARowCreatedAtT_IsGoneByTheFirstRunAtOrAfterT_Plus12Months_Minus1Hour_AndNotBefore()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var created = new DateTime(2025, 3, 10, 6, 30, 0, DateTimeKind.Utc);
        var row = await SeedRowAsync("window", created, created);
        var due = created.AddMonths(12) - EarlyAccessPurgeBackgroundService.Interval;

        await Purger().PurgeExpiredAsync(due - TimeSpan.FromTicks(10), CancellationToken.None);
        await using (var before = _pg.CreateContext())
            Assert.True(await before.EarlyAccessRequests.AnyAsync(e => e.Id == row.Id), "kept until the hour before its 12 months");

        await Purger().PurgeExpiredAsync(due, CancellationToken.None);
        await using (var after = _pg.CreateContext())
            Assert.False(await after.EarlyAccessRequests.AnyAsync(e => e.Id == row.Id), "gone by the first run at or after T + 12 months - 1 h");
    }

    [SkippableFact]
    public async Task A29FebSignUp_IsGoneByTheRunAt28FebNoonTheNextYear()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var created = new DateTime(2024, 2, 29, 12, 0, 0, DateTimeKind.Utc);
        var row = await SeedRowAsync("leap-day", created, created);

        await Purger().PurgeExpiredAsync(new DateTime(2025, 2, 28, 12, 0, 0, DateTimeKind.Utc), CancellationToken.None);

        await using var check = _pg.CreateContext();
        Assert.False(await check.EarlyAccessRequests.AnyAsync(e => e.Id == row.Id), "due 28 Feb 2025 12:00, so not kept to 1 Mar");
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

        Assert.True(gone, "the first purge should run at start, not an hour later");
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
