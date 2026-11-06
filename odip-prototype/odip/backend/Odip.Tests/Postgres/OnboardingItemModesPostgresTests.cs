using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Domain.Entities;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Postgres;

public class OnboardingItemModesPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public OnboardingItemModesPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task OlderRowsReadAsDefaults_AfterTheMigration_AndTheMapRoundTripsThroughJsonb()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        await migrator.MigrateAsync(all[all.IndexOf(all.Single(m => m.EndsWith("_AddProviderSettingsOnboardingItemModes", StringComparison.Ordinal))) - 1]);

        var tenantId = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Live Provider", EmailDomain = $"{tenantId:N}.example.com" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "R", ABN = "12345678901", OrganisationName = "Org", Address = "1 St" });
        await OlderSchemaSeeds.SaveWithLaterColumnsAsync(db);

        await migrator.MigrateAsync();
        await using var after = PostgresFixture.NewContext(connectionString);
        var row = await after.ProviderSettings.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(OnboardingItemModeRules.Defaults, OnboardingItemModeRules.Effective(row.OnboardingItemModes));

        var wanted = OnboardingItemModeRules.Effective("""{"rights":"Optional","budget":"Optional"}""");
        row.OnboardingItemModes = OnboardingItemModeRules.Store(wanted);
        await after.SaveChangesAsync();

        await using var reload = PostgresFixture.NewContext(connectionString);
        var saved = await reload.ProviderSettings.AsNoTracking().IgnoreQueryFilters().SingleAsync();
        Assert.Equal(wanted, OnboardingItemModeRules.Effective(saved.OnboardingItemModes));
    }
}
