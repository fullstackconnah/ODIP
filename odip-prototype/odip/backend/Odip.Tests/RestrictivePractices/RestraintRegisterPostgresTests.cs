using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.RestrictivePractices;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): the M16 migration that links restraint medicines to the
/// register. It must dedupe any pre-existing double links BEFORE it adds the unique index, or migrate throws and the API crash-loops on boot.
/// </summary>
public class RestraintRegisterPostgresTests : IClassFixture<PostgresFixture>
{
    private const string BeforeMigration = "20261027100000_AddShiftCompletionSentFromOffline";
    private const string DemoRisperidoneEntry = "75000000-0000-0000-0000-000000000003";
    private readonly PostgresFixture _pg;
    public RestraintRegisterPostgresTests(PostgresFixture pg) => _pg = pg;

    private static async Task<(Guid Tenant, Guid Participant)> InsertParentsAsync(NpgsqlConnection conn)
    {
        var (tenant, participant) = (Guid.NewGuid(), Guid.NewGuid());
        await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "Tenants", new() { ["Id"] = tenant, ["Name"] = "Provider", ["EmailDomain"] = $"{tenant:N}.example.com" });
        await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "Participants", new() { ["Id"] = participant, ["TenantId"] = tenant, ["FirstName"] = "Sophie", ["LastName"] = "Brown" });
        return (tenant, participant);
    }

    private static async Task<Guid> InsertMedicationAsync(NpgsqlConnection conn, Guid tenant, Guid participant)
    {
        var med = Guid.NewGuid();
        await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "ParticipantMedications", new() { ["Id"] = med, ["TenantId"] = tenant, ["ParticipantId"] = participant, ["Name"] = "Risperidone" });
        return med;
    }

    private static Task InsertEntryAsync(NpgsqlConnection conn, Guid tenant, Guid participant, Guid? med, bool active, DateTime createdAt, string? by = null, DateOnly? on = null, Guid? id = null) =>
        ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "RestrictivePractices", new()
        {
            ["Id"] = id ?? Guid.NewGuid(), ["TenantId"] = tenant, ["ParticipantId"] = participant, ["RelatedMedicationId"] = med, ["IsActive"] = active,
            ["Type"] = 1, ["Description"] = "Chemical restraint", ["AuthorisedBy"] = by, ["AuthorisationDate"] = on, ["CreatedAt"] = createdAt, ["UpdatedAt"] = createdAt,
        });

    private static async Task<(bool Active, Guid? Med)> ReadAsync(NpgsqlConnection conn, Guid id)
    {
        await using var cmd = new NpgsqlCommand("SELECT \"IsActive\", \"RelatedMedicationId\" FROM \"RestrictivePractices\" WHERE \"Id\" = @i", conn);
        cmd.Parameters.AddWithValue("i", id);
        await using var r = await cmd.ExecuteReaderAsync();
        Assert.True(await r.ReadAsync());
        return (r.GetBoolean(0), r.IsDBNull(1) ? null : r.GetGuid(1));
    }

    [SkippableFact]
    public async Task Migration_Dedupe_KeepsAuthorisedLatest_ThenActive_ThenOldest()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(cs);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(BeforeMigration);

        var t0 = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Unspecified);
        var (a1, a2, b1, b2, c1, c2) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        Guid medA, medB, medC;
        await using (var conn = new NpgsqlConnection(cs))
        {
            await conn.OpenAsync();
            var (tenant, participant) = await InsertParentsAsync(conn);
            medA = await InsertMedicationAsync(conn, tenant, participant);
            medB = await InsertMedicationAsync(conn, tenant, participant);
            medC = await InsertMedicationAsync(conn, tenant, participant);
            // (a) two authorised rows: the later authorisation date wins, even though it is the newer row.
            await InsertEntryAsync(conn, tenant, participant, medA, true, t0, "Dr Chen", new DateOnly(2026, 1, 1), a1);
            await InsertEntryAsync(conn, tenant, participant, medA, true, t0.AddDays(1), "Dr Chen", new DateOnly(2026, 6, 1), a2);
            // (b) unauthorised: the active one wins over the older inactive one.
            await InsertEntryAsync(conn, tenant, participant, medB, false, t0, id: b1);
            await InsertEntryAsync(conn, tenant, participant, medB, true, t0.AddDays(1), id: b2);
            // (c) both unauthorised and active: the oldest wins.
            await InsertEntryAsync(conn, tenant, participant, medC, true, t0, id: c1);
            await InsertEntryAsync(conn, tenant, participant, medC, true, t0.AddDays(1), id: c2);
        }

        await migrator.MigrateAsync();

        await using var after = new NpgsqlConnection(cs);
        await after.OpenAsync();
        Assert.Equal((true, (Guid?)medA), await ReadAsync(after, a2));
        Assert.Equal((false, (Guid?)null), await ReadAsync(after, a1));
        Assert.Equal((true, (Guid?)medB), await ReadAsync(after, b2));
        Assert.Equal((false, (Guid?)null), await ReadAsync(after, b1));
        Assert.Equal((true, (Guid?)medC), await ReadAsync(after, c1));
        Assert.Equal((false, (Guid?)null), await ReadAsync(after, c2));
        await using var count = new NpgsqlCommand("SELECT count(*) FROM \"RestrictivePractices\"", after);
        Assert.Equal(6L, await count.ExecuteScalarAsync());
    }

    [SkippableFact]
    public async Task Migration_UniqueIndex_RefusesSecondLink_ButAllowsManyUnlinkedRows()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(cs);
        await db.GetService<IMigrator>().MigrateAsync();

        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        var (tenant, participant) = await InsertParentsAsync(conn);
        var med = await InsertMedicationAsync(conn, tenant, participant);

        await using (var def = new NpgsqlCommand("SELECT indexdef FROM pg_indexes WHERE tablename = 'RestrictivePractices' AND indexdef LIKE '%RelatedMedicationId%'", conn))
        {
            var indexdef = Assert.IsType<string>(await def.ExecuteScalarAsync());
            Assert.Contains("UNIQUE", indexdef);
            Assert.Contains("WHERE (\"RelatedMedicationId\" IS NOT NULL)", indexdef);
        }

        var now = DateTime.UtcNow;
        await InsertEntryAsync(conn, tenant, participant, med, true, now);
        var failure = await Assert.ThrowsAsync<PostgresException>(() => InsertEntryAsync(conn, tenant, participant, med, false, now));
        Assert.Equal("23505", failure.SqlState);

        await InsertEntryAsync(conn, tenant, participant, null, true, now);
        await InsertEntryAsync(conn, tenant, participant, null, true, now);
    }

    [SkippableFact]
    public async Task Migration_DemoHeal_OnlyTouchesTheDemoRowWhileItsAuthoriserIsNull()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var demo = Guid.Parse(DemoRisperidoneEntry);
        var created = new DateTime(2026, 8, 2, 0, 0, 0, DateTimeKind.Unspecified);
        var (blankDb, keptDb) = (await _pg.CreateDatabaseAsync(), await _pg.CreateDatabaseAsync());
        foreach (var (cs, by, on) in new[] { (blankDb, (string?)null, (DateOnly?)null), (keptDb, "Dr Existing", (DateOnly?)new DateOnly(2026, 3, 3)) })
        {
            await using var db = PostgresFixture.NewContext(cs);
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync(BeforeMigration);
            await using (var conn = new NpgsqlConnection(cs))
            {
                await conn.OpenAsync();
                var (tenant, participant) = await InsertParentsAsync(conn);
                await InsertEntryAsync(conn, tenant, participant, await InsertMedicationAsync(conn, tenant, participant), true, created, by, on, demo);
            }
            await migrator.MigrateAsync();
        }

        async Task<(string? By, DateOnly? On)> AuthoriserAsync(string cs)
        {
            await using var conn = new NpgsqlConnection(cs);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("SELECT \"AuthorisedBy\", \"AuthorisationDate\" FROM \"RestrictivePractices\" WHERE \"Id\" = @i", conn);
            cmd.Parameters.AddWithValue("i", demo);
            await using var r = await cmd.ExecuteReaderAsync();
            Assert.True(await r.ReadAsync());
            return (r.IsDBNull(0) ? null : r.GetString(0), r.IsDBNull(1) ? null : r.GetFieldValue<DateOnly>(1));
        }

        Assert.Equal(("QLD Senior Practitioner", (DateOnly?)new DateOnly(2026, 8, 2)), await AuthoriserAsync(blankDb));
        Assert.Equal(("Dr Existing", (DateOnly?)new DateOnly(2026, 3, 3)), await AuthoriserAsync(keptDb));
    }
}
