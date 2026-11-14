using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Moq;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Migrations;

/// <summary>
/// EF only applies a migration that carries [DbContext] and [Migration("id")]. Old migrations have no Designer file, so
/// the attributes sit on the migration class itself; a class that loses them would silently never run.
/// </summary>
public class MigrationDiscoveryTests
{
    [Fact]
    public void EveryMigrationClassIsDiscoveredByOdipDbContext()
    {
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_migration_discovery_test;Username=postgres;Password=postgres")
            .Options;
        using var db = new OdipDbContext(options, new Mock<ICurrentTenant>().Object);

        var classes = typeof(OdipDbContext).Assembly.GetTypes()
            // ConsolidateSchemaFixes has never carried [Migration]: an inert class, not applied anywhere.
            .Where(t => !t.IsAbstract && typeof(Migration).IsAssignableFrom(t) && t.Name != "ConsolidateSchemaFixes")
            .Select(t => t.Name)
            .Order()
            .ToList();
        var discovered = db.Database.GetMigrations().Select(m => m[(m.IndexOf('_') + 1)..]).Order().ToList();

        Assert.Equal(classes, discovered);
    }
}
