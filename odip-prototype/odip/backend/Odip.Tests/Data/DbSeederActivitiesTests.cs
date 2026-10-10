using Microsoft.EntityFrameworkCore;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>
/// The demo seed's activity library: 25 activities in the Demo organisation, the 8 generic ones being the starter set that tenant set-up copies.
/// </summary>
public class DbSeederActivitiesTests
{
    private static readonly Guid DemoTenantId = Guid.Parse("b0000000-0000-0000-0000-000000000001");

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
}
