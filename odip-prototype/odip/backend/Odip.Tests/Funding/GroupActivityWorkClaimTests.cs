using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>GA PR3: a completed shift on a group activity is left out of the shift claim and never billed (claims for group activities come in PR4), whatever its ratio.</summary>
public class GroupActivityWorkClaimTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly From = new(2026, 10, 1);
    private static readonly DateOnly To = new(2026, 10, 31);
    private const string GroupReason = "It is on a group activity, which shift claims do not price yet.";

    private static async Task AssertLeftOutNotBilledAsync(SupportRatio ratio)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)));
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed, 9, 17, false);
        shift.Ratio = ratio;
        shift.GroupActivityId = Guid.NewGuid();
        var ordinary = kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed, 9, 17, false);   // keeps the run from being all left-out
        kit.Db.SaveChanges();
        var engine = new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        var preview = await engine.PreviewAsync(person.Id, From, To, Ct);

        Assert.DoesNotContain(preview.LineItems, l => l.ShiftId == shift.Id);
        Assert.Contains(preview.LineItems, l => l.ShiftId == ordinary.Id);
        var left = Assert.Single(preview.LeftOut);
        Assert.Equal(shift.Id, left.ShiftId);
        Assert.Equal(GroupReason, left.Reason);
        Assert.False(await kit.Db.ClaimLineItems.AnyAsync(l => l.ShiftId == shift.Id, Ct));
    }

    [Fact]
    public Task ClaimRun_CompletedOneToOneActivityShift_LeftOutNotBilled() => AssertLeftOutNotBilledAsync(SupportRatio.OneToOne);

    [Fact]
    public Task ClaimRun_CompletedOneToThreeActivityShift_LeftOutNotBilled() => AssertLeftOutNotBilledAsync(SupportRatio.OneToThree);
}
