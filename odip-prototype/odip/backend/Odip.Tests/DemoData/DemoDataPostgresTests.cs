using System.Data.Common;
using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Tests.EarlyAccess;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The demo top-up against a real PostgreSQL, created from the real migrations. EF InMemory cannot see unique and partial indexes, foreign
/// keys, advisory locks, transaction isolation or SQL translation, so the claims that depend on them are made here: the first tick on a
/// database the old seed built succeeds and a second changes nothing (T1), the aged-database run keeps every old row (T3), the first tick is
/// fast and an idle one is cheap (T8), two maintainers cannot interleave and a row somebody else changed is not overwritten (T9).
///
/// Runs wherever POSTGRES_CONNECTION_STRING names a server (pr-validation.yml provides postgres:16 for the test step) and SKIPS otherwise,
/// like the other Postgres-backed tests: the deploy image's build-time test run has no database. Every test name starts "Postgres_" so a CI
/// log search finds them; a skip here proves nothing, so the PR body carries the run from the CI job.
/// </summary>
public sealed class DemoDataPostgresFixture : IAsyncLifetime
{
    private string? _configured;
    private string? _templateName;
    private readonly List<string> _databases = new();

    public bool Available { get; private set; }

    public string UnavailableReason { get; private set; } = "POSTGRES_CONNECTION_STRING is not set: needs a real PostgreSQL server (pr-validation.yml provides one).";

    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING");
        if (string.IsNullOrWhiteSpace(configured)) return;
        _configured = configured;
        _templateName = "odip_demo_tmpl_" + Guid.NewGuid().ToString("N");

        try
        {
            await ExecuteAdminAsync($"CREATE DATABASE \"{_templateName}\"");
            _databases.Add(_templateName);
            await using var db = new OdipDbContext(
                new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(ConnectionStringFor(_templateName)).Options, SuperAdmin());
            await db.Database.MigrateAsync();      // the whole migration history, as CI's `dotnet ef database update` does
            Available = true;
        }
        catch (Exception ex) when (ex is (NpgsqlException or System.Net.Sockets.SocketException or TimeoutException) and not PostgresException)
        {
            // A developer who exports the variable but has no server running should get a skip, not red tests. On CI a server is guaranteed.
            if (IsCi()) throw;
            UnavailableReason = "POSTGRES_CONNECTION_STRING is set but the server is not reachable: " + ex.GetType().Name;
        }
    }

    private static bool IsCi() =>
        string.Equals(Environment.GetEnvironmentVariable("CI"), "true", StringComparison.OrdinalIgnoreCase)
        || string.Equals(Environment.GetEnvironmentVariable("GITHUB_ACTIONS"), "true", StringComparison.OrdinalIgnoreCase);

    /// <summary>A migrated, empty database of its own (a clone of the template): each test gets one, so tests never share rows.</summary>
    public async Task<string> NewDatabaseAsync()
    {
        var name = "odip_demo_" + Guid.NewGuid().ToString("N");
        NpgsqlConnection.ClearAllPools();            // a template can only be copied while nobody is connected to it
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await ExecuteAdminAsync($"CREATE DATABASE \"{name}\" TEMPLATE \"{_templateName}\"");
                break;
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.ObjectInUse && attempt < 5)
            {
                await Task.Delay(300);               // the migration connection is still closing on the server
            }
        }
        _databases.Add(name);
        return ConnectionStringFor(name);
    }

    // Unpooled, so no idle connection can keep a database from being copied as a template or dropped. The one test that measures speed
    // (T8) asks for a pool, because production has one: an unpooled idle tick mostly times connection setup.
    private string ConnectionStringFor(string database) =>
        new NpgsqlConnectionStringBuilder(_configured) { Database = database, Pooling = false }.ConnectionString;

    private async Task ExecuteAdminAsync(string sql)
    {
        await using var admin = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(_configured) { Pooling = false }.ConnectionString);
        await admin.OpenAsync();
        await using var command = new NpgsqlCommand(sql, admin);
        await command.ExecuteNonQueryAsync();
    }

    internal static ICurrentTenant SuperAdmin()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return tenant.Object;
    }

    public async Task DisposeAsync()
    {
        if (_configured is null) return;
        NpgsqlConnection.ClearAllPools();
        foreach (var name in _databases)
        {
            try { await ExecuteAdminAsync($"DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)"); }
            catch (Exception) { /* a scratch database that will not drop is the CI server's to clean up */ }
        }
    }
}

public partial class DemoDataPostgresTests : IClassFixture<DemoDataPostgresFixture>
{
    private readonly DemoDataPostgresFixture _pg;

    public DemoDataPostgresTests(DemoDataPostgresFixture pg) => _pg = pg;

    private void Require() => Skip.IfNot(_pg.Available, _pg.UnavailableReason);

    private static readonly DateTimeOffset Friday = new(2026, 10, 2, 0, 30, 0, TimeSpan.Zero);                // Fri 10:30 AEST
    private static readonly DateTimeOffset TwoMonthsOn = new(2026, 12, 2, 0, 30, 0, TimeSpan.Zero);          // Wed 11:30 AEDT

    /// <summary>Counts every command EF sends, so the idle tick's "at most 40 queries" is measured, not estimated.</summary>
    private sealed class CommandCounter : DbCommandInterceptor
    {
        private int _count;
        public int Count => Volatile.Read(ref _count);
        public void Reset() => Interlocked.Exchange(ref _count, 0);

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<object> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    private sealed class PgEnv
    {
        public string ConnectionString { get; }
        public FakeClock Clock { get; }
        public CommandCounter Counter { get; } = new();
        public CapturingLogger<DemoDataMaintainer> Log { get; } = new();

        /// <summary>Production's options: Npgsql with the audit interceptor, as AddDbContext wires every context.</summary>
        public DbContextOptions<OdipDbContext> AppOptions { get; }

        /// <summary>The same plus the command counter: what the maintainer under test is given.</summary>
        public DbContextOptions<OdipDbContext> CountedOptions { get; }

        /// <param name="pooled">Turns connection pooling on, as in production. The fixture hands out unpooled strings.</param>
        public PgEnv(string connectionString, DateTimeOffset now, bool pooled = false)
        {
            ConnectionString = pooled ? new NpgsqlConnectionStringBuilder(connectionString) { Pooling = true }.ConnectionString : connectionString;
            Clock = new FakeClock(now);
            var audit = new AuditInterceptor(new HttpContextAccessor());
            AppOptions = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(ConnectionString).AddInterceptors(audit).Options;
            CountedOptions = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(ConnectionString).AddInterceptors(audit, Counter).Options;
        }

        public OdipDbContext AdminDb() => new(AppOptions, DemoDataPostgresFixture.SuperAdmin());

        public DemoDataMaintainer Maintainer(IEnumerable<IDemoPack>? packs = null) =>
            new(new DemoDataOptions { Scenarios = DemoScenarioMode.On }, Clock, Log, packs ?? DemoPacks.Default());   // the real PostgresAdvisoryTickLock

        public async Task SeedOldSeedAsync()
        {
            await using var db = AdminDb();
            await db.Database.MigrateAsync();          // already migrated (a clone), but it is what Program.cs does first
            await DemoOldSeedTests.RunOldSeedAsync(db);
        }

        public async Task<DemoSnapshot> SnapshotAsync()
        {
            await using var db = AdminDb();
            return DemoSnapshot.Take(db);
        }
    }

    private async Task<PgEnv> NewEnvAsync(DateTimeOffset now, bool pooled = false) => new(await _pg.NewDatabaseAsync(), now, pooled);

    // Review L5: T8 has to measure what production runs, and production pools its connections. The fixture's databases are unpooled so they can
    // always be copied and dropped; the one test that measures speed asks for a pool. (Needs no server: nothing here opens a connection.)
    [Fact]
    public void TheEnvironmentIsUnpooledByDefault_AndPooledWhenATestThatMeasuresSpeedAsksForIt()
    {
        const string unpooled = "Host=localhost;Database=x;Username=u;Password=p;Pooling=false";

        Assert.False(new NpgsqlConnectionStringBuilder(new PgEnv(unpooled, Friday).ConnectionString).Pooling);
        Assert.True(new NpgsqlConnectionStringBuilder(new PgEnv(unpooled, Friday, pooled: true).ConnectionString).Pooling);
    }

    /// <summary>A snapshot key ("Type|id") whose id is a <see cref="DemoIds"/> id: name-based, version nibble 8.</summary>
    private static bool IsDemoId(string key) => Guid.TryParse(key[(key.IndexOf('|') + 1)..], out var id) && id.ToString("D")[14] == '8';

    // ── T1 ───────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Postgres_T1_TheFirstTickOnAFreshDatabase_BuildsTheDemo_AndASecondTickChangesNothing()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();                  // fresh database: migrate, old seed, then the first tick

        var first = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);
        var afterFirst = await env.SnapshotAsync();
        var second = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);
        var afterSecond = await env.SnapshotAsync();

        Assert.True(first.Status == DemoTickStatus.Ran, $"first tick: {first.Status} {first.Detail}");
        Assert.True(first.Failures.Count == 0, "first tick: " + string.Join("; ", first.Failures.Select(f => $"{f.Pack}: {f.Message}")));
        Assert.Empty(first.SkippedStories);
        Assert.True(first.RowsAdded.Values.Sum() > 150);
        Assert.Equal(DemoTickStatus.Ran, second.Status);
        Assert.Empty(second.Failures);
        Assert.Equal(0, second.RowsAdded.Values.Sum());
        var changes = afterFirst.Diff(afterSecond);
        Assert.True(changes.Count == 0, "a second tick changed: " + DemoSnapshot.Describe(changes));
    }

    [SkippableFact]
    public async Task Postgres_T1_TheUniqueIndexesAndForeignKeys_AcceptEveryRowTheTopUpWrites()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();

        await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);

        await using var db = env.AdminDb();
        Assert.Equal(13, await db.ShiftPatterns.CountAsync());
        Assert.Equal(await db.ShiftCompletions.CountAsync(), await db.ShiftCompletions.Select(c => c.ShiftId).Distinct().CountAsync());   // one active completion per shift
        Assert.Equal(10, await db.StaffParticipantCompatibilities.CountAsync());
        Assert.True(await db.Shifts.CountAsync() > 80);
        Assert.Equal(2, await db.BookingTasks.CountAsync(t => t.SourceKey != null && t.SourceKey.StartsWith("leave-coverage:")));
    }

    // ── T3 ───────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Postgres_T3_AnAgedLiveDatabase_KeepsEveryOldRow_ExceptTheCredentialColumnsOnTheStaff()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();
        var old = await env.SnapshotAsync();
        env.Clock.Set(TwoMonthsOn);

        var result = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);

        Assert.True(result.Failures.Count == 0, string.Join("; ", result.Failures.Select(f => $"{f.Pack}: {f.Message}")));
        var after = await env.SnapshotAsync();
        var oldRowChanges = old.Diff(after).Where(c => c.Kind != "added").ToList();
        Assert.DoesNotContain(oldRowChanges, c => c.Kind == "removed");
        Assert.True(oldRowChanges.All(c => DemoSnapshot.TypeOf(c.Key) == nameof(User)), DemoSnapshot.Describe(oldRowChanges));
        var allowed = DemoTenantGuard.ModifiableProperties[typeof(User)];
        Assert.All(oldRowChanges, c => Assert.True(c.Properties.All(allowed.Contains), $"{c.Key}: {string.Join(",", c.Properties)}"));

        // Calling the old seed again adds nothing (the top-up wrote the first row of none of the tables the old seed guards).
        await using (var db = env.AdminDb()) await DemoOldSeedTests.RunOldSeedAsync(db);
        var changes = after.Diff(await env.SnapshotAsync());
        Assert.True(changes.Count == 0, "the old seed, run again, changed: " + DemoSnapshot.Describe(changes));
    }

    // ── T8 ───────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Postgres_T8_TheFirstTickIsWithinFifteenSeconds_AndAnIdleTickIsUnder500msAndAHundredQueries()
    {
        Require();
        // Pooled, as production runs (review L5): unpooled, every one of an idle tick's dozen queries opens and authenticates a connection of
        // its own, so the budget would mostly time connection setup and could fail on a busy shared runner while saying nothing about prod.
        var env = await NewEnvAsync(Friday, pooled: true);
        await env.SeedOldSeedAsync();

        var started = Stopwatch.StartNew();
        var first = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);
        started.Stop();
        Assert.True(first.Failures.Count == 0, string.Join("; ", first.Failures.Select(f => $"{f.Pack}: {f.Message}")));
        Assert.True(started.Elapsed < TimeSpan.FromSeconds(15), $"the first tick took {started.Elapsed.TotalSeconds:0.0} s (budget 15 s)");

        // A maintainer that has already ticked once, so JIT and the pool are warm, and then ticks with nothing to do. The time budget is for
        // the fastest of three: a pause on a shared runner (a GC, a noisy neighbour) can stall one tick but not all three, whereas a
        // regression that makes every idle tick slow still fails. The command count is deterministic, so every tick must meet it.
        var maintainer = env.Maintainer();
        await maintainer.RunAsync(env.CountedOptions, CancellationToken.None);
        var millis = new List<long>();
        for (var i = 0; i < 3; i++)
        {
            env.Counter.Reset();
            var idle = Stopwatch.StartNew();
            var result = await maintainer.RunAsync(env.CountedOptions, CancellationToken.None);
            idle.Stop();

            Assert.Equal(DemoTickStatus.Ran, result.Status);
            Assert.Equal(0, result.RowsAdded.Values.Sum() + result.RowsChanged.Values.Sum());
            // The plan's 40 was for the roster packs of PR 1 (about 22 queries). PR 2's live set, medication chart, shift package and incidents add about 56
            // (78 in all, counted on EF InMemory by DemoIdleTickTests, which also proves the number does not grow as the demo ages), and a server sends a few
            // more (the advisory lock). So the budget is a hundred, which leaves about twenty of headroom: a tripwire for a query that runs per row, not a design
            // limit. The 500 ms below is the one that matters, and it is unchanged.
            Assert.True(env.Counter.Count <= 100, $"idle tick {i + 1} sent {env.Counter.Count} commands (budget 100)");
            millis.Add(idle.ElapsedMilliseconds);
        }

        Assert.True(millis.Min() < 500, $"the idle ticks took {string.Join(", ", millis)} ms (budget 500 ms for the fastest of three)");
    }

    // ── T9 ───────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Postgres_T9_TwoMaintainersRacing_OneSkipsOnTheAdvisoryLock_AndTheFinalRowsEqualASingleRun()
    {
        Require();
        var raced = await NewEnvAsync(Friday);
        var single = await NewEnvAsync(Friday);
        await raced.SeedOldSeedAsync();
        await single.SeedOldSeedAsync();

        var inside = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var blocker = DemoTestEnv.Pack("blocker", async (_, _) => { inside.TrySetResult(); await release.Task; });
        var packs = new List<IDemoPack> { blocker };
        packs.AddRange(DemoPacks.Default());

        var first = raced.Maintainer(packs).RunAsync(raced.CountedOptions, CancellationToken.None);
        await inside.Task.WaitAsync(TimeSpan.FromSeconds(60));                       // the first maintainer holds the lock and is inside a pack
        var second = await raced.Maintainer().RunAsync(raced.CountedOptions, CancellationToken.None);
        release.SetResult();
        var firstResult = await first;
        await single.Maintainer().RunAsync(single.CountedOptions, CancellationToken.None);

        Assert.Equal(DemoTickStatus.LockHeld, second.Status);
        Assert.Equal(DemoTickStatus.Ran, firstResult.Status);
        Assert.Empty(firstResult.Failures);
        var a = await raced.SnapshotAsync();
        var b = await single.SnapshotAsync();
        foreach (var type in new[] { "Shift", "ShiftPattern", "ShiftCompletion", "LeaveRequest", "RecurringUnavailability", "StaffAvailability", "StaffParticipantCompatibility", "Person", "ParticipantContactRole" })
        {
            // Only the top-up's rows: their ids are DemoIds (version nibble 8). The old seed makes some rows with random ids (its staff
            // availability), which differ between two databases that were each seeded on their own.
            Assert.Equal(
                b.Keys.Where(k => DemoSnapshot.TypeOf(k) == type && IsDemoId(k)).OrderBy(k => k, StringComparer.Ordinal).ToList(),
                a.Keys.Where(k => DemoSnapshot.TypeOf(k) == type && IsDemoId(k)).OrderBy(k => k, StringComparer.Ordinal).ToList());
        }
        Assert.True(a.Keys.Count(k => DemoSnapshot.TypeOf(k) == "Shift" && IsDemoId(k)) > 80);
        Assert.Equal(b.CountOf("BookingTask"), a.CountOf("BookingTask"));
    }

    [SkippableFact]
    public async Task Postgres_T9_TheTickLockIsReleasedAfterATick_SoTheNextOneRuns()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();

        var a = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);
        var b = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Ran, a.Status);
        Assert.Equal(DemoTickStatus.Ran, b.Status);
    }

    [SkippableFact]
    public async Task Postgres_T9_CompareAndSet_ARowAnotherWriterChangedAfterThePackReadItIsNotOverwritten()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();
        await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);
        Guid shiftId;
        await using (var db = env.AdminDb())
            shiftId = await db.Shifts.Where(s => s.Status == ShiftStatus.Published && s.ShiftPatternId != null).OrderBy(s => s.ServiceDate).Select(s => s.Id).FirstAsync();

        var cas = DemoTestEnv.Pack("cas", async (run, ct) =>
        {
            var shift = await run.Db.Shifts.SingleAsync(s => s.Id == shiftId, ct);       // inside the pack's REPEATABLE READ transaction: the snapshot is taken here
            await using (var other = new NpgsqlConnection(env.ConnectionString))         // somebody else (the owner, in the UI) edits the same row and commits
            {
                await other.OpenAsync(ct);
                await using var update = new NpgsqlCommand("UPDATE \"Shifts\" SET \"Notes\" = 'owner edit' WHERE \"Id\" = @id", other);
                update.Parameters.AddWithValue("id", shiftId);
                await update.ExecuteNonQueryAsync(ct);
            }
            shift.Status = ShiftStatus.Cancelled;                                         // the pack's own (guard-allowed) move, from the state it read
            shift.UpdatedAt = run.NowUtc;
            await run.SaveAsync(ct);                                                      // must fail: could not serialize access due to concurrent update
        });

        var result = await env.Maintainer(new IDemoPack[] { cas }).RunAsync(env.CountedOptions, CancellationToken.None);

        var failure = Assert.Single(result.Failures);
        Assert.Equal("cas", failure.Pack);
        Assert.True(failure.Conflict, $"expected a serialization conflict, got: {failure.Message}");
        await using var check = env.AdminDb();
        var row = await check.Shifts.SingleAsync(s => s.Id == shiftId);
        Assert.Equal("owner edit", row.Notes);
        Assert.Equal(ShiftStatus.Published, row.Status);                                   // the pack's move did not land
    }

    [SkippableFact]
    public async Task Postgres_T9_APackThatFails_RollsBackItsWholeTransaction_AndTheOthersStillCommit()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();
        var boom = DemoTestEnv.Pack("boom", async (run, ct) =>
        {
            run.Db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
            {
                Id = DemoIds.For("compatibility", "test", "boom"), TenantId = run.TenantId, UserId = run.Directory.Staff("james")!.Id,
                ParticipantId = run.Directory.Participant("sophie")!.Id, Level = CompatibilityLevel.Preferred,
            });
            await run.SaveAsync(ct);                       // committed inside the transaction ...
            throw new InvalidOperationException("a pack bug after a save");   // ... and rolled back with it
        });

        var result = await env.Maintainer(new IDemoPack[] { boom, new ProviderSettingsPackProbe() }).RunAsync(env.CountedOptions, CancellationToken.None);

        Assert.Single(result.Failures);
        await using var db = env.AdminDb();
        Assert.False(await db.StaffParticipantCompatibilities.AnyAsync(c => c.Id == DemoIds.For("compatibility", "test", "boom")), "the failed pack's save must roll back");
        Assert.Equal(1, await db.ProviderSettings.IgnoreQueryFilters().CountAsync(p => p.TenantId == DemoTestEnv.DemoTenantId));
    }

    /// <summary>The real ProviderSettings pack, standing for "a pack that runs after one that failed".</summary>
    private sealed class ProviderSettingsPackProbe : IDemoPack
    {
        private readonly Odip.Infrastructure.DemoData.Packs.ProviderSettingsPack _inner = new();
        public string Name => _inner.Name;
        public Task RunAsync(DemoRun run, CancellationToken ct) => _inner.RunAsync(run, ct);
    }
}
