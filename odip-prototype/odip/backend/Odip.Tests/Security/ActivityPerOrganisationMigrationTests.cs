using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Security;

/// <summary>
/// The migration that gives every activity an organisation, run over rows written by the shared library (skipped, never failed, when POSTGRES_CONNECTION_STRING is unset): EF InMemory cannot run
/// SQL, and a backfill that is wrong only shows on a database that already has rows. The rows are inserted with SQL because the schema is the one before the migration, not the current model.
/// </summary>
public class ActivityPerOrganisationMigrationTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "ActivityPerOrganisation";

    private readonly PostgresFixture _pg;
    public ActivityPerOrganisationMigrationTests(PostgresFixture pg) => _pg = pg;

    private static async Task ExecAsync(NpgsqlConnection conn, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<List<object[]>> QueryAsync(NpgsqlConnection conn, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<object[]>();
        while (await reader.ReadAsync())
        {
            var row = new object[reader.FieldCount];
            reader.GetValues(row);
            rows.Add(row);
        }
        return rows;
    }

    private enum Conflict { None, SharedByTwoOrganisations, TemplateOfAnotherOrganisation }

    private sealed record Library(Guid TenantX, Guid TenantY, Guid FromTemplate, Guid FromTrips, Guid Unused);

    /// <summary>A database migrated to just before this migration, holding the three kinds of activity the shared library had.</summary>
    private async Task<(string ConnectionString, IMigrator Migrator, OdipDbContext Db, Library Rows)> BeforeTheMigrationAsync(Conflict conflict)
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);

        var rows = new Library(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var (template, tripX, tripY, dayX, dayY) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();

        await ExecAsync(conn, "INSERT INTO \"Tenants\" (\"Id\",\"Name\",\"EmailDomain\",\"IsActive\",\"CreatedAt\") VALUES (@x,'X','x.example.com',true,now()),(@y,'Y','y.example.com',true,now())", ("x", rows.TenantX), ("y", rows.TenantY));
        await ExecAsync(conn, "INSERT INTO \"EventTemplates\" (\"Id\",\"TenantId\",\"EventCode\",\"EventName\",\"IsActive\",\"CreatedAt\",\"UpdatedAt\") VALUES (@t,@x,'BEACH','Beach week',true,now(),now())", ("t", template), ("x", rows.TenantX));
        foreach (var (trip, tenant, day) in new[] { (tripX, rows.TenantX, dayX), (tripY, rows.TenantY, dayY) })
        {
            await ExecAsync(conn,
                "INSERT INTO \"TripInstances\" (\"Id\",\"TenantId\",\"TripName\",\"StartDate\",\"DurationDays\",\"Status\",\"ActiveHoursPerDay\",\"CalculatedStaffRequired\",\"CreatedAt\",\"UpdatedAt\") " +
                "VALUES (@trip,@tenant,'Trip','2026-02-01',3,0,0,0,now(),now())", ("trip", trip), ("tenant", tenant));
            await ExecAsync(conn,
                "INSERT INTO \"TripDays\" (\"Id\",\"TripInstanceId\",\"DayNumber\",\"Date\",\"IsPublicHoliday\",\"OvernightType\",\"OvernightHours\",\"CreatedAt\",\"UpdatedAt\") " +
                "VALUES (@day,@trip,1,'2026-02-01',false,0,0,now(),now())", ("day", day), ("trip", trip));
        }

        // The activity of a template (used by that organisation's trip), one of no template used by organisation Y's trip on two days, and one nobody uses.
        foreach (var (id, name, templateId) in new[] { (rows.FromTemplate, "From template", (object)template), (rows.FromTrips, "From trips", (object)DBNull.Value), (rows.Unused, "Unused", (object)DBNull.Value) })
            await ExecAsync(conn,
                "INSERT INTO \"Activities\" (\"Id\",\"EventTemplateId\",\"ActivityName\",\"Category\",\"Location\",\"AccessibilityNotes\",\"IsActive\",\"CreatedAt\",\"UpdatedAt\") " +
                "VALUES (@id,@template,@name,2,'Surfers Paradise','Step-free',true,now(),now())", ("id", id), ("template", templateId), ("name", name));

        var scheduled = new List<(Guid Day, Guid Activity)> { (dayX, rows.FromTemplate), (dayY, rows.FromTrips), (dayY, rows.FromTrips) };
        if (conflict == Conflict.SharedByTwoOrganisations) scheduled.Add((dayX, rows.FromTrips));
        if (conflict == Conflict.TemplateOfAnotherOrganisation) scheduled.Add((dayY, rows.FromTemplate));
        foreach (var (day, activity) in scheduled)
            await ExecAsync(conn,
                "INSERT INTO \"ScheduledActivities\" (\"Id\",\"TripDayId\",\"ActivityId\",\"Title\",\"SortOrder\",\"Status\",\"CreatedAt\",\"UpdatedAt\") VALUES (@id,@day,@activity,'Picnic',0,0,now(),now())",
                ("id", Guid.NewGuid()), ("day", day), ("activity", activity));

        return (connectionString, migrator, db, rows);
    }

    [SkippableFact]
    public async Task TheMigration_GivesEachActivityItsOrganisation_AndKeepsEveryTripLink()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (cs, migrator, db, rows) = await BeforeTheMigrationAsync(Conflict.None);
        await using (db)
        {
            await migrator.MigrateAsync();

            await using var conn = new NpgsqlConnection(cs);
            await conn.OpenAsync();

            // An activity of a template takes the template's organisation; one of no template takes the organisation of the trips that use it.
            var owners = (await QueryAsync(conn, "SELECT \"Id\", \"TenantId\" FROM \"Activities\" WHERE \"Id\" IN ('" + rows.FromTemplate + "','" + rows.FromTrips + "')")).ToDictionary(r => (Guid)r[0], r => (Guid)r[1]);
            Assert.Equal(rows.TenantX, owners[rows.FromTemplate]);
            Assert.Equal(rows.TenantY, owners[rows.FromTrips]);

            // The unused one is gone, replaced by one copy per organisation that keeps its details.
            var tenants = (await QueryAsync(conn, "SELECT \"Id\" FROM \"Tenants\"")).Select(r => (Guid)r[0]).Order().ToList();
            Assert.Empty(await QueryAsync(conn, "SELECT 1 FROM \"Activities\" WHERE \"Id\" = '" + rows.Unused + "'"));
            var copies = await QueryAsync(conn, "SELECT \"TenantId\", \"Location\", \"AccessibilityNotes\", \"EventTemplateId\" FROM \"Activities\" WHERE \"ActivityName\" = 'Unused'");
            Assert.Equal(tenants, copies.Select(r => (Guid)r[0]).Order().ToList());
            Assert.All(copies, r => Assert.Equal(("Surfers Paradise", "Step-free", true), ((string)r[1], (string)r[2], r[3] is DBNull)));

            // No trip lost its activity, and the column is required from now on.
            Assert.Equal(3L, (await QueryAsync(conn, "SELECT COUNT(*) FROM \"ScheduledActivities\" WHERE \"ActivityId\" IS NOT NULL"))[0][0]);
            Assert.Equal("NO", (await QueryAsync(conn, "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Activities' AND column_name = 'TenantId'"))[0][0]);
        }
    }

    private static async Task<PostgresException> MigrationFailureAsync(IMigrator migrator)
    {
        var failure = await Assert.ThrowsAnyAsync<Exception>(() => migrator.MigrateAsync());
        return Assert.IsType<PostgresException>(failure as PostgresException ?? failure.InnerException);
    }

    [SkippableFact]
    public async Task TheMigration_StopsRatherThanLoseTheLink_WhenAnActivityIsUsedByTwoOrganisations()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (cs, migrator, db, rows) = await BeforeTheMigrationAsync(Conflict.SharedByTwoOrganisations);
        await using (db)
        {
            var failure = await MigrationFailureAsync(migrator);
            Assert.Equal("P0001", failure.SqlState);   // raised by the migration's own check, which names the activity
            Assert.Contains(rows.FromTrips.ToString(), failure.MessageText);

            // The migration rolled back whole: no column, and the shared activity and its three links are as they were.
            await using var conn = new NpgsqlConnection(cs);
            await conn.OpenAsync();
            Assert.Empty(await QueryAsync(conn, "SELECT 1 FROM information_schema.columns WHERE table_name = 'Activities' AND column_name = 'TenantId'"));
            Assert.Equal(3L, (await QueryAsync(conn, "SELECT COUNT(*) FROM \"ScheduledActivities\" WHERE \"ActivityId\" = '" + rows.FromTrips + "'"))[0][0]);
        }
    }

    [SkippableFact]
    public async Task TheMigration_StopsRatherThanHideAScheduledActivity_WhoseTripBelongsToAnotherOrganisationThanItsTemplate()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (_, migrator, db, rows) = await BeforeTheMigrationAsync(Conflict.TemplateOfAnotherOrganisation);
        await using (db)
        {
            var failure = await MigrationFailureAsync(migrator);
            Assert.Equal("P0001", failure.SqlState);
            Assert.Contains(rows.FromTemplate.ToString(), failure.MessageText);
        }
    }
}
