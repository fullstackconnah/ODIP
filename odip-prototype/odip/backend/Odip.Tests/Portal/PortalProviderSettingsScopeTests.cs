using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// The portal's start and manual-finish paths read the provider state for the shift's time zone. A SuperAdmin's query filter is off, so a plain
/// FirstOrDefault used to land on an arbitrary organisation: the zone now comes from the shift's own organisation, whoever records it.
/// </summary>
public class PortalProviderSettingsScopeTests
{
    private const string Perth = "Australia/Perth";

    /// <summary>A Published shift whose organisation is in WA; <paramref name="unscoped"/> makes the SuperAdmin caller view as no organisation.</summary>
    private static async Task<ShiftPackageFixture> Fixture(bool unscoped, Guid? staffTenant = null)
    {
        var f = Create(ShiftStatus.Published, tenantId: staffTenant);
        (await f.Db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State = "WA";
        await f.Db.SaveChangesAsync();
        if (unscoped) f.Tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        return f;
    }

    private static async Task<string> StartedZone(ShiftPackageFixture f)
    {
        Detail(await f.Controller.StartShift(f.Shift.Id, new StartShiftDto(), default));
        return (await f.Db.ShiftCompletions.SingleAsync()).TimeZoneId;
    }

    private static async Task<string> ManualFinishZone(ShiftPackageFixture f)
    {
        Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true, ActualStart = ActualStartUtc }, default));
        return (await f.Db.ShiftCompletions.SingleAsync()).TimeZoneId;
    }

    [Fact]
    public async Task Start_UnscopedSuperAdmin_GetsTheShiftsOrganisationZone() => Assert.Equal(Perth, await StartedZone(await Fixture(unscoped: true)));

    [Fact]
    public async Task Start_SuperAdminViewingAsTheOrganisation_GetsItsZone() => Assert.Equal(Perth, await StartedZone(await Fixture(unscoped: false)));

    [Fact]
    public async Task Start_StaffOfTheOrganisation_GetItsZone() => Assert.Equal(Perth, await StartedZone(await Fixture(unscoped: false, staffTenant: Guid.NewGuid())));

    [Fact]
    public async Task ManualFinish_UnscopedSuperAdmin_GetsTheShiftsOrganisationZone() => Assert.Equal(Perth, await ManualFinishZone(await Fixture(unscoped: true)));

    [Fact]
    public async Task ManualFinish_SuperAdminViewingAsTheOrganisation_GetsItsZone() => Assert.Equal(Perth, await ManualFinishZone(await Fixture(unscoped: false)));

    [Fact]
    public async Task ManualFinish_StaffOfTheOrganisation_GetItsZone() => Assert.Equal(Perth, await ManualFinishZone(await Fixture(unscoped: false, staffTenant: Guid.NewGuid())));
}
