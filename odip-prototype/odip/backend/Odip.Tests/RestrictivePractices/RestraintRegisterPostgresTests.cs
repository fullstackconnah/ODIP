using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
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
        var (a1, a2, b1, b2, c1, c2, d1, d2) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        Guid medA, medB, medC, medD;
        await using (var conn = new NpgsqlConnection(cs))
        {
            await conn.OpenAsync();
            var (tenant, participant) = await InsertParentsAsync(conn);
            medA = await InsertMedicationAsync(conn, tenant, participant);
            medB = await InsertMedicationAsync(conn, tenant, participant);
            medC = await InsertMedicationAsync(conn, tenant, participant);
            medD = await InsertMedicationAsync(conn, tenant, participant);
            // (a) two authorised rows: the later authorisation date wins, even though it is the newer row.
            await InsertEntryAsync(conn, tenant, participant, medA, true, t0, "Dr Chen", new DateOnly(2026, 1, 1), a1);
            await InsertEntryAsync(conn, tenant, participant, medA, true, t0.AddDays(1), "Dr Chen", new DateOnly(2026, 6, 1), a2);
            // (b) unauthorised: the active one wins over the older inactive one.
            await InsertEntryAsync(conn, tenant, participant, medB, false, t0, id: b1);
            await InsertEntryAsync(conn, tenant, participant, medB, true, t0.AddDays(1), id: b2);
            // (c) both unauthorised and active: the oldest wins.
            await InsertEntryAsync(conn, tenant, participant, medC, true, t0, id: c1);
            await InsertEntryAsync(conn, tenant, participant, medC, true, t0.AddDays(1), id: c2);
            // (d) an inactive authorised row loses to an active unauthorised one: the keeper must stay active.
            await InsertEntryAsync(conn, tenant, participant, medD, false, t0, "Dr Chen", new DateOnly(2026, 1, 1), d1);
            await InsertEntryAsync(conn, tenant, participant, medD, true, t0.AddDays(1), id: d2);
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
        Assert.Equal((true, (Guid?)medD), await ReadAsync(after, d2));
        Assert.Equal((false, (Guid?)null), await ReadAsync(after, d1));
        await using var count = new NpgsqlCommand("SELECT count(*) FROM \"RestrictivePractices\"", after);
        Assert.Equal(8L, await count.ExecuteScalarAsync());
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

    [SkippableFact]
    public async Task Migration_BackfillsReportingFromMonth_ToTheSydneyDeployMonth()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(cs);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(BeforeMigration);
        var entry = Guid.NewGuid();
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        var (tenant, participant) = await InsertParentsAsync(conn);
        await InsertEntryAsync(conn, tenant, participant, null, true, new DateTime(2026, 1, 5, 0, 0, 0, DateTimeKind.Unspecified), id: entry);

        await migrator.MigrateAsync();

        var sydney = TimeZoneInfo.ConvertTime(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney"));
        await using var cmd = new NpgsqlCommand("SELECT \"ReportingFromMonth\", \"UseKind\" FROM \"RestrictivePractices\" WHERE \"Id\" = @i", conn);
        cmd.Parameters.AddWithValue("i", entry);
        await using var r = await cmd.ExecuteReaderAsync();
        Assert.True(await r.ReadAsync());
        Assert.Equal(new DateOnly(sydney.Year, sydney.Month, 1), r.GetFieldValue<DateOnly>(0));
        Assert.Equal(0, r.GetInt32(1));
    }

    [SkippableFact]
    public async Task NewDateColumns_RoundTrip_AndEarliestUseGroupsOnNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(cs);
        await db.Database.MigrateAsync();
        var (entry, user) = (Guid.NewGuid(), Guid.NewGuid());
        Guid participant;
        await using (var conn = new NpgsqlConnection(cs))
        {
            await conn.OpenAsync();
            var parents = await InsertParentsAsync(conn);
            participant = parents.Participant;
            await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "Users", new() { ["Id"] = user, ["TenantId"] = parents.Tenant, ["Username"] = "u" + user.ToString("N"), ["Email"] = $"{user:N}@example.com" });
            await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "RestrictivePractices", new()
            {
                ["Id"] = entry, ["TenantId"] = parents.Tenant, ["ParticipantId"] = participant, ["IsActive"] = true, ["Type"] = 4, ["Description"] = "Physical hold",
                ["AuthorisedBy"] = "Dr Chen", ["AuthorisationDate"] = new DateOnly(2026, 1, 1), ["AuthorisationEndDate"] = new DateOnly(2027, 1, 1), ["FirstUsedOn"] = new DateOnly(2026, 10, 1),
                ["InterimBspDate"] = new DateOnly(2026, 10, 20), ["UseKind"] = 1, ["CreatedAt"] = DateTime.UtcNow, ["UpdatedAt"] = DateTime.UtcNow,
            });
            foreach (var day in new[] { 9, 5 })
                await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "IncidentReports", new()
                {
                    ["Id"] = Guid.NewGuid(), ["TenantId"] = parents.Tenant, ["ReportedByUserId"] = user, ["IncidentType"] = (int)IncidentType.RestrictivePracticeUse,
                    ["RestrictivePracticeId"] = entry, ["IsActive"] = true, ["IncidentDateTime"] = new DateTime(2026, 3, day, 8, 0, 0, DateTimeKind.Unspecified),
                });
        }

        var controller = new RestrictivePracticesController(db, new SafetyNoteSyncService(db), FakeClock.AtUtc(2026, 10, 31, 2, 0));
        var result = await controller.GetForParticipant(participant, includeInactive: false, CancellationToken.None);

        var dto = Assert.Single(Assert.IsType<ApiResponse<List<RestrictivePracticeDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!);
        Assert.Equal(new DateOnly(2026, 3, 5), dto.EarliestRecordedUseDate);
        Assert.Equal(new DateOnly(2027, 1, 1), dto.AuthorisationEndDate);
        Assert.Equal(RestrictivePracticeUseKind.Prn, dto.UseKind);
        Assert.Equal(BspPlanState.InPlace, dto.InterimBspState);
        Assert.Equal(new DateOnly(2027, 4, 1), dto.ComprehensiveBspDueOn);
    }
}
