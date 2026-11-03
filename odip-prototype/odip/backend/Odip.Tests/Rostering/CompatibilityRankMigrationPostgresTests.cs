using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): the AddCompatibilityRank backfill ranks Preferred rows only,
/// the participant's own pick first, then UpdatedAt, then Id, independently per participant and tenant; the Down puts Backup and Emergency rows back to Allowed.
/// </summary>
public class CompatibilityRankMigrationPostgresTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddCompatibilityRank";
    private const int Preferred = 0, Allowed = 1, Excluded = 2;

    private readonly PostgresFixture _pg;
    public CompatibilityRankMigrationPostgresTests(PostgresFixture pg) => _pg = pg;

    private static Task InsertAsync(NpgsqlConnection conn, string table, Dictionary<string, object?> values) =>
        ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, table, values);

    private static async Task<Guid> TenantAsync(NpgsqlConnection conn)
    {
        var tenant = Guid.NewGuid();
        await InsertAsync(conn, "Tenants", new() { ["Id"] = tenant, ["Name"] = "Provider", ["EmailDomain"] = $"{tenant:N}.example.com" });
        return tenant;
    }

    private static async Task<Guid> StaffAsync(NpgsqlConnection conn, Guid tenant)
    {
        var user = Guid.NewGuid();
        await InsertAsync(conn, "Users", new() { ["Id"] = user, ["TenantId"] = tenant, ["Username"] = "u" + user.ToString("N"), ["Email"] = $"{user:N}@example.com" });
        return user;
    }

    private static async Task<Guid> ParticipantAsync(NpgsqlConnection conn, Guid tenant, Guid? pick = null)
    {
        var participant = Guid.NewGuid();
        await InsertAsync(conn, "Participants", new() { ["Id"] = participant, ["TenantId"] = tenant, ["FirstName"] = "Amy", ["LastName"] = "Ng", ["PreferredUserId"] = pick });
        return participant;
    }

    /// <summary>The row's Id is chosen by the caller so the Id tie-break is deterministic.</summary>
    private static async Task<Guid> CellAsync(NpgsqlConnection conn, Guid tenant, Guid user, Guid participant, int level, DateTime updatedAt, string id = "")
    {
        var cell = id == "" ? Guid.NewGuid() : Guid.Parse(id);
        await InsertAsync(conn, "StaffParticipantCompatibilities", new()
        {
            ["Id"] = cell, ["TenantId"] = tenant, ["UserId"] = user, ["ParticipantId"] = participant, ["Level"] = level, ["UpdatedAt"] = updatedAt, ["AutoLinked"] = false,
        });
        return cell;
    }

    private static async Task<int> RankAsync(NpgsqlConnection conn, Guid cell)
    {
        await using var cmd = new NpgsqlCommand("SELECT \"Rank\" FROM \"StaffParticipantCompatibilities\" WHERE \"Id\" = @id", conn);
        cmd.Parameters.AddWithValue("id", cell);
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<(NpgsqlConnection Conn, IMigrator Migrator, string Before)> BeforeTheMigrationAsync()
    {
        var cs = await _pg.CreateDatabaseAsync();
        var db = PostgresFixture.NewContext(cs);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        var before = all[all.IndexOf(mine) - 1];
        await migrator.MigrateAsync(before);
        var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        return (conn, migrator, before);
    }

    [SkippableFact]
    public async Task TheBackfill_RanksPreferredRowsOnly_PickFirst_ThenUpdatedAt_ThenId_PerParticipantAndTenant()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (conn, migrator, _) = await BeforeTheMigrationAsync();
        await using var _c = conn;
        var (t1, t2) = (DateTime.SpecifyKind(new DateTime(2026, 1, 1), DateTimeKind.Unspecified), DateTime.SpecifyKind(new DateTime(2026, 2, 1), DateTimeKind.Unspecified));
        var tenantA = await TenantAsync(conn);
        var (u1, u2, u3, u4, u5, u6) = (await StaffAsync(conn, tenantA), await StaffAsync(conn, tenantA), await StaffAsync(conn, tenantA), await StaffAsync(conn, tenantA), await StaffAsync(conn, tenantA), await StaffAsync(conn, tenantA));

        // P1: the pick (u1) is the newest row and still ranks first; u2, u3, u4 tie on UpdatedAt and fall to Id.
        var p1 = await ParticipantAsync(conn, tenantA, pick: u1);
        var c1 = await CellAsync(conn, tenantA, u1, p1, Preferred, t2);
        var c4 = await CellAsync(conn, tenantA, u4, p1, Preferred, t1, "00000000-0000-0000-0000-000000000004");
        var c2 = await CellAsync(conn, tenantA, u2, p1, Preferred, t1, "00000000-0000-0000-0000-000000000002");
        var c3 = await CellAsync(conn, tenantA, u3, p1, Preferred, t1, "00000000-0000-0000-0000-000000000003");
        var allowed = await CellAsync(conn, tenantA, u5, p1, Allowed, t1);
        var excluded = await CellAsync(conn, tenantA, u6, p1, Excluded, t1);

        // P2: no pick at all, so UpdatedAt alone orders.
        var p2 = await ParticipantAsync(conn, tenantA, pick: null);
        var n1 = await CellAsync(conn, tenantA, u1, p2, Preferred, t2);
        var n2 = await CellAsync(conn, tenantA, u2, p2, Preferred, t1);

        // P3: the pick points at an Allowed row, which is not ranked and must not push a Preferred row down.
        var p3 = await ParticipantAsync(conn, tenantA, pick: u3);
        var a3 = await CellAsync(conn, tenantA, u3, p3, Allowed, t1);
        var q1 = await CellAsync(conn, tenantA, u1, p3, Preferred, t2);
        var q2 = await CellAsync(conn, tenantA, u2, p3, Preferred, t1);

        // Another tenant is ranked 1..n on its own.
        var tenantB = await TenantAsync(conn);
        var (v1, v2) = (await StaffAsync(conn, tenantB), await StaffAsync(conn, tenantB));
        var pb = await ParticipantAsync(conn, tenantB, pick: v2);
        var b1 = await CellAsync(conn, tenantB, v1, pb, Preferred, t1);
        var b2 = await CellAsync(conn, tenantB, v2, pb, Preferred, t2);

        await migrator.MigrateAsync();

        Assert.Equal(new[] { 1, 2, 3, 4 }, new[] { await RankAsync(conn, c1), await RankAsync(conn, c2), await RankAsync(conn, c3), await RankAsync(conn, c4) });
        Assert.Equal(0, await RankAsync(conn, allowed));
        Assert.Equal(0, await RankAsync(conn, excluded));
        Assert.Equal(new[] { 2, 1 }, new[] { await RankAsync(conn, n1), await RankAsync(conn, n2) });
        Assert.Equal(0, await RankAsync(conn, a3));
        Assert.Equal(new[] { 2, 1 }, new[] { await RankAsync(conn, q1), await RankAsync(conn, q2) });
        Assert.Equal(new[] { 2, 1 }, new[] { await RankAsync(conn, b1), await RankAsync(conn, b2) });
    }

    [SkippableFact]
    public async Task TheDown_PutsBackupAndEmergencyRowsBackToAllowed_ThenDropsTheColumn()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (conn, migrator, before) = await BeforeTheMigrationAsync();
        await using var _c = conn;
        var tenant = await TenantAsync(conn);
        var (u1, u2) = (await StaffAsync(conn, tenant), await StaffAsync(conn, tenant));
        var p = await ParticipantAsync(conn, tenant);
        await migrator.MigrateAsync();
        await using (var insert = new NpgsqlCommand(
            "INSERT INTO \"StaffParticipantCompatibilities\" (\"Id\",\"TenantId\",\"UserId\",\"ParticipantId\",\"Level\",\"Rank\",\"UpdatedAt\",\"AutoLinked\") VALUES " +
            "(gen_random_uuid(), @t, @u1, @p, 3, 1, now(), false), (gen_random_uuid(), @t, @u2, @p, 4, 1, now(), false)", conn))
        {
            insert.Parameters.AddWithValue("t", tenant); insert.Parameters.AddWithValue("u1", u1); insert.Parameters.AddWithValue("u2", u2); insert.Parameters.AddWithValue("p", p);
            await insert.ExecuteNonQueryAsync();
        }

        await migrator.MigrateAsync(before);

        await using var levels = new NpgsqlCommand("SELECT \"Level\" FROM \"StaffParticipantCompatibilities\"", conn);
        var found = new List<int>();
        await using (var reader = await levels.ExecuteReaderAsync()) while (await reader.ReadAsync()) found.Add(reader.GetInt32(0));
        Assert.Equal(new[] { 1, 1 }, found);
        await using var column = new NpgsqlCommand("SELECT count(*) FROM information_schema.columns WHERE table_name = 'StaffParticipantCompatibilities' AND column_name = 'Rank'", conn);
        Assert.Equal(0L, await column.ExecuteScalarAsync());
    }
}
