using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>GA PR3 left a completed shift on a group activity out of the shift claim; GA PR4 bills it: 1:1 at the full rate and 1:N at its share (the rate x 1 / N, floored to the cent), whatever the activity holds.</summary>
public class GroupActivityWorkClaimTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly From = new(2026, 10, 1);
    private static readonly DateOnly To = new(2026, 10, 31);

    private static async Task AssertBilledAsync(SupportRatio ratio, decimal unitPrice)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)));
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed, 9, 17, false);
        shift.Ratio = ratio;
        shift.GroupActivityId = Guid.NewGuid();
        var ordinary = kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed, 9, 17, false);
        kit.Db.SaveChanges();
        var engine = new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        var preview = await engine.PreviewAsync(person.Id, From, To, Ct);

        Assert.Empty(preview.LeftOut);
        Assert.Contains(preview.LineItems, l => l.ShiftId == ordinary.Id);
        var line = Assert.Single(preview.LineItems, l => l.ShiftId == shift.Id);
        Assert.Equal(unitPrice, line.UnitPrice);
        Assert.Equal(8m, line.Hours);
    }

    [Fact]
    public Task ClaimRun_CompletedOneToOneActivityShift_BilledAtFullRate() => AssertBilledAsync(SupportRatio.OneToOne, 60m);   // the NSW weekday limit of the test catalogue

    [Fact]
    public Task ClaimRun_CompletedOneToThreeActivityShift_BilledAtShare() => AssertBilledAsync(SupportRatio.OneToThree, 20m);   // 60 / 3
}
