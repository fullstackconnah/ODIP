using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Migrations;

/// <summary>
/// Guards migration discovery: EF only includes attributed migrations for the configured DbContext.
/// </summary>
public class ElectronicSigningEvidenceMigrationTests
{
    [Fact]
    public void ElectronicSigningEvidenceMigration_IsDiscoveredByOdipDbContext()
    {
        var tenant = new Mock<ICurrentTenant>();
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_migration_discovery_test;Username=postgres;Password=postgres")
            .Options;

        using var db = new OdipDbContext(options, tenant.Object);

        Assert.Contains("20260926003000_AddElectronicSigningEvidence", db.Database.GetMigrations());
    }
}
