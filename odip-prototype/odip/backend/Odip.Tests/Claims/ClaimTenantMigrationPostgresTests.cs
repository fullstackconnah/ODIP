using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): the ClaimTenantId migration gives every claim its trip's or participant's organisation and every line its claim's,
/// stops (and rolls back) when a claim has no single organisation, and the startup heal repairs a claim filed by a rolled-back image.
/// </summary>
public class ClaimTenantMigrationPostgresTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "ClaimTenantId";
    private readonly PostgresFixture _pg;
    public ClaimTenantMigrationPostgresTests(PostgresFixture pg) => _pg = pg;

    private static async Task InsertAsync(NpgsqlConnection conn, string table, Dictionary<string, object?> values) =>
        await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, table, values);

    private static async Task<Guid> PlantTenantAsync(NpgsqlConnection conn)
    {
        var tenant = Guid.NewGuid();
        await InsertAsync(conn, "Tenants", new() { ["Id"] = tenant, ["Name"] = "Provider", ["EmailDomain"] = $"{tenant:N}.example.com" });
        return tenant;
    }

    private static async Task<Guid> PlantTripAsync(NpgsqlConnection conn, Guid tenant)
    {
        var trip = Guid.NewGuid();
        await InsertAsync(conn, "TripInstances", new() { ["Id"] = trip, ["TenantId"] = tenant, ["TripName"] = "Trip" });
        return trip;
    }

    private static async Task<Guid> PlantParticipantAsync(NpgsqlConnection conn, Guid tenant)
    {
        var participant = Guid.NewGuid();
        await InsertAsync(conn, "Participants", new() { ["Id"] = participant, ["TenantId"] = tenant, ["FirstName"] = "Ada", ["LastName"] = "Claim" });
        return participant;
    }

    /// <summary>A line must hang on a booking or a shift (CK_ClaimLineItem_ExactlyOneParent): this is a shift of a participant of an organisation of its own, which the migration never reads.</summary>
    private static async Task<Guid> PlantShiftAsync(NpgsqlConnection conn)
    {
        var shift = Guid.NewGuid();
        var tenant = await PlantTenantAsync(conn);
        await InsertAsync(conn, "Shifts", new() { ["Id"] = shift, ["TenantId"] = tenant, ["ParticipantId"] = await PlantParticipantAsync(conn, tenant) });
        return shift;
    }

    /// <summary>A claim with one line; the claim's trip and participant are optional, the column TenantId is only written when the schema has it.</summary>
    private static async Task<(Guid Claim, Guid Line)> PlantClaimAsync(NpgsqlConnection conn, Guid? trip, Guid? participant, Guid? tenant = null)
    {
        var (claim, line) = (Guid.NewGuid(), Guid.NewGuid());
        var values = new Dictionary<string, object?> { ["Id"] = claim, ["Kind"] = trip is null ? 1 : 0, ["Status"] = 0, ["ClaimReference"] = $"TC-{claim:N}", ["TripInstanceId"] = trip, ["ParticipantId"] = participant };
        var lineValues = new Dictionary<string, object?> { ["Id"] = line, ["TripClaimId"] = claim, ["ShiftId"] = await PlantShiftAsync(conn) };
        if (tenant is not null) { values["TenantId"] = tenant; lineValues["TenantId"] = tenant; }
        await InsertAsync(conn, "TripClaims", values);
        await InsertAsync(conn, "ClaimLineItems", lineValues);
        return (claim, line);
    }

    private static async Task<Guid?> TenantOfAsync(NpgsqlConnection conn, string table, Guid id)
    {
        await using var cmd = new NpgsqlCommand($"SELECT \"TenantId\" FROM \"{table}\" WHERE \"Id\" = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        var value = await cmd.ExecuteScalarAsync();
        return value is Guid g ? g : null;
    }

    private async Task<(string ConnectionString, IMigrator Migrator, string Before, string Mine)> BeforeTheMigrationAsync()
    {
        var cs = await _pg.CreateDatabaseAsync();
        var db = PostgresFixture.NewContext(cs);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        var before = all[all.IndexOf(mine) - 1];
        await migrator.MigrateAsync(before);
        return (cs, migrator, before, mine);
    }

    [SkippableFact]
    public async Task TheMigration_GivesEachClaimItsTripsOrItsParticipantsOrganisation_AndEachLineItsClaims()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (cs, migrator, _, _) = await BeforeTheMigrationAsync();
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        var (a, b) = (await PlantTenantAsync(conn), await PlantTenantAsync(conn));
        var tripClaim = await PlantClaimAsync(conn, await PlantTripAsync(conn, a), null);
        var shiftClaim = await PlantClaimAsync(conn, null, await PlantParticipantAsync(conn, b));
        var both = await PlantClaimAsync(conn, await PlantTripAsync(conn, a), await PlantParticipantAsync(conn, a));

        await migrator.MigrateAsync();

        Assert.Equal(a, await TenantOfAsync(conn, "TripClaims", tripClaim.Claim));
        Assert.Equal(a, await TenantOfAsync(conn, "ClaimLineItems", tripClaim.Line));
        Assert.Equal(b, await TenantOfAsync(conn, "TripClaims", shiftClaim.Claim));
        Assert.Equal(b, await TenantOfAsync(conn, "ClaimLineItems", shiftClaim.Line));
        Assert.Equal(a, await TenantOfAsync(conn, "TripClaims", both.Claim));
        Assert.Equal(a, await TenantOfAsync(conn, "ClaimLineItems", both.Line));
        await using var indexes = new NpgsqlCommand("SELECT indexname FROM pg_indexes WHERE indexname IN ('IX_TripClaims_TenantId', 'IX_ClaimLineItems_TenantId')", conn);
        var found = new List<string>();
        await using (var reader = await indexes.ExecuteReaderAsync())
            while (await reader.ReadAsync()) found.Add(reader.GetString(0));
        Assert.Equal(new[] { "IX_ClaimLineItems_TenantId", "IX_TripClaims_TenantId" }, found.Order());
    }

    [SkippableFact]
    public async Task TheMigration_StopsForAClaimWithNoTripAndNoParticipant_AndLeavesTheSchemaAsItWas()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (cs, migrator, _, _) = await BeforeTheMigrationAsync();
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        var orphan = await PlantClaimAsync(conn, null, null);

        await AssertTheGuardStopsAsync(conn, migrator, orphan.Claim);
    }

    [SkippableFact]
    public async Task TheMigration_StopsForAClaimWhoseTripAndParticipantBelongToDifferentOrganisations()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (cs, migrator, _, _) = await BeforeTheMigrationAsync();
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        var (a, b) = (await PlantTenantAsync(conn), await PlantTenantAsync(conn));
        var mismatched = await PlantClaimAsync(conn, await PlantTripAsync(conn, a), await PlantParticipantAsync(conn, b));

        await AssertTheGuardStopsAsync(conn, migrator, mismatched.Claim);
    }

    private static async Task AssertTheGuardStopsAsync(NpgsqlConnection conn, IMigrator migrator, Guid claim)
    {
        var failure = await Assert.ThrowsAnyAsync<Exception>(() => migrator.MigrateAsync());
        var postgres = Assert.IsType<PostgresException>(failure as PostgresException ?? failure.InnerException);
        Assert.Contains(MigrationName, postgres.MessageText);
        Assert.Contains(claim.ToString(), postgres.MessageText);

        // One transaction: the columns the migration added are gone again.
        await using var columns = new NpgsqlCommand("SELECT COUNT(*) FROM information_schema.columns WHERE table_name IN ('TripClaims', 'ClaimLineItems') AND column_name = 'TenantId'", conn);
        Assert.Equal(0L, await columns.ExecuteScalarAsync());
    }

    [SkippableFact]
    public async Task TheStartupHeal_StampsAClaimAndLinesFiledWithoutATenant_ThenChangesNothing_AndNeverRetagsARowAlreadyTagged()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (cs, migrator, _, _) = await BeforeTheMigrationAsync();
        await migrator.MigrateAsync();
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        var (a, b) = (await PlantTenantAsync(conn), await PlantTenantAsync(conn));
        // As the previous image files them after a rollback: no TenantId on the claim or its line.
        var untagged = await PlantClaimAsync(conn, await PlantTripAsync(conn, a), null);
        var shifts = await PlantClaimAsync(conn, null, await PlantParticipantAsync(conn, b));
        // A row already tagged, whatever its parents say, is not touched.
        var tagged = await PlantClaimAsync(conn, await PlantTripAsync(conn, a), null, tenant: b);

        await using var heal = new NpgsqlCommand(ClaimTenantHeal.Sql, conn);
        Assert.Equal(4, await heal.ExecuteNonQueryAsync());

        Assert.Equal(a, await TenantOfAsync(conn, "TripClaims", untagged.Claim));
        Assert.Equal(a, await TenantOfAsync(conn, "ClaimLineItems", untagged.Line));
        Assert.Equal(b, await TenantOfAsync(conn, "TripClaims", shifts.Claim));
        Assert.Equal(b, await TenantOfAsync(conn, "ClaimLineItems", shifts.Line));
        Assert.Equal(b, await TenantOfAsync(conn, "TripClaims", tagged.Claim));
        Assert.Equal(b, await TenantOfAsync(conn, "ClaimLineItems", tagged.Line));

        await using var again = new NpgsqlCommand(ClaimTenantHeal.Sql, conn);
        Assert.Equal(0, await again.ExecuteNonQueryAsync());
    }
}
