using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>Service locations PR1: the zone of ONE shift is its place's zone when the place has a valid one, else the organisation's.</summary>
public class ProviderTimeZoneResolverForShiftTests
{
    private static readonly Guid Tenant = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid OtherTenant = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");

    private static OdipDbContext Arrange()
    {
        var db = TestDb.Create(Guid.NewGuid().ToString());
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Tenant, State = "NSW", TimeZoneId = "Australia/Sydney" });
        db.SaveChanges();
        return db;
    }

    private static Shift ShiftAt(OdipDbContext db, string? zone, bool active = true)
    {
        var place = new ServiceLocation { Id = Guid.NewGuid(), TenantId = Tenant, Name = Guid.NewGuid().ToString(), TimeZoneId = zone, IsActive = active };
        db.ServiceLocations.Add(place);
        db.SaveChanges();
        return new Shift { Id = Guid.NewGuid(), TenantId = Tenant, ServiceLocationId = place.Id };
    }

    private static async Task<string> ZoneAsync(OdipDbContext db, Shift shift) => (await ProviderTimeZoneResolver.ForShiftAsync(db, shift, CancellationToken.None)).Id;

    [Fact]
    public async Task NoLocation_GivesTheOrganisationsZone()
    {
        await using var db = Arrange();

        Assert.Equal("Australia/Sydney", await ZoneAsync(db, new Shift { TenantId = Tenant }));
    }

    [Fact]
    public async Task ALocationWithAZone_GivesThatZone()
    {
        await using var db = Arrange();

        Assert.Equal("Australia/Perth", await ZoneAsync(db, ShiftAt(db, "Australia/Perth")));
    }

    [Fact]
    public async Task ALocationWithoutAZone_FollowsTheOrganisation()
    {
        await using var db = Arrange();

        Assert.Equal("Australia/Sydney", await ZoneAsync(db, ShiftAt(db, null)));
    }

    [Fact]
    public async Task AnInvalidStoredZone_FallsBackToTheOrganisation()
    {
        await using var db = Arrange();

        Assert.Equal("Australia/Sydney", await ZoneAsync(db, ShiftAt(db, "Europe/London")));
    }

    [Fact]
    public async Task AnArchivedLocation_StillGivesItsZone()
    {
        await using var db = Arrange();

        Assert.Equal("Australia/Perth", await ZoneAsync(db, ShiftAt(db, "Australia/Perth", active: false)));
    }

    [Fact]
    public async Task AnotherTenantsLocationId_IsIgnored()
    {
        await using var db = Arrange();
        var foreign = new ServiceLocation { Id = Guid.NewGuid(), TenantId = OtherTenant, Name = "Elsewhere", TimeZoneId = "Australia/Perth" };
        db.ServiceLocations.Add(foreign);
        db.SaveChanges();

        Assert.Equal("Australia/Sydney", await ZoneAsync(db, new Shift { TenantId = Tenant, ServiceLocationId = foreign.Id }));
    }
}
