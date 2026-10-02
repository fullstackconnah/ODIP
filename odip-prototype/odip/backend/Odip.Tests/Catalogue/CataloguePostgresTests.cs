using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Catalogue;

/// <summary>
/// The catalogue against a real PostgreSQL (see <see cref="PostgresFixture"/>: skipped, never failed, when POSTGRES_CONNECTION_STRING is
/// unset). EF InMemory cannot answer whether a migration applies over live rows, or whether a query translates to SQL.
/// </summary>
public class CataloguePostgresTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddCatalogueItemClassificationAndZonePrices";

    private readonly PostgresFixture _pg;
    public CataloguePostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static async Task ExecAsync(NpgsqlConnection conn, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static Task InsertLegacyItemAsync(NpgsqlConnection conn, Guid groupId, string code, decimal price, bool active, DateOnly from, DateOnly? to) =>
        ExecAsync(conn,
            "INSERT INTO \"SupportCatalogueItems\" (\"Id\",\"ActivityGroupId\",\"ItemNumber\",\"Description\",\"Unit\",\"DayType\",\"IsIntensive\"," +
            "\"PriceLimit_ACT\",\"PriceLimit_NSW\",\"PriceLimit_NT\",\"PriceLimit_QLD\",\"PriceLimit_SA\",\"PriceLimit_TAS\",\"PriceLimit_VIC\",\"PriceLimit_WA\"," +
            "\"PriceLimit_Remote\",\"PriceLimit_VeryRemote\",\"CatalogueVersion\",\"EffectiveFrom\",\"EffectiveTo\",\"IsActive\") VALUES " +
            "(@id,@g,@code,'Access Community - Weekday','H',0,false,@p,@p,@p,@p,@p,@p,@p,@p,@r,@vr,'2025-26',@from,@to,@active)",
            ("id", Guid.NewGuid()), ("g", groupId), ("code", code), ("p", price), ("r", price * 1.4m), ("vr", price * 1.5m),
            ("from", from), ("to", (object?)to ?? DBNull.Value), ("active", active));

    [SkippableFact]
    public async Task TheMigration_AppliesOverLiveCatalogueRows_KeepsThemUntouched_AndLeavesTheNewColumnsNull()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();

        // 1. The schema as it was before this migration, holding what the old importer and the demo seed wrote.
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);

        var groupId = Guid.NewGuid();
        await using (var conn = new NpgsqlConnection(connectionString))
        {
            await conn.OpenAsync();
            await ExecAsync(conn, "INSERT INTO \"SupportActivityGroups\" (\"Id\",\"GroupCode\",\"DisplayName\",\"SupportCategory\",\"IsActive\") VALUES (@id,'GRP_COMMUNITY_ACCESS','Group Community Access',4,true)", ("id", groupId));
            await InsertLegacyItemAsync(conn, groupId, "04_210_0125_6_1", 67.56m, active: true, new DateOnly(2024, 7, 1), null);
            await InsertLegacyItemAsync(conn, groupId, "04_104_0125_6_1", 70.23m, active: false, new DateOnly(2025, 7, 1), new DateOnly(2026, 3, 14));
        }

        // 2. The migration applies over them without error...
        await migrator.MigrateAsync();

        // ...keeps both rows exactly as they were, and the new columns are NULL (unknown), IsLegacy false.
        await using var after = PostgresFixture.NewContext(connectionString);
        var rows = await after.SupportCatalogueItems.AsNoTracking().OrderBy(i => i.EffectiveFrom).ToListAsync();
        Assert.Equal(2, rows.Count);

        var seed = rows[0];
        Assert.Equal(("04_210_0125_6_1", 67.56m, true, new DateOnly(2024, 7, 1), (DateOnly?)null), (seed.ItemNumber, seed.PriceLimit_VIC, seed.IsActive, seed.EffectiveFrom, seed.EffectiveTo));
        var imported = rows[1];
        Assert.Equal(("04_104_0125_6_1", 70.23m, false, new DateOnly(2025, 7, 1), (DateOnly?)new DateOnly(2026, 3, 14)), (imported.ItemNumber, imported.PriceLimit_VIC, imported.IsActive, imported.EffectiveFrom, imported.EffectiveTo));

        Assert.All(rows, r =>
        {
            Assert.Null(r.RegistrationGroup);
            Assert.Null(r.SupportCategoryNumber);
            Assert.Null(r.PaceSupportCategoryNumber);
            Assert.Null(r.OutcomeDomain);
            Assert.Null(r.SupportPurpose);
            Assert.Null(r.CatalogueType);
            Assert.Null(r.NonFaceToFace);
            Assert.Null(r.ProviderTravel);
            Assert.Null(r.ShortNoticeCancellation);
            Assert.Null(r.NdiaRequestedReports);
            Assert.Null(r.IrregularSil);
            Assert.Null(r.PriceNational);
            Assert.Null(r.PriceRemote);
            Assert.Null(r.PriceVeryRemote);
            Assert.Null(r.SourceDocument);
            Assert.False(r.IsLegacy);
            Assert.Equal(ClaimDayType.Weekday, r.DayType);
        });
    }

    [SkippableFact]
    public async Task TheImportAndTheLookup_RunOnNpgsql_OverTheSeed_AndReimportingChangesNothing()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        await DbSeeder.SeedNdisDataAsync(db);

        // The real 2026-27 file over the seeded database: the five seeded rows are what the file says, so only the rest is added.
        var first = await CatalogueImportTestSupport.ImportAsync(db, CatalogueFixtures.File2026_27);
        Assert.Equal(new CatalogueImportResultDto(1012, 0, 5, 0), first);

        // Importing it again changes nothing, read back through a fresh context so nothing is served from the change tracker.
        await using var reader = PostgresFixture.NewContext(connectionString);
        var before = await CatalogueImportTestSupport.SnapshotAsync(reader);
        var again = await CatalogueImportTestSupport.ImportAsync(db, CatalogueFixtures.File2026_27);
        await using var reader2 = PostgresFixture.NewContext(connectionString);
        Assert.Equal(new CatalogueImportResultDto(0, 0, 1017, 0), again);
        Assert.Equal(before, await CatalogueImportTestSupport.SnapshotAsync(reader2));
        Assert.Equal(11, await reader2.SupportActivityGroups.CountAsync());

        // An older file imported afterwards is history: it adds rows, end-dates nothing the newer file owns, and the date-effective lookup
        // (a LINQ query over DateOnly windows) gives each service date its own year's price.
        await CatalogueImportTestSupport.ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await using var lookup = PostgresFixture.NewContext(connectionString);
        Assert.Equal(70.23m, (await lookup.FindCatalogueItemAsync("04_104_0125_6_1", new DateOnly(2026, 6, 30), PriceZone.National)).Price);
        Assert.Equal(73.58m, (await lookup.FindCatalogueItemAsync("04_104_0125_6_1", new DateOnly(2026, 7, 1), PriceZone.National)).Price);
        Assert.Equal(103.01m, (await lookup.FindCatalogueItemAsync("04_104_0125_6_1", new DateOnly(2026, 10, 5), PriceZone.Remote)).Price);
        Assert.Equal(CatalogueLookupFailure.NotPriced, (await lookup.FindCatalogueItemAsync("01_003_0107_1_1", new DateOnly(2026, 10, 5), PriceZone.National)).Failure);

        // GRP_COMMUNITY_ACCESS still has exactly its ten current items active.
        var active = await lookup.SupportCatalogueItems.Where(i => i.IsActive && i.ActivityGroup.GroupCode == "GRP_COMMUNITY_ACCESS").Select(i => i.ItemNumber).ToListAsync();
        Assert.Equal(10, active.Count);
    }
}
