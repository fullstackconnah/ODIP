using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// GA PR4: a Completed shift on a group activity is claimed at its own ratio. A 1:N participant's line is the group item's rate x 1 / N floored to the cent; 1:1 and 2:1 rows are priced as ordinary shifts; shared
/// support, a missing rate and an unattached group shift are left out with their reason and save nothing. The budget ledger and the budget check price it exactly as the claim does.
/// </summary>
public class GroupShiftClaimTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly From = new(2026, 10, 1);
    private static readonly DateOnly To = new(2026, 10, 31);
    private static readonly DateOnly Monday = new(2026, 10, 12);
    private const string GroupItem = "04_102_0136_6_1";

    private static LedgerKit Arrange(bool withGroupRows = true)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
        kit.SeedCommunityAccessCatalogue();
        if (withGroupRows)
        {
            var group = kit.SeedGroup(CatalogueGroups.GroupActivitiesGroupCode, "Group Activities", 4);
            kit.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
            {
                Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = GroupItem, Description = "Group activities", Unit = "H", DayType = ClaimDayType.Weekday, PriceLimit_NSW = 70.01m, PriceLimit_VIC = 70.01m,
                CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true, PaceSupportCategoryNumber = 4, SupportCategoryNumber = 4,
            });
            kit.Db.SaveChanges();
        }
        return kit;
    }

    private static Participant Person(LedgerKit kit, string last = "Brown")
    {
        var person = kit.SeedParticipant(last: last);
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)));
        return person;
    }

    private static Shift Attached(LedgerKit kit, Participant person, SupportRatio ratio, Guid activity, DateOnly? date = null, ShiftStatus status = ShiftStatus.Completed, int start = 9, int end = 12)
    {
        var shift = kit.SeedShift(person, date ?? Monday, status, start, end, false);
        shift.Ratio = ratio;
        shift.GroupActivityId = activity;
        shift.SupportGroupCode = CatalogueGroups.GroupActivitiesGroupCode;
        kit.Db.SaveChanges();
        return shift;
    }

    private static ShiftClaimGenerationService Engine(LedgerKit kit) => new(kit.Db, kit.Ledger, kit.Tenant);

    private static async Task<List<ClaimLineItem>> LinesOf(LedgerKit kit, Guid shiftId) => await kit.Db.ClaimLineItems.Where(l => l.ShiftId == shiftId).ToListAsync(Ct);

    [Fact]
    public async Task ClaimRun_AttachedOneToThree_BilledAtThirdRate()
    {
        var kit = Arrange();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, Guid.NewGuid());

        var generated = await Engine(kit).GenerateAsync(shift.ParticipantId, From, To, Ct);

        var line = Assert.Single(await LinesOf(kit, shift.Id));
        Assert.Equal(23.33m, line.UnitPrice);   // 70.01 / 3 = 23.336, floored
        Assert.Equal(3m, line.Hours);
        Assert.Equal(69.99m, line.TotalAmount);
        Assert.Equal(GroupItem, line.SupportItemCode);
        Assert.Empty(generated.LeftOut);
    }

    [Fact]
    public async Task ClaimRun_CancelledCoParticipant_DoesNotChangeTheDivisor()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var first = Attached(kit, Person(kit, "One"), SupportRatio.OneToThree, activity);
        Attached(kit, Person(kit, "Two"), SupportRatio.OneToThree, activity);
        Attached(kit, Person(kit, "Three"), SupportRatio.OneToThree, activity, status: ShiftStatus.Cancelled);

        await Engine(kit).GenerateAsync(first.ParticipantId, From, To, Ct);

        Assert.Equal(23.33m, Assert.Single(await LinesOf(kit, first.Id)).UnitPrice);   // the shift's own 1:3, not 70.01 / 2
    }

    [Fact]
    public async Task ClaimRun_TwoToOneSiblingsInAGroup_TwoFullRateLines()
    {
        var kit = Arrange();
        var person = Person(kit);
        var activity = Guid.NewGuid();
        var a = Attached(kit, person, SupportRatio.TwoToOne, activity);
        var b = Attached(kit, person, SupportRatio.TwoToOne, activity);

        await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        foreach (var shift in new[] { a, b })
        {
            var line = Assert.Single(await LinesOf(kit, shift.Id));
            Assert.Equal(70.01m, line.UnitPrice);
            Assert.Equal(210.03m, line.TotalAmount);
        }
    }

    [Fact]
    public async Task ClaimRun_AttachedOneToOne_BilledAtFullRate()
    {
        var kit = Arrange();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToOne, Guid.NewGuid());

        await Engine(kit).GenerateAsync(shift.ParticipantId, From, To, Ct);

        Assert.Equal(70.01m, Assert.Single(await LinesOf(kit, shift.Id)).UnitPrice);
    }

    [Fact]
    public async Task ClaimRun_SavedLine_RecomputesFromTheShiftsRatio()
    {
        var kit = Arrange();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, Guid.NewGuid());
        await Engine(kit).GenerateAsync(shift.ParticipantId, From, To, Ct);

        var line = Assert.Single(await LinesOf(kit, shift.Id));
        var row = await kit.Db.SupportCatalogueItems.SingleAsync(i => i.ItemNumber == line.SupportItemCode, Ct);
        var saved = await kit.Db.Shifts.AsNoTracking().SingleAsync(s => s.Id == line.ShiftId, Ct);
        var n = AgreementPatternMapperShape(saved.Ratio);

        Assert.Equal(Math.Floor(row.PriceLimit_NSW * 100m / n) / 100m, line.UnitPrice);   // the audit path: the item's price on that date over N from the shift's own ratio
    }

    private static int AgreementPatternMapperShape(SupportRatio ratio) => Odip.Infrastructure.Rostering.AgreementPatternMapper.ShapeOf(ratio)!.Value.ParticipantsPresent;

    [Fact]
    public async Task ClaimRun_AttachedSharedSupport_LeftOutNothingSaved()
    {
        var kit = Arrange();
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.SharedSupport, Guid.NewGuid());
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);   // keeps the run from being all left-out

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        var left = Assert.Single(generated.LeftOut);
        Assert.Equal(shift.Id, left.ShiftId);
        Assert.Equal("It is a shared-support shift, which shift claims do not price yet.", left.Reason);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task ClaimRun_AttachedWithNoRate_LeftOutNothingSaved()
    {
        var kit = Arrange(withGroupRows: false);
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.OneToThree, Guid.NewGuid());
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        var left = Assert.Single(generated.LeftOut);
        Assert.Equal(shift.Id, left.ShiftId);
        Assert.Contains("no catalogue rate", left.Reason);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task ClaimRun_UnattachedOneToThree_StillLeftOut()
    {
        var kit = Arrange();
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.OneToThree, Guid.NewGuid());
        shift.GroupActivityId = null;
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);
        kit.Db.SaveChanges();

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        var left = Assert.Single(generated.LeftOut);
        Assert.Equal("It is a 1:3 group shift, which shift claims do not price yet.", left.Reason);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task CancellationClaim_AttachedOneToTwo_ShareAsACancellationLine()
    {
        var kit = Arrange(withGroupRows: false);
        foreach (var item in kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
        var person = Person(kit);
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 20), ShiftStatus.Cancelled);
        shift.Ratio = SupportRatio.OneToTwo;
        shift.GroupActivityId = Guid.NewGuid();
        shift.CancelledAt = new DateTime(2026, 10, 16, 1, 0, 0, DateTimeKind.Utc);
        kit.Db.SaveChanges();

        var made = await Engine(kit).GenerateCancellationAsync(shift.Id, "NSDH", new DateOnly(2026, 10, 22), Ct);

        var line = Assert.Single(await LinesOf(kit, shift.Id));
        Assert.Equal(ClaimType.Cancellation, line.ClaimType);
        Assert.Equal(30m, line.UnitPrice);   // the NSW weekday limit of $60 over 2
        Assert.Equal(240m, made.Claim.TotalAmount);
    }

    [Fact]
    public async Task Ledger_AttachedOneToThree_EstimateEqualsClaim()
    {
        var kit = Arrange();
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.OneToThree, Guid.NewGuid());

        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id];
        var estimate = Assert.Single(ledger.Items, i => i.ShiftId == shift.Id);
        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        Assert.Equal(LedgerRowKind.CompletedShift, estimate.Kind);
        Assert.Null(estimate.Note);
        Assert.Equal(69.99m, estimate.Amount);
        Assert.Equal(generated.Claim.TotalAmount, estimate.Amount);
    }

    [Fact]
    public async Task Ledger_UnattachedOneToThree_StillZeroWithAReason()
    {
        var kit = Arrange();
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.OneToThree, Guid.NewGuid());
        shift.GroupActivityId = null;
        kit.Db.SaveChanges();

        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id];

        var item = Assert.Single(ledger.Items, i => i.ShiftId == shift.Id);
        Assert.Equal(0m, item.Amount);
        Assert.NotNull(item.Note);
    }

    [Fact]
    public async Task BudgetEstimate_AttachedOneToThree_IsPriced_AndUnattachedIsNot()
    {
        var kit = Arrange();
        var person = Person(kit);
        var source = new LedgerShiftCostSource(kit.Db, kit.Ledger);
        ShiftSpec Spec(Guid? activity) => new(Monday, new TimeOnly(9, 0), new TimeOnly(12, 0), false, SupportRatio.OneToThree, SleepoverType.None, CatalogueGroups.GroupActivitiesGroupCode, GroupActivityId: activity);

        var estimates = await source.EstimateAsync(kit.TenantId, person.Id, new[] { Spec(Guid.NewGuid()), Spec(null) }, Ct);

        Assert.Equal(69.99m, Assert.IsType<ShiftCostEstimate.Priced>(estimates[0]).Amount);
        Assert.IsType<ShiftCostEstimate.NotPriced>(estimates[1]);
    }

    // A block whose headcount changes part-way: the starting ratio is not what was delivered all through, so a group shift from it is claimed by hand (all three callers say so).
    private static ShiftPattern HeadcountPattern(LedgerKit kit, Participant person)
    {
        var draft = new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = kit.TenantId, ParticipantId = person.Id, Version = 1, State = "NSW" };
        kit.Db.ServiceAgreementDrafts.Add(draft);
        var block = new PlanBlock { ParticipantsPresent = 2, Location = new PlanLocation { State = "NSW", Zone = PriceZone.National, Mm = 1 }, HeadcountChanges = new[] { new PlanHeadcountChange { From = new TimeOnly(10, 30), ParticipantsPresent = 3 } } };
        kit.Db.ServiceAgreementDraftBlocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, BlockKey = "blk", BlockJson = DraftJson.Write(block) });
        var pattern = new ShiftPattern { Id = Guid.NewGuid(), TenantId = kit.TenantId, ParticipantId = person.Id, SourceDraftId = draft.Id, SourceBlockKey = "blk", DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Monday };
        kit.Db.ShiftPatterns.Add(pattern);
        kit.Db.SaveChanges();
        return pattern;
    }

    [Fact]
    public async Task ClaimRun_AttachedShiftFromABlockWithHeadcountChanges_LeftOutNothingSaved()
    {
        var kit = Arrange();
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.OneToTwo, Guid.NewGuid());
        shift.ShiftPatternId = HeadcountPattern(kit, person).Id;
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);
        kit.Db.SaveChanges();

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        var left = Assert.Single(generated.LeftOut);
        Assert.Equal("The group size changed during this support; claim it by hand.", left.Reason);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task Ledger_AttachedShiftFromABlockWithHeadcountChanges_IsNotPriced()
    {
        var kit = Arrange();
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.OneToTwo, Guid.NewGuid());
        shift.ShiftPatternId = HeadcountPattern(kit, person).Id;
        kit.Db.SaveChanges();

        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id];

        var item = Assert.Single(ledger.Items, i => i.ShiftId == shift.Id);
        Assert.Equal(0m, item.Amount);
        Assert.Contains("group size changed", item.Note);
    }

    [Fact]
    public async Task BudgetEstimate_AttachedShiftFromABlockWithHeadcountChanges_IsNotPriced()
    {
        var kit = Arrange();
        var person = Person(kit);
        var pattern = HeadcountPattern(kit, person);
        var spec = new ShiftSpec(Monday, new TimeOnly(9, 0), new TimeOnly(12, 0), false, SupportRatio.OneToTwo, SleepoverType.None, CatalogueGroups.GroupActivitiesGroupCode, pattern.Id, GroupActivityId: Guid.NewGuid());

        var estimate = Assert.Single(await new LedgerShiftCostSource(kit.Db, kit.Ledger).EstimateAsync(kit.TenantId, person.Id, new[] { spec }, Ct));

        Assert.Equal("the group size changed during this support; claim it by hand", Assert.IsType<ShiftCostEstimate.NotPriced>(estimate).Reason);
    }
}
