using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>Seeding an empty database puts the demo rows in the Demo organisation and the admin on the Odip organisation, with no start-up fix-up pass needed.</summary>
public class DbSeederFirstRunTests
{
    private static readonly Guid DemoTenantId = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private static readonly Guid OdipTenantId = Guid.Parse("a0000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task SeedingAnEmptyDatabase_PlacesEveryDemoRowInTheDemoOrganisation_AndTheAdminAsSuperAdminInOdip()
    {
        using var db = TestDb.Create();
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        Assert.Equal(2, await db.Tenants.IgnoreQueryFilters().CountAsync(t => t.Id == DemoTenantId || t.Id == OdipTenantId));
        var admin = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Email == "admin@odip.com.au");
        Assert.Equal(UserRole.SuperAdmin, admin.Role);
        Assert.Equal(OdipTenantId, admin.TenantId);

        Assert.NotEmpty(await db.Participants.IgnoreQueryFilters().ToListAsync());
        Assert.All(await db.Participants.IgnoreQueryFilters().ToListAsync(), p => Assert.Equal(DemoTenantId, p.TenantId));
        Assert.All(await db.EventTemplates.IgnoreQueryFilters().ToListAsync(), t => Assert.Equal(DemoTenantId, t.TenantId));
        Assert.All(await db.AccommodationProperties.IgnoreQueryFilters().ToListAsync(), p => Assert.Equal(DemoTenantId, p.TenantId));
        Assert.All(await db.Vehicles.IgnoreQueryFilters().ToListAsync(), v => Assert.Equal(DemoTenantId, v.TenantId));
        Assert.All(await db.TripInstances.IgnoreQueryFilters().ToListAsync(), t => Assert.Equal(DemoTenantId, t.TenantId));
        Assert.All(await db.Activities.IgnoreQueryFilters().ToListAsync(), a => Assert.Equal(DemoTenantId, a.TenantId));
        Assert.DoesNotContain(await db.Users.IgnoreQueryFilters().ToListAsync(), u => u.TenantId == Guid.Empty);
    }
}
