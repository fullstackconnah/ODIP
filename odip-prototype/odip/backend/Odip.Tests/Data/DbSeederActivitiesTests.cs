using Microsoft.EntityFrameworkCore;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>
/// The demo seed's activity library: 25 activities in the Demo organisation, the 8 generic ones being the starter set that tenant set-up copies. And the start-up fix-up that moves demo rows
/// seeded under the Odip organisation to the Demo organisation moves their activities too, so Demo's trips do not point at activities Demo cannot see.
/// </summary>
public class DbSeederActivitiesTests
{
    private static readonly Guid DemoTenantId = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private static readonly Guid OdipTenantId = Guid.Parse("a0000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task TheSeed_PutsAllTwentyFiveActivitiesInTheDemoOrganisation_TheGenericOnesBeingTheStarterSet()
    {
        using var db = TestDb.Create();
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var activities = await db.Activities.IgnoreQueryFilters().AsNoTracking().ToListAsync();

        Assert.Equal(25, activities.Count);
        Assert.All(activities, a => Assert.Equal(DemoTenantId, a.TenantId));
        var generic = activities.Where(a => a.EventTemplateId is null).Select(a => (a.Id, a.ActivityName)).Order().ToList();
        Assert.Equal(StarterActivities.For(DemoTenantId, keepSeedIds: true).Select(a => (a.Id, a.ActivityName)).Order().ToList(), generic);
    }

    [Fact]
    public async Task WhenTheDemoRowsWereSeededUnderTheOdipOrganisation_TheFixUpMovesTheirActivitiesToo()
    {
        var name = Guid.NewGuid().ToString();
        using (var first = TestDb.Create(name))
        {
            await DbSeeder.SeedAsync(first, CancellationToken.None);
            foreach (var t in first.EventTemplates.IgnoreQueryFilters()) t.TenantId = OdipTenantId;
            foreach (var t in first.TripInstances.IgnoreQueryFilters()) t.TenantId = OdipTenantId;
            foreach (var a in first.Activities.IgnoreQueryFilters()) a.TenantId = OdipTenantId;
            await first.SaveChangesAsync();
        }

        using var db = TestDb.Create(name);
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        Assert.All(await db.TripInstances.IgnoreQueryFilters().ToListAsync(), t => Assert.Equal(DemoTenantId, t.TenantId));
        var activities = await db.Activities.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(25, activities.Count);
        Assert.All(activities, a => Assert.Equal(DemoTenantId, a.TenantId));
    }
}
