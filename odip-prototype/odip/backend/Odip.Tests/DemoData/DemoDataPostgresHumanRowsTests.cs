using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The second half of PR 2 review finding H1, against a real PostgreSQL (the first half is <see cref="DemoHumanRowsTests"/>, on EF InMemory with the
/// <see cref="UniqueIndexEmulator"/>): a person's own row beside the script's must not make a pack roll back for good, and one live shift the database
/// refuses must not take the others with it. Runs where POSTGRES_CONNECTION_STRING names a server and skips otherwise, like the rest of
/// <see cref="DemoDataPostgresTests"/>; a skip proves nothing, so the PR body carries the CI run.
/// </summary>
public partial class DemoDataPostgresTests
{
    /// <summary>True for an id <see cref="DemoIds"/> made (name-based, version nibble 8): the script's own row, as against a person's (random, version 4).</summary>
    private static bool IsDemoGuid(Guid id) => id.ToString("D")[14] == '8';

    private static string Describe(string tick, DemoTickResult result) =>
        tick + ": " + (result.Failures.Count == 0 ? "no failures" : string.Join("; ", result.Failures.Select(f => $"{f.Pack}: {f.Message}")));

    private static async Task ExecuteSqlAsync(PgEnv env, string sql)
    {
        await using var connection = new NpgsqlConnection(env.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static string TableOf<T>(PgEnv env) where T : class
    {
        using var db = env.AdminDb();
        return db.Model.FindEntityType(typeof(T))!.GetTableName()!;
    }

    /// <summary>What the database holds under the three natural keys the app enforces, and how many of those rows are the script's own (a demo id).</summary>
    private sealed record KeyedRows(int Acknowledgements, int Ticks, int RunningBreaks, int ScriptsOwn);

    private static async Task<KeyedRows> KeyedRowsAsync(PgEnv env)
    {
        await using var db = env.AdminDb();
        var acks = await db.HandoverAcknowledgements.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        var ticks = await db.ShiftRoutineChecks.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        var running = await db.ShiftBreaks.IgnoreQueryFilters().AsNoTracking().Where(b => b.EndedAt == null).ToListAsync();
        return new KeyedRows(acks.Count, ticks.Count, running.Count,
            acks.Count(a => IsDemoGuid(a.Id)) + ticks.Count(t => IsDemoGuid(t.Id)) + running.Count(b => IsDemoGuid(b.Id)));
    }

    [SkippableFact]
    public async Task Postgres_H1_APersonsOwnRowForAKeyTheScriptWrites_IsKept_AndNeitherPackRollsBackOnTheDuplicate()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();
        var first = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);
        Assert.True(first.Failures.Count == 0, Describe("first tick", first));

        // Everything the app holds to a natural key becomes "a person's own": the same row with a random id where the script's is deterministic. The
        // second tick wants to write all of it again; without the key lookups it inserts a second row for each key, the database refuses (23505) and
        // the live set and the history pack roll back and fail on every tick after.
        await ExecuteSqlAsync(env,
            "UPDATE \"HandoverAcknowledgements\" SET \"Id\" = gen_random_uuid(); " +
            "UPDATE \"ShiftRoutineChecks\" SET \"Id\" = gen_random_uuid(); " +
            "UPDATE \"ShiftBreaks\" SET \"Id\" = gen_random_uuid() WHERE \"EndedAt\" IS NULL");
        var before = await KeyedRowsAsync(env);
        Assert.True(before.Acknowledgements > 0 && before.Ticks > 0 && before.RunningBreaks > 0, "the first tick should have written rows under all three keys");
        Assert.Equal(0, before.ScriptsOwn);

        var second = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);

        Assert.True(second.Failures.Count == 0, Describe("second tick", second));
        Assert.Equal(before, await KeyedRowsAsync(env));                                       // nothing beside a person's row, and nothing of the script's own
    }

    [SkippableFact]
    public async Task Postgres_H1_TheDatabaseRefusesASecondRowForEachNaturalKey_WithTheIndexNameTheEmulatorGives()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();
        await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);

        await AssertTwinRefusedAsync(env, db => db.HandoverAcknowledgements.IgnoreQueryFilters().FirstAsync(), HandoverAcknowledgement.UniqueReaderIndexName);
        await AssertTwinRefusedAsync(env, db => db.ShiftRoutineChecks.IgnoreQueryFilters().FirstAsync(t => t.ScheduledAt != null), ShiftRoutineCheck.UniqueTimedIndexName);
        await AssertTwinRefusedAsync(env, db => db.ShiftBreaks.IgnoreQueryFilters().FirstAsync(b => b.EndedAt == null), ShiftBreak.OneRunningIndexName);
    }

    /// <summary>The same row under a new random id: what a person's own row looks like to the script, and what <see cref="UniqueIndexEmulator"/> stands in for.</summary>
    private static async Task AssertTwinRefusedAsync<T>(PgEnv env, Func<OdipDbContext, Task<T>> load, string index) where T : class
    {
        await using var db = env.AdminDb();
        var row = await load(db);
        var values = db.Entry(row).CurrentValues.Clone();
        values["Id"] = Guid.NewGuid();
        db.Add(values.ToObject());

        var refused = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        var inner = Assert.IsType<PostgresException>(refused.InnerException);
        Assert.Equal(PostgresErrorCodes.UniqueViolation, inner.SqlState);
        Assert.Equal(index, inner.ConstraintName);
    }

    [SkippableFact]
    public async Task Postgres_H1_OneLiveShiftTheDatabaseRefuses_IsUndoneWhole_AndTheOtherShiftsAndLaterPacksCommit_AndTheNextTickHealsIt()
    {
        Require();
        var env = await NewEnvAsync(Friday);
        await env.SeedOldSeedAsync();
        var morning = LiveSetCatalog.ShiftId(LiveSetCatalog.Morning, DemoLive.Friday);
        var insulin = LiveSetCatalog.ShiftId(LiveSetCatalog.Insulin, DemoLive.Friday);
        var refused = LiveSetCatalog.MorningNote(DemoLive.Friday);                              // Sophie's note of today, written at 10:05
        var table = TableOf<ShiftNote>(env);
        var constraint = string.Format(CultureInfo.InvariantCulture, "\"CK_{0}_test_refuses_one_note\"", table);
        await ExecuteSqlAsync(env, string.Format(CultureInfo.InvariantCulture,
            "ALTER TABLE \"{0}\" ADD CONSTRAINT {1} CHECK (\"ShiftId\" <> '{2}' OR \"Body\" <> '{3}')", table, constraint, morning, refused.Replace("'", "''", StringComparison.Ordinal)));

        var tick = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);

        // One piece failed, by name, and was reported as a failure that is not a conflict (a database refusal, not a race).
        var failure = Assert.Single(tick.Failures);
        Assert.StartsWith("live-set: live-morning 2026-10-02", failure.Pack, StringComparison.Ordinal);
        Assert.False(failure.Conflict, failure.Message);

        await using (var db = env.AdminDb())
        {
            // It was undone whole: the shift is as the pack found it, with no start, no completion and no note of the day.
            Assert.False(await db.ShiftCompletions.IgnoreQueryFilters().AnyAsync(c => c.ShiftId == morning), "the shift's start was undone with the rest of it");
            Assert.Equal(ShiftStatus.Published, (await db.Shifts.IgnoreQueryFilters().SingleAsync(s => s.Id == morning)).Status);
            Assert.DoesNotContain(await db.ShiftNotes.IgnoreQueryFilters().Where(n => n.ShiftId == morning).Select(n => n.Body).ToListAsync(), body => body == refused);

            // The other shifts of the pack were worked as if it had not been there: Harrison's today (with his running break) and every shift of yesterday.
            var harrison = await db.ShiftCompletions.IgnoreQueryFilters().SingleAsync(c => c.ShiftId == insulin && c.IsActive);
            Assert.True(await db.ShiftBreaks.IgnoreQueryFilters().AnyAsync(b => b.ShiftCompletionId == harrison.Id && b.EndedAt == null), "his running break");
            var yesterday = LiveSetCatalog.Stories.Select(s => LiveSetCatalog.ShiftId(s, DemoLive.Friday.AddDays(-1))).ToList();
            var finished = await db.ShiftCompletions.IgnoreQueryFilters().Where(c => yesterday.Contains(c.ShiftId) && c.IsActive).ToListAsync();
            Assert.Equal(yesterday.Count, finished.Count);
            Assert.All(finished, c => Assert.NotNull(c.SubmittedAt));
        }

        // And the packs after the live set committed: a failed piece is inside its savepoint, so it does not poison the transaction.
        Assert.Contains(tick.RowsAdded.Keys, k => k.StartsWith("medication-history/", StringComparison.Ordinal));
        Assert.Contains(tick.RowsAdded.Keys, k => k.StartsWith("incidents/", StringComparison.Ordinal));

        // With the database willing again, the next tick works the shift as normal: the note is written once.
        await ExecuteSqlAsync(env, string.Format(CultureInfo.InvariantCulture, "ALTER TABLE \"{0}\" DROP CONSTRAINT {1}", table, constraint));
        var healing = await env.Maintainer().RunAsync(env.CountedOptions, CancellationToken.None);

        Assert.True(healing.Failures.Count == 0, Describe("the tick after", healing));
        await using var check = env.AdminDb();
        var notes = await check.ShiftNotes.IgnoreQueryFilters().Where(n => n.ShiftId == morning).Select(n => n.Body).ToListAsync();
        Assert.Single(notes, body => body == refused);
        Assert.Single(notes, body => body == LiveSetCatalog.InjuryNote);                          // the incidents pack's own note, written in the first tick and never twice
        Assert.True(await check.ShiftCompletions.IgnoreQueryFilters().AnyAsync(c => c.ShiftId == morning && c.IsActive));
    }
}
