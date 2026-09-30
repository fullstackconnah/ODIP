using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
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
/// role needs CREATEDB; the database it names is only used to connect to the server and is never modified.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private string? _adminConnectionString;
    private string? _databaseName;

    public string? ConnectionString { get; private set; }

    public bool Available => ConnectionString is not null;

    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING");
        if (string.IsNullOrWhiteSpace(configured))
            return;

        _adminConnectionString = new NpgsqlConnectionStringBuilder(configured) { Pooling = false }.ConnectionString;
        _databaseName = "odip_early_access_" + Guid.NewGuid().ToString("N");

        await using (var admin = new NpgsqlConnection(_adminConnectionString))
        {
            await admin.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{_databaseName}\"", admin);
            await create.ExecuteNonQueryAsync();
        }

        // Pooling off: closed connections really close, so the database can be dropped at the end.
        ConnectionString = new NpgsqlConnectionStringBuilder(configured) { Database = _databaseName, Pooling = false }.ConnectionString;

        await using var db = CreateContext();
        await db.Database.MigrateAsync(); // the whole migration history, as CI's `dotnet ef database update` does
    }

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
    private const string SkipReason =
        "POSTGRES_CONNECTION_STRING is not set: needs a real PostgreSQL server (pr-validation.yml provides one).";

    private readonly PostgresFixture _pg;

    public EarlyAccessPostgresTests(PostgresFixture pg) => _pg = pg;

    private static string NewEmail(string tag) => $"{tag}-{Guid.NewGuid():N}@example.com";

    private EarlyAccessService NewService(OdipDbContext db) => new(db, NullLogger<EarlyAccessService>.Instance);

    [SkippableFact]
    public async Task Migration_CreatesTheTable_WithTheAgreedColumns_AndAUniqueEmailIndex()
    {
        Skip.IfNot(_pg.Available, SkipReason);
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
            "Name|character varying|100|NO",
            "Organisation|character varying|150|NO",
            "RequestCount|integer||NO",
        }, found);

        await using var index = new NpgsqlCommand(
            "SELECT indexdef FROM pg_indexes WHERE tablename = 'EarlyAccessRequests' AND indexname = 'IX_EarlyAccessRequests_Email'", connection);
        var definition = (string?)await index.ExecuteScalarAsync();
        Assert.NotNull(definition);
        Assert.Contains("UNIQUE", definition);
        Assert.Contains("(\"Email\")", definition);
    }

    [SkippableFact]
    public async Task TheUniqueIndex_RejectsASecondRowForTheSameEmail()
    {
        Skip.IfNot(_pg.Available, SkipReason);
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
        Skip.IfNot(_pg.Available, SkipReason);
        var email = NewEmail("sequence");

        EarlyAccessRecordResult first, second, third;
        await using (var db = _pg.CreateContext()) first = await NewService(db).RecordAsync("Jane", "Org", email, CancellationToken.None);
        await using (var db = _pg.CreateContext()) second = await NewService(db).RecordAsync("Other", "Other Org", email, CancellationToken.None);
        await using (var db = _pg.CreateContext()) third = await NewService(db).RecordAsync("Other", "Other Org", email, CancellationToken.None);

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
        Skip.IfNot(_pg.Available, SkipReason);
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
            result = await NewService(db).RecordAsync("Me", "Org", email, CancellationToken.None);

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
        Skip.IfNot(_pg.Available, SkipReason);
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
            result = await NewService(db).RecordAsync("Me", "Org", email, CancellationToken.None);

        Assert.Equal(EarlyAccessOutcome.Repeated, result.Outcome);
        Assert.Equal(3, result.RequestCount); // seed (1) + the rival's bump (1) + this request (1)
        await using var check = _pg.CreateContext();
        Assert.Equal(3, (await check.EarlyAccessRequests.SingleAsync(e => e.Email == email)).RequestCount);
    }

    [SkippableFact]
    public async Task SimultaneousSubmissions_OfOneAddress_YieldOneRow_AndAnExactCount()
    {
        Skip.IfNot(_pg.Available, SkipReason);

        for (var round = 0; round < 3; round++)
        {
            var email = NewEmail("stampede");
            const int contenders = 6;
            var gate = new TaskCompletionSource();

            var tasks = Enumerable.Range(0, contenders).Select(i => Task.Run(async () =>
            {
                await gate.Task;
                await using var db = _pg.CreateContext();
                return await NewService(db).RecordAsync($"Person {i}", "Org", email, CancellationToken.None);
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
