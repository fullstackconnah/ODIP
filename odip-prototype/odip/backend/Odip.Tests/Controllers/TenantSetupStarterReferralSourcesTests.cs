using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Migrations;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>A new organisation starts with the nine starter referral sources (in order), stamped with its own tenant; the migration gives the organisations that already exist the same list.</summary>
public class TenantSetupStarterReferralSourcesTests
{
    private static readonly string[] Starter =
    [
        "Support Coordinator", "Local Area Coordinator (LAC)", "NDIA planner", "GP or health professional", "Hospital",
        "Another provider", "Family or friend", "Self-referral", "Website or search",
    ];

    private static OdipDbContext SuperAdminDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static async Task<Guid> SetUpAsync(OdipDbContext db, string domain)
    {
        var result = await new TenantsController(db, new Mock<IFirebaseUserService>().Object)
            .CreateWithSetup(new CreateTenantWithSetupDto("Brightside Care", domain, new TenantSetupProviderDto { State = "VIC" }, null), CancellationToken.None);
        return Assert.IsType<ApiResponse<TenantCreatedDto>>(Assert.IsType<CreatedAtActionResult>(result).Value).Data!.Id;
    }

    [Fact]
    public async Task Create_seeds_the_starter_referral_sources()
    {
        using var db = SuperAdminDb();

        var tenantId = await SetUpAsync(db, "brightside.example.com");
        var secondId = await SetUpAsync(db, "seaside.example.com");

        var all = await db.ReferralSources.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        var mine = all.Where(r => r.TenantId == tenantId).ToList();
        Assert.Equal(Starter.Order(), mine.Select(r => r.Name).Order());
        Assert.All(mine, r => Assert.True(r.IsActive));
        Assert.Equal(9, all.Count(r => r.TenantId == secondId));
        Assert.Equal(18, all.Select(r => r.Id).Distinct().Count());
    }
}

public class ReferralSourcesMigrationPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ReferralSourcesMigrationPostgresTests(PostgresFixture pg) => _pg = pg;

    // The migration's seed is raw SQL, which InMemory never runs. The tenants are added after the migration ran, so the seed is executed again
    // here as the migration ran it: it gives every tenant the nine rows, and a second run changes nothing (ON CONFLICT DO NOTHING).
    [SkippableFact]
    public async Task The_starter_seed_gives_each_tenant_nine_rows_and_a_re_run_adds_none()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(cs);
        await db.Database.MigrateAsync();
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        db.Tenants.AddRange(new Odip.Domain.Entities.Tenant { Id = a, Name = "A", EmailDomain = "a.example.com" }, new Odip.Domain.Entities.Tenant { Id = b, Name = "B", EmailDomain = "b.example.com" });
        await db.SaveChangesAsync();

        await db.Database.ExecuteSqlRawAsync(AddReferralSources.SeedStarterSql);
        await db.Database.ExecuteSqlRawAsync(AddReferralSources.SeedStarterSql);

        var rows = await db.ReferralSources.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        Assert.Equal(9, rows.Count(r => r.TenantId == a));
        Assert.Equal(9, rows.Count(r => r.TenantId == b));
        Assert.All(rows, r => { Assert.True(r.IsActive); Assert.True(r.CreatedAt > DateTime.UtcNow.AddMinutes(-5)); });
        Assert.Contains(rows, r => r.TenantId == a && r.Name == "Local Area Coordinator (LAC)");
    }
}
