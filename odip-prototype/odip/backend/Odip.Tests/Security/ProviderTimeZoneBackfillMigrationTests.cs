using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Security;

/// <summary>
/// The migration that adds the organisation time zone, run over provider settings rows written before it (skipped, never failed, when POSTGRES_CONNECTION_STRING is unset): the backfill is SQL,
/// so only a real database proves each State lands on its zone and that the four contact columns stay empty for 2b.
/// </summary>
public class ProviderTimeZoneBackfillMigrationTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddProviderTimeZoneAndContact";

    private readonly PostgresFixture _pg;
    public ProviderTimeZoneBackfillMigrationTests(PostgresFixture pg) => _pg = pg;

    private static async Task ExecAsync(NpgsqlConnection conn, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value);
        await cmd.ExecuteNonQueryAsync();
    }

    // The State as written, then the zone the backfill gives it: a lowercase or padded State still maps, and one it does not know falls back to Sydney.
    private static readonly (string State, string Zone)[] Cases =
    [
        ("NSW", "Australia/Sydney"), ("ACT", "Australia/Sydney"), ("VIC", "Australia/Melbourne"), ("TAS", "Australia/Hobart"),
        ("QLD", "Australia/Brisbane"), ("SA", "Australia/Adelaide"), ("WA", "Australia/Perth"), ("NT", "Australia/Darwin"),
        ("", "Australia/Sydney"), ("vic", "Australia/Melbourne"), (" WA ", "Australia/Perth"), ("XX", "Australia/Sydney"),
    ];

    [SkippableFact]
    public async Task Existing_organisations_get_the_zone_of_their_State_and_no_contact_details()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);

        await using (var conn = new NpgsqlConnection(connectionString))
        {
            await conn.OpenAsync();
            for (var i = 0; i < Cases.Length; i++)
            {
                var tenant = Guid.NewGuid();
                await ExecAsync(conn, "INSERT INTO \"Tenants\" (\"Id\",\"Name\",\"EmailDomain\",\"IsActive\",\"CreatedAt\") VALUES (@t,@n,@d,true,now())", ("t", tenant), ("n", "Org" + i), ("d", $"org{i}.example.com"));
                await ExecAsync(conn,
                    "INSERT INTO \"ProviderSettings\" (\"Id\",\"TenantId\",\"ABN\",\"Address\",\"OrganisationName\",\"RegistrationNumber\",\"State\",\"UpdatedAt\",\"GSTRegistered\",\"IsPaceProvider\") " +
                    "VALUES (@id,@t,'12345678901','1 Test St',@n,'REG123',@s,now(),false,false)", ("id", Guid.NewGuid()), ("t", tenant), ("n", "Org" + i), ("s", Cases[i].State));
            }
        }

        await migrator.MigrateAsync();

        await using var check = new NpgsqlConnection(connectionString);
        await check.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT \"OrganisationName\",\"TimeZoneId\",\"TradingName\",\"ContactEmail\",\"ContactPhone\",\"Website\" FROM \"ProviderSettings\"", check);
        await using var reader = await cmd.ExecuteReaderAsync();
        var seen = 0;
        while (await reader.ReadAsync())
        {
            var index = int.Parse(reader.GetString(0)["Org".Length..]);
            Assert.Equal(Cases[index].Zone, reader.GetString(1));
            for (var col = 2; col <= 5; col++) Assert.True(reader.IsDBNull(col), $"column {col} should be empty");
            seen++;
        }
        Assert.Equal(Cases.Length, seen);
    }
}
