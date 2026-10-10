using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The activity library is per organisation, and nothing in the app writes one, so an organisation set up with a blank library would have an empty picker. Setting an organisation up copies the
/// starter activities (the generic ones the demo organisation is seeded with) into it, inside the set-up transaction, stamped with the new organisation.
/// </summary>
public class TenantSetupStarterActivitiesTests
{
    private static OdipDbContext SuperAdminDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options;   // CreateWithSetup runs in a transaction, which InMemory refuses unless told to ignore it
        return new OdipDbContext(options, tenant.Object);
    }

    private static async Task<Guid> SetUpAsync(OdipDbContext db, string domain = "brightside.example.com")
    {
        var result = await new TenantsController(db, new Mock<IFirebaseUserService>().Object)
            .CreateWithSetup(new CreateTenantWithSetupDto("Brightside Care", domain, null, null), CancellationToken.None);
        return Assert.IsType<ApiResponse<TenantCreatedDto>>(Assert.IsType<CreatedAtActionResult>(result).Value).Data!.Id;
    }

    [Fact]
    public async Task ANewOrganisation_StartsWithTheStarterActivities_StampedWithItsOwnTenant()
    {
        using var db = SuperAdminDb();

        var tenantId = await SetUpAsync(db);

        var activities = await db.Activities.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        Assert.Equal(8, activities.Count);
        Assert.All(activities, a => Assert.Equal((tenantId, (Guid?)null), (a.TenantId, a.EventTemplateId)));
        Assert.Equal(8, activities.Select(a => a.Id).Distinct().Count());
        Assert.Contains(activities, a => a.ActivityName == "Group Dinner Out");
        Assert.Contains(activities, a => a.ActivityName == "Sensory Art Session");
    }

    [Fact]
    public async Task AnotherOrganisationsActivities_AreNotCopied()
    {
        using var db = SuperAdminDb();
        var other = new Tenant { Id = Guid.NewGuid(), Name = "Other", EmailDomain = "other.example.com", IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Tenants.Add(other);
        db.Activities.Add(new Activity { Id = Guid.NewGuid(), TenantId = other.Id, ActivityName = "Secret picnic", Category = ActivityCategory.Leisure });
        db.SaveChanges();

        var tenantId = await SetUpAsync(db);

        var activities = await db.Activities.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        Assert.Equal(8, activities.Count(a => a.TenantId == tenantId));
        Assert.DoesNotContain(activities.Where(a => a.TenantId == tenantId), a => a.ActivityName == "Secret picnic");
        Assert.Equal("Secret picnic", Assert.Single(activities, a => a.TenantId == other.Id).ActivityName);
    }
}

public class TenantSetupStarterActivitiesPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public TenantSetupStarterActivitiesPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task ASetUpThatFailsAfterTheStarterActivitiesWereSaved_LeavesNoTenantAndNoActivities()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");

        await using (var db = PostgresFixture.NewContext(cs))
        {
            var created = await new TenantsController(db, firebase.Object).CreateWithSetup(new CreateTenantWithSetupDto("Brightside Care", "brightside.example.com", null, null), CancellationToken.None);
            Assert.IsType<CreatedAtActionResult>(created);
        }

        // The initial user's role is checked after the tenant and its activities were saved: the whole set-up rolls back with the transaction.
        await using (var db = PostgresFixture.NewContext(cs))
        {
            var refused = await new TenantsController(db, firebase.Object).CreateWithSetup(new CreateTenantWithSetupDto("Seaside Care", "seaside.example.com", null,
                new CreateInitialUserDto("Jane", "Smith", "jane@seaside.example.com", "jane.smith", "SuperAdmin", null)), CancellationToken.None);
            Assert.IsType<BadRequestObjectResult>(refused);
        }

        await using var check = PostgresFixture.NewContext(cs);
        var tenants = await check.Tenants.AsNoTracking().Where(t => t.EmailDomain == "brightside.example.com" || t.EmailDomain == "seaside.example.com").ToListAsync();
        Assert.Equal("brightside.example.com", Assert.Single(tenants).EmailDomain);
        var kept = await check.Activities.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        Assert.Equal(8, kept.Count);
        Assert.All(kept, a => Assert.Equal(tenants[0].Id, a.TenantId));
    }
}
