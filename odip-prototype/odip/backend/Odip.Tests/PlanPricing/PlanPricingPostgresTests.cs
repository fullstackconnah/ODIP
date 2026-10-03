using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The plan pricing storage against a real PostgreSQL (see <see cref="PostgresFixture"/>: skipped, never failed, when POSTGRES_CONNECTION_STRING is
/// unset, so these run in CI and not on a machine without a server). EF InMemory cannot show that a migration applies over live rows, that a unique
/// index holds, or that the service's queries translate to SQL.
/// </summary>
public class PlanPricingPostgresTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddPlanPricingSettingsAndHolidayOverrides";

    private readonly PostgresFixture _pg;
    public PlanPricingPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    [SkippableFact]
    public async Task TheMigration_AppliesOverLiveRows_KeepsThemUntouched_SeedsTheOverrides_AndTheDefaultsAndTheUniqueIndexHold()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();

        // 1. The schema as it was before this migration, holding a tenant, its provider settings and a synced holiday.
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);

        var tenantId = Guid.NewGuid();
        var holidayId = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Live Provider", EmailDomain = $"{tenantId:N}.example.com" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Live Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
        db.PublicHolidays.Add(new PublicHoliday { Id = holidayId, Date = new DateOnly(2026, 10, 5), Name = "Labour Day", State = "NSW" });
        await db.SaveChangesAsync();

        // 2. The migration applies without error and keeps every one of them as it was.
        await migrator.MigrateAsync();
        await using var after = PostgresFixture.NewContext(connectionString);
        var provider = await after.ProviderSettings.AsNoTracking().SingleAsync();
        Assert.Equal(("Live Provider", "NSW", "062000", "12345678"), (provider.OrganisationName, provider.State, provider.BSB, provider.AccountNumber));
        var holiday = await after.PublicHolidays.AsNoTracking().SingleAsync();
        Assert.Equal((holidayId, new DateOnly(2026, 10, 5), "Labour Day", "NSW"), (holiday.Id, holiday.Date, holiday.Name, holiday.State));

        // 3. The seed is there, with its part-day hours.
        var overrides = await after.PublicHolidayOverrides.AsNoTracking().ToListAsync();
        Assert.Equal(PublicHolidayOverrideSeed.All.Count, overrides.Count);
        var nt = overrides.Single(o => o.State == "NT" && o.Date == new DateOnly(2026, 12, 24));
        Assert.Equal((new TimeOnly(19, 0), (TimeOnly?)null), (nt.StartTime, nt.EndTime));
        Assert.Contains(overrides, o => o.State == "NSW" && o.Date == new DateOnly(2026, 12, 26) && o.Name == "Boxing Day");

        // 4. A settings row that names only its tenant reads back as the owner-approved defaults (the column defaults), and a tenant has one row.
        await using (var conn = new NpgsqlConnection(connectionString))
        {
            await conn.OpenAsync();
            await using var insert = new NpgsqlCommand("INSERT INTO \"PlanPricingSettings\" (\"Id\",\"TenantId\") VALUES (@id,@tenant)", conn);
            insert.Parameters.AddWithValue("id", Guid.NewGuid());
            insert.Parameters.AddWithValue("tenant", tenantId);
            await insert.ExecuteNonQueryAsync();

            await using var duplicate = new NpgsqlCommand("INSERT INTO \"PlanPricingSettings\" (\"Id\",\"TenantId\") VALUES (@id,@tenant)", conn);
            duplicate.Parameters.AddWithValue("id", Guid.NewGuid());
            duplicate.Parameters.AddWithValue("tenant", tenantId);
            var error = await Assert.ThrowsAsync<PostgresException>(() => duplicate.ExecuteNonQueryAsync());
            Assert.Equal("23505", error.SqlState);
        }

        await using var read = PostgresFixture.NewContext(connectionString);
        var policy = PlanPricingPolicy.From(await read.PlanPricingSettings.AsNoTracking().SingleAsync());
        Assert.Equal(Json(PlanPricingPolicy.Default), Json(policy));
    }

    [SkippableFact]
    public async Task TheQuoteService_RunsOnNpgsql_ReadsTheFeedAndTheOverridesAndTheTenantsSettings()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        await using var admin = PostgresFixture.NewContext(connectionString);
        await CatalogueImportTestSupport.ImportAsync(admin, CatalogueFixtures.File2026_27);
        var (tenantDb, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using var db = tenantDb;
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 10, 5), Name = "Labour Day", State = "NSW" });
        db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = tenantId, CrossingPolicy = CrossingPolicy.HigherOf, RegistrationGroupsConfirmed = true });
        await db.SaveChangesAsync();
        var blocks = new[]
        {
            new PlanBlock { Id = "monday", SupportType = PlanSupportType.CommunityAccess, Days = new[] { DayOfWeek.Monday }, Start = new TimeOnly(9, 0), End = new TimeOnly(13, 0), Location = new PlanLocation { State = "NSW" } },
            new PlanBlock { Id = "boxing", SupportType = PlanSupportType.CommunityAccess, Days = new[] { DayOfWeek.Saturday }, Start = new TimeOnly(9, 0), End = new TimeOnly(13, 0), Location = new PlanLocation { State = "NSW" }, OnPublicHoliday = HolidayDecision.Charge },
        };

        var quote = await new PlanPricingService(db).QuoteAsync(tenantId, blocks, new DateOnly(2026, 10, 5), new DateOnly(2026, 12, 27));

        Assert.Equal("Labour Day", Assert.Single(quote.HolidayOccurrences, h => h.BlockId == "monday").HolidayName);   // the synced row
        Assert.Equal("Boxing Day", Assert.Single(quote.HolidayOccurrences, h => h.BlockId == "boxing").HolidayName);   // the seeded override
        Assert.Equal(163.46m * 4, quote.Lines.Single(l => l.BlockId == "boxing" && l.ServiceDate == new DateOnly(2026, 12, 26)).Total);
        Assert.Empty(quote.Notices);                                                                                    // this tenant's settings are confirmed
        Assert.True(quote.Lines.All(l => l.IsPriced));
    }

    private static string Json(object value) => System.Text.Json.JsonSerializer.Serialize(value);
}
