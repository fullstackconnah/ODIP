using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The migration that adds ShiftCompletions.ExtraTime, run over completions written before it (skipped, never failed, when POSTGRES_CONNECTION_STRING is unset): the backfill is SQL, so only a
/// real database proves it starts Pending ONLY the never-sent, active, PendingReview completions over 5 minutes early or late, and leaves every other row null.
/// </summary>
public class ExtraTimeBackfillMigrationTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddShiftCompletionExtraTime";

    private readonly PostgresFixture _pg;
    public ExtraTimeBackfillMigrationTests(PostgresFixture pg) => _pg = pg;

    private static async Task ExecAsync(NpgsqlConnection conn, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value);
        await cmd.ExecuteNonQueryAsync();
    }

    // Name, shift status (5 PendingReview, 2 Completed), start variance, end variance, active, already in the Employment Hero outbox, expected ExtraTime (0 Pending, null none).
    private static readonly (string Name, int Status, int Start, int End, bool Active, bool Sent, int? Expected)[] Cases =
    [
        ("early", 5, -20, 0, true, false, 0),
        ("late", 5, 0, 10, true, false, 0),
        ("within", 5, -5, 5, true, false, null),
        ("late-start-early-finish", 5, 20, -20, true, false, null),
        ("completed", 2, -20, 0, true, false, null),
        ("already-sent", 5, -20, 0, true, true, null),
        ("superseded", 5, -20, 0, false, false, null),
    ];

    [SkippableFact]
    public async Task Only_never_sent_active_pending_review_completions_over_five_minutes_start_pending()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);

        var tenant = Guid.NewGuid();
        var ids = new Dictionary<string, Guid>();
        await using (var conn = new NpgsqlConnection(connectionString))
        {
            await conn.OpenAsync();
            await ExecAsync(conn, "SET session_replication_role = replica");   // the rows below skip the participant and worker they would point at
            foreach (var c in Cases)
            {
                var shift = Guid.NewGuid();
                var completion = Guid.NewGuid();
                ids[c.Name] = completion;
                await ExecAsync(conn,
                    "INSERT INTO \"Shifts\" (\"Id\",\"TenantId\",\"ParticipantId\",\"ServiceDate\",\"StartTime\",\"EndTime\",\"EndsNextDay\",\"NightType\",\"Ratio\",\"Status\",\"ReturnCount\",\"CreatedAt\",\"UpdatedAt\") " +
                    "VALUES (@s,@t,@p,'2026-11-03','09:00','15:00',false,0,0,@st,0,now(),now())", ("s", shift), ("t", tenant), ("p", Guid.NewGuid()), ("st", c.Status));
                await ExecAsync(conn,
                    "INSERT INTO \"ShiftCompletions\" (\"Id\",\"TenantId\",\"ShiftId\",\"ActualStart\",\"StartedAt\",\"TimeZoneId\",\"SubmittedByUserId\",\"IsActive\",\"GeolocationDeclined\",\"NothingToHandOver\",\"NothingToNoteConfirmed\"," +
                    "\"SentFromOffline\",\"StartWasManual\",\"VarianceMinutesStart\",\"VarianceMinutesEnd\",\"CreatedAt\",\"UpdatedAt\") " +
                    "VALUES (@c,@t,@s,now(),now(),'Australia/Sydney',@u,@a,false,false,false,false,false,@vs,@ve,now(),now())",
                    ("c", completion), ("t", tenant), ("s", shift), ("u", Guid.NewGuid()), ("a", c.Active), ("vs", c.Start), ("ve", c.End));
                if (c.Sent)
                    await ExecAsync(conn,
                        "INSERT INTO \"EmploymentHeroOutbox\" (\"Id\",\"TenantId\",\"Kind\",\"EntityId\",\"Status\",\"Attempts\",\"NextAttemptAt\",\"CreatedAt\",\"UpdatedAt\") VALUES (@id,@t,0,@e,1,1,now(),now(),now())",
                        ("id", Guid.NewGuid()), ("t", tenant), ("e", completion));
            }
        }

        await migrator.MigrateAsync();

        await using var check = new NpgsqlConnection(connectionString);
        await check.OpenAsync();
        foreach (var c in Cases)
        {
            await using var cmd = new NpgsqlCommand("SELECT \"ExtraTime\" FROM \"ShiftCompletions\" WHERE \"Id\" = @id", check);
            cmd.Parameters.AddWithValue("id", ids[c.Name]);
            var value = await cmd.ExecuteScalarAsync();
            Assert.True(c.Expected == (value is DBNull or null ? null : (int)value), $"{c.Name}: expected {c.Expected?.ToString() ?? "null"}, got {value}");
        }
    }
}
