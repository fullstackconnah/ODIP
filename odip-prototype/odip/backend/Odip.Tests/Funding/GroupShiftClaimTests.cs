using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
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

    private static LedgerKit Arrange(bool withGroupRows = true, decimal rate = 70.01m)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
        kit.SeedCommunityAccessCatalogue();
        if (withGroupRows)
        {
            var group = kit.SeedGroup(CatalogueGroups.GroupActivitiesGroupCode, "Group Activities", 4);
            kit.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
            {
                Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = GroupItem, Description = "Group activities", Unit = "H", DayType = ClaimDayType.Weekday, PriceLimit_NSW = rate, PriceLimit_VIC = rate,
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
    public async Task ClaimRun_AttachedSharedSupport_NoBlock_LeftOutWithNewReason()
    {
        var kit = Arrange();
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.SharedSupport, Guid.NewGuid());
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);   // keeps the run from being all left-out

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        var left = Assert.Single(generated.LeftOut);
        Assert.Equal(shift.Id, left.ShiftId);
        Assert.Equal("It is a shared-support shift with no agreement headcount, which shift claims do not price yet.", left.Reason);
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
        Assert.Contains("No catalogue rate", left.Reason);
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
    private static ShiftPattern HeadcountPattern(LedgerKit kit, Participant person) => BlockPattern(kit, person, new PlanBlock
    {
        ParticipantsPresent = 2, Location = new PlanLocation { State = "NSW", Zone = PriceZone.National, Mm = 1 }, HeadcountChanges = new[] { new PlanHeadcountChange { From = new TimeOnly(10, 30), ParticipantsPresent = 3 } },
    });

    // The pattern an agreement block became. The draft and the pattern can each belong to another org, to show that the block is read only through the caller's own rows.
    private static ShiftPattern BlockPattern(LedgerKit kit, Participant person, PlanBlock block, Guid? draftTenant = null, Guid? patternTenant = null)
    {
        var draft = new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = draftTenant ?? kit.TenantId, ParticipantId = person.Id, Version = 1, State = "NSW" };
        kit.Db.ServiceAgreementDrafts.Add(draft);
        kit.Db.ServiceAgreementDraftBlocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, BlockKey = "blk", BlockJson = DraftJson.Write(block) });
        var pattern = new ShiftPattern { Id = Guid.NewGuid(), TenantId = patternTenant ?? kit.TenantId, ParticipantId = person.Id, SourceDraftId = draft.Id, SourceBlockKey = "blk", DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Monday };
        kit.Db.ShiftPatterns.Add(pattern);
        kit.Db.SaveChanges();
        return pattern;
    }

    private static PlanBlock SharedBlock(int workers = 1, int present = 6) => new()
    {
        Workers = workers, ParticipantsPresent = present, Location = new PlanLocation { State = "NSW", Zone = PriceZone.National, Mm = 1 },
        Travel = new PlanProviderTravel { ParticipantsSharing = 3 },   // the divisor is the headcount, never the travel sharing
    };

    // 09:00-10:30 at 70.23: the 17.55 fixture of the claim, the ledger and the estimate.
    private static Shift AttachedSharedSupport(LedgerKit kit, Participant person, Guid? patternId, bool attached = true)
    {
        var shift = Attached(kit, person, SupportRatio.SharedSupport, Guid.NewGuid());
        shift.EndTime = new TimeOnly(10, 30);
        shift.ShiftPatternId = patternId;
        if (!attached) shift.GroupActivityId = null;
        kit.Db.SaveChanges();
        return shift;
    }

    private const string NoHeadcount = "It is a shared-support shift with no agreement headcount, which shift claims do not price yet.";

    [Fact]
    public async Task ClaimRun_AttachedSharedSupportFromABlockOfSix_BilledAtSixthRate()
    {
        var kit = Arrange(rate: 70.23m);
        var person = Person(kit);
        var shift = AttachedSharedSupport(kit, person, BlockPattern(kit, person, SharedBlock()).Id);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        var line = Assert.Single(await LinesOf(kit, shift.Id));
        Assert.Equal(GroupItem, line.SupportItemCode);
        Assert.Equal(11.70m, line.UnitPrice);   // 70.23 / 6 = 11.705, floored
        Assert.Equal(1.5m, line.Hours);
        Assert.Equal(17.55m, line.TotalAmount);
        Assert.Empty(generated.LeftOut);
    }

    [Theory]
    [InlineData(2, 8)]    // two workers: not shared support
    [InlineData(1, 3)]    // a 1:3 block under a shared-support shift
    [InlineData(1, 41)]   // above the 40 a block may hold
    public async Task ClaimRun_SharedSupportBlockThatIsNotSharedSupport_LeftOutNoHeadcount(int workers, int present)
    {
        var kit = Arrange(rate: 70.23m);
        var person = Person(kit);
        var shift = AttachedSharedSupport(kit, person, BlockPattern(kit, person, SharedBlock(workers, present)).Id);
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        Assert.Equal(NoHeadcount, Assert.Single(generated.LeftOut).Reason);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task ClaimRun_UnattachedSharedSupportWithABlock_KeepsTodaysReason()
    {
        var kit = Arrange(rate: 70.23m);
        var person = Person(kit);
        var shift = AttachedSharedSupport(kit, person, BlockPattern(kit, person, SharedBlock()).Id, attached: false);
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        Assert.Equal("It is a shared-support shift, which shift claims do not price yet.", Assert.Single(generated.LeftOut).Reason);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task ClaimRun_AttachedOneToThreeWithABlockOfSix_StillThirdRate()
    {
        var kit = Arrange();
        var person = Person(kit);
        var shift = Attached(kit, person, SupportRatio.OneToThree, Guid.NewGuid());
        shift.ShiftPatternId = BlockPattern(kit, person, SharedBlock()).Id;
        kit.Db.SaveChanges();

        await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        Assert.Equal(23.33m, Assert.Single(await LinesOf(kit, shift.Id)).UnitPrice);   // a block never changes a 1:N line
    }

    // The explicit tenant filters of the block read, each killed by its own case: the global query filter is off (a super admin context), so only they decide.
    [Theory]
    [InlineData(false, true)]    // this org's pattern, another org's draft
    [InlineData(true, false)]    // another org's pattern, this org's draft
    [InlineData(true, true)]     // both another org's
    public async Task ClaimRun_SharedSupportBlockFromAnotherOrg_NeverRead(bool patternForeign, bool draftForeign)
    {
        var kit = Arrange(rate: 70.23m);
        var person = Person(kit);
        var other = Guid.NewGuid();
        var pattern = BlockPattern(kit, person, SharedBlock(), draftForeign ? other : null, patternForeign ? other : null);
        var shift = AttachedSharedSupport(kit, person, pattern.Id);
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);
        Moq.Mock.Get(kit.Tenant).Setup(t => t.IsSuperAdmin).Returns(true);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        Assert.Equal(NoHeadcount, Assert.Single(generated.LeftOut).Reason);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task ClaimRun_SharedSupportBlockWithHeadcountChanges_LeftOut()
    {
        var kit = Arrange(rate: 70.23m);
        var person = Person(kit);
        var block = SharedBlock() with { HeadcountChanges = new[] { new PlanHeadcountChange { From = new TimeOnly(10, 0), ParticipantsPresent = 8 } } };
        var shift = AttachedSharedSupport(kit, person, BlockPattern(kit, person, block).Id);
        kit.SeedShift(person, Monday.AddDays(1), ShiftStatus.Completed);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        Assert.Equal("The group size changed during this support; claim it by hand.", Assert.Single(generated.LeftOut).Reason);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task CancellationClaim_AttachedSharedSupport_SixthOfTheRate()
    {
        var kit = Arrange(withGroupRows: false);
        foreach (var item in kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
        var person = Person(kit);
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 20), ShiftStatus.Cancelled);
        shift.Ratio = SupportRatio.SharedSupport;
        shift.GroupActivityId = Guid.NewGuid();
        shift.ShiftPatternId = BlockPattern(kit, person, SharedBlock()).Id;
        shift.CancelledAt = new DateTime(2026, 10, 16, 1, 0, 0, DateTimeKind.Utc);
        kit.Db.SaveChanges();

        var made = await Engine(kit).GenerateCancellationAsync(shift.Id, "NSDH", new DateOnly(2026, 10, 22), Ct);

        var line = Assert.Single(await LinesOf(kit, shift.Id));
        Assert.Equal(ClaimType.Cancellation, line.ClaimType);
        Assert.Equal(10m, line.UnitPrice);   // the NSW weekday limit of $60 over 6
        Assert.Equal(80m, made.Claim.TotalAmount);
    }

    [Fact]
    public async Task Ledger_AttachedSharedSupport_EstimateEqualsClaim_AndNoBlockIsZeroWithAReason()
    {
        var kit = Arrange(rate: 70.23m);
        var person = Person(kit);
        var priced = AttachedSharedSupport(kit, person, BlockPattern(kit, person, SharedBlock()).Id);
        var bare = AttachedSharedSupport(kit, person, null);
        bare.ServiceDate = Monday.AddDays(1);
        kit.Db.SaveChanges();

        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id];
        var estimate = Assert.Single(ledger.Items, i => i.ShiftId == priced.Id);
        var none = Assert.Single(ledger.Items, i => i.ShiftId == bare.Id);
        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        Assert.Null(estimate.Note);
        Assert.Equal(17.55m, estimate.Amount);
        Assert.Equal(17.55m, Assert.Single(await LinesOf(kit, priced.Id)).TotalAmount);
        Assert.Equal(0m, none.Amount);
        Assert.Contains("no agreement headcount", none.Note);
        Assert.Equal(17.55m, generated.Claim.TotalAmount);
    }

    [Fact]
    public async Task BudgetEstimate_AttachedSharedSupport_IsPriced_AndWithoutABlockIsNot()
    {
        var kit = Arrange(rate: 70.23m);
        var person = Person(kit);
        var pattern = BlockPattern(kit, person, SharedBlock());
        ShiftSpec Spec(Guid? patternId) => new(Monday, new TimeOnly(9, 0), new TimeOnly(10, 30), false, SupportRatio.SharedSupport, SleepoverType.None, CatalogueGroups.GroupActivitiesGroupCode, patternId, GroupActivityId: Guid.NewGuid());

        var estimates = await new LedgerShiftCostSource(kit.Db, kit.Ledger).EstimateAsync(kit.TenantId, person.Id, new[] { Spec(pattern.Id), Spec(null) }, Ct);

        Assert.Equal(17.55m, Assert.IsType<ShiftCostEstimate.Priced>(estimates[0]).Amount);
        Assert.Equal("it is a shared-support shift with no agreement headcount, which shift claims do not price yet", Assert.IsType<ShiftCostEstimate.NotPriced>(estimates[1]).Reason);
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

    // Headcount PR: N is never fewer than the people each worker supports, so a group's lines never add up to more than its workers x the rate.

    private static readonly DateTime OnTheDay = new(2026, 10, 12, 1, 0, 0, DateTimeKind.Utc);   // 12:00 on the Monday in Sydney: no notice at all

    private static List<Shift> Others(LedgerKit kit, Guid activity, int count, SupportRatio ratio = SupportRatio.OneToThree, ShiftStatus status = ShiftStatus.Completed, DateTime? cancelledAt = null, Guid? tenant = null)
    {
        var list = new List<Shift>();
        for (var i = 0; i < count; i++)
        {
            var other = tenant is null ? Person(kit, "Other" + Guid.NewGuid().ToString("N")[..6]) : kit.SeedParticipant(tenantId: tenant, last: "Foreign");
            var shift = Attached(kit, other, ratio, activity, status: status);
            shift.CancelledAt = cancelledAt;
            list.Add(shift);
        }
        kit.Db.SaveChanges();
        return list;
    }

    private static void Staff(LedgerKit kit, Guid activity, int rows, Guid? tenant = null)
    {
        for (var i = 0; i < rows; i++)
            kit.Db.GroupActivityStaff.Add(new GroupActivityStaff { Id = Guid.NewGuid(), TenantId = tenant ?? kit.TenantId, GroupActivityId = activity, UserId = Guid.NewGuid(), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0) });
        kit.Db.SaveChanges();
    }

    private static async Task<decimal> UnitOf(LedgerKit kit, Shift shift)
    {
        await Engine(kit).GenerateAsync(shift.ParticipantId, From, To, Ct);
        return Assert.Single(await LinesOf(kit, shift.Id)).UnitPrice;
    }

    private static ShiftSpec GroupSpec(Guid activity) => new(Monday, new TimeOnly(9, 0), new TimeOnly(12, 0), false, SupportRatio.OneToThree, SleepoverType.None, CatalogueGroups.GroupActivitiesGroupCode, GroupActivityId: activity);

    [Fact]
    public async Task ClaimRun_OneToThreeQuoted_FiveAttend_BilledAtFifth_AndTheFiveLinesStayWithinTheRate()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var shifts = Others(kit, activity, 4).Prepend(Attached(kit, Person(kit), SupportRatio.OneToThree, activity)).ToList();

        foreach (var shift in shifts) await Engine(kit).GenerateAsync(shift.ParticipantId, From, To, Ct);

        var lines = new List<ClaimLineItem>();
        foreach (var shift in shifts) lines.Add(Assert.Single(await LinesOf(kit, shift.Id)));
        Assert.All(lines, l => Assert.Equal(14.00m, l.UnitPrice));   // 70.01 / 5 = 14.002, floored
        Assert.All(lines, l => Assert.Equal(42.00m, l.TotalAmount));
        Assert.Equal(70.00m, lines.Sum(l => l.UnitPrice));   // an hour of the group is at most 70.01
    }

    [Fact]
    public async Task ClaimRun_OneToThreeQuoted_TwoAttend_StillThird()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 1);

        Assert.Equal(23.33m, await UnitOf(kit, shift));
    }

    [Fact]
    public async Task ClaimRun_SharedSupportBlockOfSix_EightAttend_BilledAtEighth()
    {
        var kit = Arrange(rate: 70.23m);
        var activity = Guid.NewGuid();
        var person = Person(kit);
        var shift = AttachedSharedSupport(kit, person, BlockPattern(kit, person, SharedBlock()).Id);
        shift.GroupActivityId = activity;
        kit.Db.SaveChanges();
        Others(kit, activity, 7, SupportRatio.SharedSupport);

        var unit = await UnitOf(kit, shift);

        var line = Assert.Single(await LinesOf(kit, shift.Id));
        Assert.Equal(8.77m, unit);   // 70.23 / 8 = 8.77875, floored
        Assert.Equal(13.16m, line.TotalAmount);   // 1.5 h x 8.77 = 13.155
    }

    [Theory]
    [InlineData(5, 2, 23.33)]   // six people, two workers: three each
    [InlineData(6, 2, 17.50)]   // seven people over two workers: ceil(7 / 2) = 4
    [InlineData(5, 0, 11.66)]   // no staff row: one worker covers six
    public async Task ClaimRun_StaffRows_ShareTheGroup(int others, int rows, double expected)
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, others);
        Staff(kit, activity, rows);

        Assert.Equal((decimal)expected, await UnitOf(kit, shift));
    }

    [Theory]
    [InlineData(2, 23.33)]   // three at 1:3 and a 1:1 on two rows: one worker left for the three
    [InlineData(3, 17.50)]   // four at 1:3: ceil(4 / 1) = 4
    public async Task ClaimRun_OneToOneInTheActivity_TakesItsOwnWorker(int others, double expected)
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, others);
        Others(kit, activity, 1, SupportRatio.OneToOne);
        Staff(kit, activity, 2);

        Assert.Equal((decimal)expected, await UnitOf(kit, shift));
    }

    [Fact]
    public async Task ClaimRun_OneToOnePeopleTakeEveryWorker_IsClaimedAsIfOneCoveredTheGroup()
    {
        // Main does the same today (GCH-C2): two rows, both taken by 1:1 people, and three at 1:3 still divide by their own count.
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 2);
        Others(kit, activity, 2, SupportRatio.OneToOne);
        Staff(kit, activity, 2);

        Assert.Equal(23.33m, await UnitOf(kit, shift));
    }

    [Fact]
    public async Task ClaimRun_NoShowAndItsCancellation_BothClaimed_TheFiveLinesAddUpToTheRate()
    {
        var kit = Arrange();
        foreach (var item in kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
        kit.Db.SaveChanges();
        var activity = Guid.NewGuid();
        var first = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        var attendees = Others(kit, activity, 3).Prepend(first).ToList();
        var noShow = Others(kit, activity, 1, status: ShiftStatus.Cancelled, cancelledAt: OnTheDay).Single();
        foreach (var shift in attendees) await Engine(kit).GenerateAsync(shift.ParticipantId, From, To, Ct);

        var made = await Engine(kit).GenerateCancellationAsync(noShow.Id, "NSDH", Monday.AddDays(2), Ct);

        var units = new List<decimal>();
        foreach (var shift in attendees) units.Add(Assert.Single(await LinesOf(kit, shift.Id)).UnitPrice);
        units.Add(Assert.Single(await LinesOf(kit, noShow.Id)).UnitPrice);
        Assert.All(units, u => Assert.Equal(14.00m, u));   // five seats, the no-show's included
        Assert.Equal(70.00m, units.Sum());
        Assert.Equal(42.00m, made.Claim.TotalAmount);
    }

    // GCH-D1: a group line waits until its activity can no longer change (Completed, PendingReview, Cancelled), so a later claim never divides by a different N.

    private static GroupActivity RealActivity(LedgerKit kit, Guid id, ShiftStatus status)
    {
        var activity = new GroupActivity { Id = id, TenantId = kit.TenantId, ServiceDate = Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), Title = "Bowling", Status = status };
        kit.Db.GroupActivities.Add(activity);
        kit.Db.SaveChanges();
        return activity;
    }

    [Fact]
    public async Task CancellationClaim_ActivityStillInProgress_LeftOut_ThenOfferedOnceCompleted_AndTheLinesStayWithinTheRate()
    {
        var kit = Arrange();
        foreach (var item in kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
        kit.Db.SaveChanges();
        var activity = Guid.NewGuid();
        var row = RealActivity(kit, activity, ShiftStatus.InProgress);
        var first = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        var attendees = Others(kit, activity, 5).Prepend(first).ToList();   // six attend
        var noShow = Others(kit, activity, 1, status: ShiftStatus.Cancelled, cancelledAt: OnTheDay).Single();
        Staff(kit, activity, 2);

        var early = await Assert.ThrowsAsync<NothingClaimableException>(() => Engine(kit).GenerateCancellationAsync(noShow.Id, "NSDH", Monday.AddDays(1), Ct));

        Assert.Contains(GroupHeadcount.NotFinished, early.Message);
        Assert.Empty(await LinesOf(kit, noShow.Id));

        row.Status = ShiftStatus.Completed;
        kit.Db.SaveChanges();
        foreach (var shift in attendees) await Engine(kit).GenerateAsync(shift.ParticipantId, From, To, Ct);
        await Engine(kit).GenerateCancellationAsync(noShow.Id, "NSDH", Monday.AddDays(1), Ct);

        var lines = new List<ClaimLineItem>();
        foreach (var shift in attendees.Append(noShow)) lines.AddRange(await LinesOf(kit, shift.Id));
        Assert.Equal(7, lines.Count);
        Assert.True(lines.Sum(l => l.TotalAmount) <= 2 * 70.01m * 3);   // two workers x the rate x three hours
    }

    [Fact]
    public async Task ClaimRun_CompletedShiftOnAnActivityStillInProgress_LeftOut()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        RealActivity(kit, activity, ShiftStatus.InProgress);
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);

        var refused = await Assert.ThrowsAsync<NothingClaimableException>(() => Engine(kit).GenerateAsync(shift.ParticipantId, From, To, Ct));

        Assert.Contains(GroupHeadcount.NotFinished, refused.Message);
        Assert.Empty(await LinesOf(kit, shift.Id));
    }

    [Fact]
    public async Task CancellationClaim_CancelledActivity_StillOffered()
    {
        var kit = Arrange();
        foreach (var item in kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
        kit.Db.SaveChanges();
        var activity = Guid.NewGuid();
        RealActivity(kit, activity, ShiftStatus.Cancelled);
        var noShow = Others(kit, activity, 1, status: ShiftStatus.Cancelled, cancelledAt: OnTheDay).Single();

        await Engine(kit).GenerateCancellationAsync(noShow.Id, "NSDH", Monday.AddDays(1), Ct);

        Assert.Single(await LinesOf(kit, noShow.Id));
    }

    [Fact]
    public async Task ClaimRun_CancelledSevenDaysAhead_LowersTheCount()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 3);
        Others(kit, activity, 1, status: ShiftStatus.Cancelled, cancelledAt: OnTheDay.AddDays(-7));

        Assert.Equal(17.50m, await UnitOf(kit, shift));   // four are in the group
    }

    [Fact]
    public async Task ClaimRun_DidNotAttendMark_DoesNotChangeTheCount()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 3);
        Others(kit, activity, 1, status: ShiftStatus.Cancelled, cancelledAt: OnTheDay);

        Assert.Equal(14.00m, await UnitOf(kit, shift));   // five: the marked person's cancellation can be claimed, so the seat stays
    }

    [Fact]
    public async Task CancellationClaim_ChooserAmount_EqualsTheClaims()
    {
        var kit = Arrange();
        foreach (var item in kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
        kit.Db.SaveChanges();
        var activity = Guid.NewGuid();
        Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 3);
        var cancelled = Others(kit, activity, 1, status: ShiftStatus.Cancelled, cancelledAt: OnTheDay).Single();
        var today = Monday.AddDays(2);

        var offered = Assert.Single((await Engine(kit).CancellationCandidatesAsync(kit.TenantId, today, Ct)).Shifts);
        var made = await Engine(kit).GenerateCancellationAsync(cancelled.Id, "NSDH", today, Ct);

        Assert.Equal(cancelled.Id, offered.ShiftId);
        Assert.Equal(14.00m, Assert.Single(await LinesOf(kit, cancelled.Id)).UnitPrice);
        Assert.Equal(made.Claim.TotalAmount, offered.TotalAmount);
    }

    [Fact]
    public async Task Ledger_CompletedShift_AndClaimAgain_EqualTheClaim_WithTwoWorkers()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var first = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 6);
        Staff(kit, activity, 2);

        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { first.ParticipantId }, Ct))[first.ParticipantId];
        var estimate = Assert.Single(ledger.Items, i => i.ShiftId == first.Id);
        var made = await Engine(kit).GenerateAsync(first.ParticipantId, From, To, Ct);
        made.Claim.Status = TripClaimStatus.Rejected;
        foreach (var l in kit.Db.ClaimLineItems.Where(l => l.TripClaimId == made.Claim.Id)) l.Status = ClaimLineItemStatus.Submitted;
        kit.Db.SaveChanges();
        var again = await Engine(kit).ClaimAgainAsync(made.Claim.Id, kit.TenantId, Monday.AddDays(5), Ct);

        Assert.Equal(52.50m, estimate.Amount);   // seven people over two workers is four: 3 h x 17.50
        Assert.Equal(52.50m, made.Claim.TotalAmount);
        Assert.Equal(52.50m, again.Claim.TotalAmount);
    }

    [Fact]
    public async Task Estimate_AndANotYetCompletedLedger_PriceAtTheQuotedShare_TheClaimAtTheCount()
    {
        // Five attend one worker: the claim is 14.00. The estimate and a not-yet-completed shift keep the quoted 23.33, the most any later claim can be.
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var first = Attached(kit, Person(kit), SupportRatio.OneToThree, activity, status: ShiftStatus.Published);
        var others = Others(kit, activity, 4, status: ShiftStatus.Published);
        Staff(kit, activity, 1);

        var estimate = Assert.Single(await new LedgerShiftCostSource(kit.Db, kit.Ledger).EstimateAsync(kit.TenantId, first.ParticipantId, new[] { GroupSpec(activity) }, Ct));
        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { first.ParticipantId }, Ct))[first.ParticipantId];
        foreach (var s in others.Prepend(first)) s.Status = ShiftStatus.Completed;
        kit.Db.SaveChanges();
        var completed = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { first.ParticipantId }, Ct))[first.ParticipantId];
        var made = await Engine(kit).GenerateAsync(first.ParticipantId, From, To, Ct);

        Assert.Equal(69.99m, Assert.IsType<ShiftCostEstimate.Priced>(estimate).Amount);
        Assert.Equal(69.99m, Assert.Single(ledger.Items, i => i.ShiftId == first.Id).Amount);
        Assert.Equal(42.00m, Assert.Single(completed.Items, i => i.ShiftId == first.Id).Amount);
        Assert.Equal(42.00m, made.Claim.TotalAmount);
        Assert.True(made.Claim.TotalAmount <= 69.99m);   // the forecast is never below the claim
    }

    [Fact]
    public async Task Estimate_SixAtOneToThree_NoStaffRows_IsTheQuotedShare_AndTheClaimWithTwoRowsEqualsIt()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var first = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 5);

        var estimate = Assert.Single(await new LedgerShiftCostSource(kit.Db, kit.Ledger).EstimateAsync(kit.TenantId, first.ParticipantId, new[] { GroupSpec(activity) }, Ct));
        Staff(kit, activity, 2);

        Assert.Equal(69.99m, Assert.IsType<ShiftCostEstimate.Priced>(estimate).Amount);   // 23.33 x 3 h
        Assert.Equal(23.33m, await UnitOf(kit, first));
    }

    [Fact]
    public async Task ClaimRun_OtherOrgsShiftsOnTheSameActivityId_NotCounted()
    {
        var kit = Arrange();
        Moq.Mock.Get(kit.Tenant).Setup(t => t.IsSuperAdmin).Returns(true);   // the global filter is off, so only the explicit tenant filter decides
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 1);
        Others(kit, activity, 3, tenant: Guid.NewGuid());

        Assert.Equal(23.33m, await UnitOf(kit, shift));   // two in this org; 17.50 if the other org's three leaked in
    }

    [Fact]
    public async Task ClaimRun_OtherOrgsStaffRowsOnTheSameActivityId_NotCounted()
    {
        var kit = Arrange();
        Moq.Mock.Get(kit.Tenant).Setup(t => t.IsSuperAdmin).Returns(true);
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 5);
        Staff(kit, activity, 2, tenant: Guid.NewGuid());

        Assert.Equal(11.66m, await UnitOf(kit, shift));   // six people, one worker; 23.33 if the other org's two rows leaked in
    }

    [Fact]
    public async Task ClaimRun_MoreThanFortyAttend_PricesThroughTheClaim()
    {
        var kit = Arrange();
        var activity = Guid.NewGuid();
        var shift = Attached(kit, Person(kit), SupportRatio.OneToThree, activity);
        Others(kit, activity, 44);

        var unit = await UnitOf(kit, shift);

        Assert.Equal(1.55m, unit);   // 70.01 / 45 = 1.5557, floored
        Assert.True(45 * unit <= 70.01m);
    }
}
