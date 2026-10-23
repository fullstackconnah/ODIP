using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// The review queue's dose count and the clean-only approve gate resolve the zone from each row's own organisation, not the caller's settings: an
/// unscoped SuperAdmin's context settings are their HOME organisation's. Slot enumeration is zone-free, so these pin that the answer is the same either way.
/// </summary>
public class CompletionMapperZoneOrgTests
{
    private static readonly Guid WaOrg = Guid.Parse("7a000000-0000-0000-0000-000000000001");
    private static readonly Guid HomeOrg = Guid.Parse("4b000000-0000-0000-0000-000000000002");

    private static async Task<ShiftPackageFixture> WithScheduledDose(bool unscopedHomeSydney)
    {
        var f = Create(ShiftStatus.PendingReview, tenantId: WaOrg);
        (await f.Db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State = "WA";
        f.Db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = WaOrg, ParticipantId = f.Participant.Id, Name = "Levetiracetam", Strength = "500mg",
            DoseDescription = "1 tablet", Type = MedicationType.Regular, TimesOfDay = "09:00", StartDate = new DateTime(2026, 1, 1),
            Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
        });
        if (unscopedHomeSydney)
        {
            f.Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = HomeOrg, State = "NSW" });
            f.Tenant.Setup(t => t.TenantId).Returns(HomeOrg);
            f.Tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        }
        await f.Db.SaveChangesAsync();
        return f;
    }

    private static Task<List<Odip.Application.DTOs.CompletionQueueItemDto>> Queue(ShiftPackageFixture f) =>
        ShiftCompletionMapper.BuildQueueItemsAsync(f.Db, f.Db.Shifts.IgnoreQueryFilters().Where(s => s.Id == f.Shift.Id), 30, default);

    [Fact]
    public async Task QueueExtras_PerthOrgShift_CountsTheDoseForASydneyHomeSuperAdmin()
    {
        var f = await WithScheduledDose(unscopedHomeSydney: true);

        Assert.Equal(1, Assert.Single(await Queue(f)).DosesWithoutOutcome);
    }

    [Fact]
    public async Task ShiftsNeedingReview_PerthOrgShift_FlagsTheDoseForASydneyHomeSuperAdmin()
    {
        var f = await WithScheduledDose(unscopedHomeSydney: true);

        var flagged = await ShiftCompletionMapper.ShiftsNeedingReviewAsync(f.Db, new[] { (f.Shift, f.Completion!) }, 30, default);

        Assert.Contains(f.Shift.Id, flagged);
    }

    [Fact]
    public async Task QueueExtras_ScopedUser_CountIsUnchanged()
    {
        var f = await WithScheduledDose(unscopedHomeSydney: false);

        Assert.Equal(1, Assert.Single(await Queue(f)).DosesWithoutOutcome);
    }
}
