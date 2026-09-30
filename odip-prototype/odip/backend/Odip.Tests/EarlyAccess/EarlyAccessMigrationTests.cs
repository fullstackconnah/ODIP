using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// Guards migration discovery (same idea as <see cref="Migrations.ElectronicSigningEvidenceMigrationTests"/>): EF only
/// applies migrations that are attributed for the configured DbContext. The migration's effect on a real database is
/// checked in <see cref="EarlyAccessPostgresTests"/> and by CI's `dotnet ef database update`.
/// </summary>
public class EarlyAccessMigrationTests
{
    [Fact]
    public void AddEarlyAccessRequests_IsDiscoveredByOdipDbContext_AfterTheExistingMigrations()
    {
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_migration_discovery_test;Username=postgres;Password=postgres")
            .Options;
        using var db = new OdipDbContext(options, new Mock<ICurrentTenant>().Object);

        var migrations = db.Database.GetMigrations().ToList();

        var index = migrations.FindIndex(m => m.EndsWith("_AddEarlyAccessRequests", StringComparison.Ordinal));
        Assert.True(index >= 0, "AddEarlyAccessRequests was not discovered");
        Assert.True(migrations.IndexOf("20260926003000_AddElectronicSigningEvidence") < index, "must sort after the previous latest migration");
    }
}
