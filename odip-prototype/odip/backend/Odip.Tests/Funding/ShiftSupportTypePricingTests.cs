using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// Shift billing PR2: a shift with a support type is priced from that group's hourly rows by the claim, the ledger and the shift-create estimate alike, and a shift a rejected claim still holds is left out with a reason.
/// </summary>
public class ShiftSupportTypePricingTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Thu = new(2026, 10, 1), Sat = new(2026, 10, 3);

    private static LedgerKit Arrange()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        kit.SeedCommunityAccessCatalogue();
        return kit;
    }

    private static void Row(LedgerKit kit, string group, string number, ClaimDayType dayType, decimal price)
    {
        var g = kit.SeedGroup(group, group, 4);
        kit.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = g.Id, ItemNumber = number, Description = number, DayType = dayType, IsIntensive = false, Unit = "H",
            PriceLimit_VIC = price, PriceLimit_NSW = price, PriceLimit_ACT = price, PriceLimit_NT = price, PriceLimit_QLD = price, PriceLimit_SA = price, PriceLimit_TAS = price, PriceLimit_WA = price,
            PriceLimit_Remote = price, PriceLimit_VeryRemote = price, CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
            PaceSupportCategoryNumber = 4, SupportCategoryNumber = 4,
        });
        kit.Db.SaveChanges();
    }

    private static Shift Shift(LedgerKit kit, Participant person, DateOnly date, int from, int to, string? group)
    {
        var shift = kit.SeedShift(person, date, ShiftStatus.Completed, from, to);
        shift.SupportGroupCode = group;
        kit.Db.SaveChanges();
        return shift;
    }

    [Fact]
    public async Task AShiftWithASupportType_IsPricedFromThatGroupByTheClaim_TheLedgerAndTheEstimate()
    {
        var kit = Arrange();
        Row(kit, "GRP_X", "X_WD", ClaimDayType.Weekday, 60m);
        Row(kit, "GRP_X", "X_SAT", ClaimDayType.Saturday, 80m);
        var person = kit.SeedParticipant(addressState: "VIC");
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(4, 100000m)));
        Shift(kit, person, Thu, 9, 17, "GRP_X");     // 8 h weekday: 480
        Shift(kit, person, Sat, 9, 13, "GRP_X");     // 4 h Saturday: 320
        var plain = Shift(kit, person, new DateOnly(2026, 10, 2), 9, 17, null);   // no type: community access, 8 h x 50

        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct)).Values.SelectMany(l => l.Items).Where(i => i.Kind == LedgerRowKind.CompletedShift).ToList();
        var claim = await new ShiftClaimGenerationService(kit.Db).GenerateDraftClaimAsync(person.Id, Thu, Sat, Ct);
        var lines = await kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).OrderBy(l => l.SupportsDeliveredFrom).ToListAsync(Ct);

        Assert.Equal(new[] { "X_WD", "04_Weekday_STD", "X_SAT" }, lines.Select(l => l.SupportItemCode));
        Assert.Equal(new[] { 480m, 400m, 320m }, lines.Select(l => l.TotalAmount));
        Assert.All(lines, line => Assert.Equal(line.TotalAmount, ledger.Single(i => i.ShiftId == line.ShiftId).Amount));   // the ledger said what the claim then charged
        Assert.Equal(plain.Id, lines[1].ShiftId);

        // The create-time estimate prices the same way: the chosen type's rate, and community access when there is none.
        var costs = new LedgerShiftCostSource(kit.Db, kit.Ledger);
        var estimates = await costs.EstimateAsync(kit.TenantId, person.Id, new[]
        {
            new ShiftSpec(Thu, new TimeOnly(9, 0), new TimeOnly(17, 0), false, SupportRatio.OneToOne, SleepoverType.None, "GRP_X"),
            new ShiftSpec(Thu, new TimeOnly(9, 0), new TimeOnly(17, 0), false, SupportRatio.OneToOne, SleepoverType.None),
        }, Ct);
        Assert.Equal(480m, Assert.IsType<ShiftCostEstimate.Priced>(estimates[0]).Amount);
        Assert.Equal(400m, Assert.IsType<ShiftCostEstimate.Priced>(estimates[1]).Amount);
    }

    [Fact]
    public async Task AGroupWithTwoHourlyRatesForADay_IsLeftOutOfTheClaim_ButOtherShiftsStillClaim()
    {
        var kit = Arrange();
        Row(kit, "GRP_AMB", "AMB_A", ClaimDayType.Weekday, 60m);
        Row(kit, "GRP_AMB", "AMB_B", ClaimDayType.Weekday, 70m);
        var person = kit.SeedParticipant(addressState: "VIC");
        Shift(kit, person, Thu, 9, 17, "GRP_AMB");
        Shift(kit, person, new DateOnly(2026, 10, 2), 9, 17, null);

        var preview = await new ShiftClaimGenerationService(kit.Db).PreviewAsync(person.Id, Thu, Sat, Ct);

        Assert.Single(preview.LineItems);
        var left = Assert.Single(preview.LeftOut);
        Assert.Equal(Thu, left.ServiceDate);
        Assert.Contains("more than one rate matches this support type on 1 Oct 2026", left.Reason);
    }

    [Theory]
    [InlineData(TripClaimStatus.Rejected, "rejected")]
    [InlineData(TripClaimStatus.Cancelled, "cancelled")]
    public async Task AShiftARejectedClaimStillHolds_IsLeftOutWithTheClaimReference(TripClaimStatus status, string word)
    {
        var kit = Arrange();
        var person = kit.SeedParticipant(addressState: "VIC");
        var held = Shift(kit, person, Thu, 9, 17, null);
        Shift(kit, person, new DateOnly(2026, 10, 2), 9, 17, null);
        var rejected = kit.SeedShiftClaim(person, status, 400m, held, reference: "TC-REJECTED-1");   // its line is still Draft, so it still holds the shift
        var service = new ShiftClaimGenerationService(kit.Db);

        var preview = await service.PreviewAsync(person.Id, Thu, Sat, Ct);
        var left = Assert.Single(preview.LeftOut);
        Assert.Equal(held.Id, left.ShiftId);
        Assert.Contains($"it is on {word} claim TC-REJECTED-1. Delete that claim, then claim this shift again.", left.Reason);
        Assert.Single(preview.LineItems);

        // The same shift again by the run (preview mode), where the reason lands in the run's left-out list.
        var run = await service.PreviewRunAsync(kit.TenantId, Thu, Sat, Ct);
        Assert.Contains(run.LeftOut, l => l.ShiftId == held.Id && l.Reason.Contains("TC-REJECTED-1"));
    }
}
