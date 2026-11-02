using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// Shift billing PR4 (S-4, N-3): a shift that crosses a rate band into another PACE category or another day is counted as one ledger item for each (date, category) part of it, exactly as the claim
/// lines it becomes, so the claim, the ledger and the roster estimate agree per category and per pool. Fixtures (VIC, no state on the participant): community access weekday $50, evening $55;
/// a support type X (category 15) with the same two rates and no night row; personal care night $60 (category 1). Wed 7 Oct 2026 18:00 to Thu 02:00 is 2 h weekday + 4 h evening on Wednesday
/// (category 4, or 15 for X: $320) and 2 h night on Thursday (the personal care night row, category 1: $120). Clock: 4 Oct 2026, a Sunday.
/// </summary>
public class ShiftSplitBudgetTests : IDisposable
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Wed = new(2026, 10, 7), Thu = new(2026, 10, 8), Sep30 = new(2026, 9, 30), Oct1 = new(2026, 10, 1);
    private const string GroupX = "GRP_X";

    private readonly LedgerKit _kit;

    public ShiftSplitBudgetTests() => _kit = Arrange(LedgerKit.Create());

    public void Dispose() => _kit.Dispose();

    private static LedgerKit Arrange(LedgerKit kit)
    {
        kit.SeedProvider("VIC");
        kit.EnsureCommunityAccessCatalogue();
        EnsureRows(kit);
        return kit;
    }

    private static void EnsureRows(LedgerKit kit)
    {
        if (!kit.Db.SupportCatalogueItems.Any(i => i.ItemNumber == "PC_Night")) Row(kit, CatalogueGroups.PersonalCareGroupCode, "PC_Night", ClaimDayType.WeekdayNight, 60m, 1);
        if (kit.Db.SupportCatalogueItems.Any(i => i.ItemNumber == "X_Weekday")) return;
        Row(kit, GroupX, "X_Weekday", ClaimDayType.Weekday, 50m, 15);
        Row(kit, GroupX, "X_Evening", ClaimDayType.WeekdayEvening, 55m, 15);
    }

    private static void Row(LedgerKit kit, string group, string number, ClaimDayType dayType, decimal price, int category, string unit = "H")
    {
        kit.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = kit.SeedGroup(group, group, category).Id, ItemNumber = number, Description = number, DayType = dayType, IsIntensive = false, Unit = unit,
            PriceLimit_VIC = price, PriceLimit_NSW = price, PriceLimit_ACT = price, PriceLimit_NT = price, PriceLimit_QLD = price, PriceLimit_SA = price, PriceLimit_TAS = price, PriceLimit_WA = price,
            PriceLimit_Remote = price, PriceLimit_VeryRemote = price, CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
            PaceSupportCategoryNumber = category, SupportCategoryNumber = category,
        });
        kit.Db.SaveChanges();
    }

    private static Shift Overnight(LedgerKit kit, Participant person, DateOnly date, ShiftStatus status, string? group = null, int startHour = 18, int endHour = 2)
    {
        var shift = kit.SeedShift(person, date, status, startHour, endHour, endsNextDay: true);
        shift.SupportGroupCode = group;
        kit.Db.SaveChanges();
        return shift;
    }

    private static async Task<ParticipantLedger> LedgerOf(LedgerKit kit, Participant person) => (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id];

    private static PeriodLedger PeriodOf(PlanLedger ledger, FundingPoolKind kind, DateOnly day) =>
        ledger.Pools.Single(p => p.Pool.Kind == kind).Periods.Single(p => p.Period.PeriodStart <= day && day <= p.Period.PeriodEnd);

    private static Dictionary<(DateOnly, int?), decimal> ByDateAndCategory(IEnumerable<LedgerItem> items) =>
        items.GroupBy(i => (i.Date, i.PaceCategory)).ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

    private static async Task<Dictionary<(DateOnly, int?), decimal>> ClaimByDateAndCategory(LedgerKit kit, Participant person, DateOnly from, DateOnly to)
    {
        var claim = (await new ShiftClaimGenerationService(kit.Db).GenerateAsync(person.Id, from, to, Ct)).Claim;
        var lines = await kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToListAsync(Ct);
        var categories = kit.Db.SupportCatalogueItems.AsEnumerable().GroupBy(i => i.ItemNumber).ToDictionary(g => g.Key, g => PaceCategories.Of(g.First()));
        return lines.GroupBy(l => (l.SupportsDeliveredFrom, categories[l.SupportItemCode])).ToDictionary(g => g.Key, g => g.Sum(l => l.TotalAmount));
    }

    private static Dictionary<string, decimal> PendingByPool(PlanLedger ledger) =>
        ledger.Pools.SelectMany(pool => pool.Periods.Select(period => (Key: $"{pool.Pool.Name}|{period.Period.PeriodStart:yyyy-MM-dd}", period.Pending))).Where(x => x.Pending != 0m).ToDictionary(x => x.Key, x => x.Pending);

    // ── T1: the claim, the ledger and the estimate agree per category and per pool ──

    [Fact]
    public async Task ACommunityAccessEveningIntoAPersonalCareNight_IsOneLedgerItemForEachCategory_AsTheClaimLinesAre()
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)));
        var shift = Overnight(_kit, person, Wed, ShiftStatus.Completed);

        var items = (await LedgerOf(_kit, person)).Items.Where(i => i.ShiftId == shift.Id).ToList();
        var expected = new Dictionary<(DateOnly, int?), decimal> { [(Wed, 4)] = 320m, [(Thu, 1)] = 120m };
        Assert.Equal(expected, ByDateAndCategory(items));
        Assert.All(items, i => Assert.Equal(shift.Id, i.Id));
        var before = PendingByPool((await LedgerOf(_kit, person)).Ledger!);

        var claimed = await ClaimByDateAndCategory(_kit, person, Wed, Wed);

        Assert.Equal(expected, claimed);
        Assert.Equal(before, PendingByPool((await LedgerOf(_kit, person)).Ledger!));   // and the pools say the same once the claim replaces the shift
    }

    [Fact]
    public async Task AShiftWhoseGroupIsOutsideCategories1To4_SplitsIntoItsOwnPoolAndCore_AsTheClaimDoes()
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)), Stated(15, PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)));
        var shift = Overnight(_kit, person, Wed, ShiftStatus.Completed, GroupX);

        var ledger = await LedgerOf(_kit, person);
        var items = ledger.Items.Where(i => i.ShiftId == shift.Id).ToList();
        var expected = new Dictionary<(DateOnly, int?), decimal> { [(Wed, 15)] = 320m, [(Thu, 1)] = 120m };
        Assert.Equal(expected, ByDateAndCategory(items));
        Assert.Equal(320m, PeriodOf(ledger.Ledger!, FundingPoolKind.Stated, Wed).Pending);   // the evening stays in its own pool...
        Assert.Equal(120m, PeriodOf(ledger.Ledger!, FundingPoolKind.CoreFlexible, Wed).Pending);   // ...and the night is Core, as the claim bills it
        var before = PendingByPool(ledger.Ledger!);

        var claimed = await ClaimByDateAndCategory(_kit, person, Wed, Wed);

        Assert.Equal(expected, claimed);
        Assert.Equal(before, PendingByPool((await LedgerOf(_kit, person)).Ledger!));
    }

    [Fact]
    public async Task ASleepoverShiftOutsideCategories1To4_IsLedgeredPerDateAndCategory_AsTheClaimLinesAre()
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m)), Stated(15, PlanType.PlanManaged, Q(1, 100000m)));
        if (!_kit.Db.SupportCatalogueItems.Any(i => i.ItemNumber == "01_010_0107_1_1")) Row(_kit, CatalogueGroups.SleepoverGroupCode, "01_010_0107_1_1", ClaimDayType.Weekday, 150m, 1, "E");
        var shift = _kit.SeedShift(person, Wed, ShiftStatus.Completed, 22, 8, endsNextDay: true);
        shift.SupportGroupCode = GroupX;
        shift.NightType = SleepoverType.Sleepover;
        _kit.Db.SaveChanges();

        var items = (await LedgerOf(_kit, person)).Items.Where(i => i.ShiftId == shift.Id).ToList();
        var claimed = await ClaimByDateAndCategory(_kit, person, Wed, Wed);

        Assert.Equal(ByDateAndCategory(items), claimed);   // to the cent, by (date, category)
    }

    // ── T2 / T4: the roster check places each part ──

    private Participant SeedStatedPlan(decimal stated, decimal core)
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(2, core)), Stated(15, PlanType.PlanManaged, Q(2, stated)));
        return person;
    }

    [Fact]
    public async Task ANonCoreShiftsNightPart_BooksAheadInCore_AndItsEveningInTheStatedPool()
    {
        var person = SeedStatedPlan(stated: 100000m, core: 100000m);
        Overnight(_kit, person, Wed, ShiftStatus.Published, GroupX);

        var ledger = (await LedgerOf(_kit, person)).Ledger!;

        Assert.Equal(120m, PeriodOf(ledger, FundingPoolKind.CoreFlexible, Wed).BookedAhead);
        Assert.Equal(320m, PeriodOf(ledger, FundingPoolKind.Stated, Wed).BookedAhead);
    }

    [Fact]
    public async Task TheSaveCheck_JudgesTheShiftInThePoolOfItsLargestPart_AndSaysWhatThatPoolTakes()
    {
        var person = SeedStatedPlan(stated: 300m, core: 100000m);
        var request = new ShiftBudgetRequest(_kit.TenantId, person.Id, null, Wed, new TimeOnly(18, 0), new TimeOnly(2, 0), true, SupportRatio.OneToOne, SleepoverType.None, null, false, GroupX);

        var outcome = await new ShiftBudgetCheck(_kit.Db, _kit.Ledger).CheckAsync(request, Ct);

        var finding = Assert.Single(outcome.Findings);
        Assert.Equal(BudgetFindingCodes.ForecastOver, finding.Code);
        Assert.Equal(new BudgetFindingFigures(PaceCategories.NameOf(15)!, Oct1, new DateOnly(2026, 12, 31), 300m, 0m, 320m, 320m, BookedAhead: 0m, UnpricedShiftCount: 0), finding.Budget);   // 320, not the shift's 440
    }

    [Fact]
    public async Task TheSaveCheckOfAShiftOnThePlansLastDay_JudgesTheInPlanPart_EvenWhenTheOutsidePartIsLarger()   // T4b
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, new DateOnly(2026, 7, 1), Wed, Core(PlanType.PlanManaged, new PeriodSpec(new DateOnly(2026, 7, 1), Wed, 50m)));
        // Wed 23:00 to Thu 07:00: $55 of evening on the last day, then 6 h of personal care night ($360) and 1 h of weekday ($50) on Thursday, after the plan ends.
        var request = new ShiftBudgetRequest(_kit.TenantId, person.Id, null, Wed, new TimeOnly(23, 0), new TimeOnly(7, 0), true, SupportRatio.OneToOne, SleepoverType.None, null, false);

        var outcome = await new ShiftBudgetCheck(_kit.Db, _kit.Ledger).CheckAsync(request, Ct);

        var finding = Assert.Single(outcome.Findings);
        Assert.Equal(55m, finding.Budget!.ShiftCost);
        Assert.Equal(5m, finding.Budget.OverBy);
    }

    [Fact]
    public async Task AnImportedShiftOverTheLineInTwoPeriods_IsFlaggedByTheFirstPeriodThatForecastsOver()   // S-2
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(2, 100m), Q(3, 50m)));
        var dec31 = new DateOnly(2026, 12, 31);   // Thu 18:00 to Fri 02:00: $320 in the October quarter, $120 on 1 Jan in the next
        var spec = new ShiftSpec(dec31, new TimeOnly(18, 0), new TimeOnly(2, 0), true, SupportRatio.OneToOne, SleepoverType.None);
        var ledger = (await _kit.Ledger.ComputeAsync(_kit.TenantId, new[] { person.Id }, Ct))[person.Id];

        var over = Assert.Single(await new ShiftBudgetCheck(_kit.Db, _kit.Ledger).ForecastOverAsync(_kit.TenantId, person.Id, new[] { spec }, ledger, Ct));

        Assert.Equal(("Core (flexible)", 220m, false, 320m), (over!.PoolName, over.OverBy, over.AlreadyOver, over.Added));   // October's 320 over 100, not January's 120 over 50
    }

    [Fact]
    public async Task OneNewSplitShiftWithTwoPartsInOnePoolAndPeriod_ReadsThisShift_NotTheseTwo()   // S-1
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(2, 100m)));
        var planned = new PlannedShift(null, Wed, new TimeOnly(18, 0), new TimeOnly(2, 0), true, SupportRatio.OneToOne, SleepoverType.None);

        var warning = Assert.Single(await new ShiftBudgetEffect(_kit.Db, _kit.Ledger).ForShiftsAsync(_kit.TenantId, person.Id, new[] { planned }, Ct));

        Assert.Equal(1, warning.Count);
        Assert.Equal(440m, warning.Added);
        Assert.StartsWith("This shift takes", warning.Message);
    }

    // ── T3: the plan boundary (N-3) ──

    private Participant SeedTwoPlans(LedgerKit kit)
    {
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, new DateOnly(2026, 7, 1), Sep30, Core(PlanType.PlanManaged, Q(1, 100000m)));
        kit.SeedPlan(person, Oct1, new DateOnly(2027, 9, 30), Core(PlanType.PlanManaged, new PeriodSpec(Oct1, new DateOnly(2026, 12, 31), 100000m)));
        return person;
    }

    [Fact]
    public async Task APlanEndingAtMidnightOfAShift_CountsOnlyTheDayPartInPlan_AndTheNextDaysPartOutsideIt()   // T3a
    {
        var kit = Arrange(LedgerKit.Create(now: new DateTimeOffset(2026, 9, 28, 3, 0, 0, TimeSpan.Zero)));
        var person = SeedTwoPlans(kit);
        var shift = Overnight(kit, person, Sep30, ShiftStatus.Published);

        var ledger = (await LedgerOf(kit, person)).Ledger!;

        Assert.Equal(Sep30, ledger.Plan.PlanEnd);
        Assert.Equal(320m, PeriodOf(ledger, FundingPoolKind.CoreFlexible, Sep30).BookedAhead);   // the 30 Sep part, as the claim dates it
        var outside = Assert.Single(ledger.OutsideThePlan);                                         // the 1 Oct part, which the claim flags as outside the plan
        Assert.Equal((Oct1, 120m, shift.Id), (outside.Date, outside.Amount, outside.ShiftId));
    }

    [Fact]
    public async Task AShiftOverMidnightIntoTheSameCategoryOnTheLastDay_KeepsItsTwoDatesApart()   // T3d
    {
        var person = _kit.SeedParticipant();
        var fri = new DateOnly(2026, 10, 9);
        _kit.SeedPlan(person, new DateOnly(2026, 7, 1), fri, Core(PlanType.PlanManaged, new PeriodSpec(new DateOnly(2026, 7, 1), fri, 100000m)));
        // Friday 18:00 to Saturday 02:00 at community access: $320 on Friday, then 2 h of the Saturday band ($140), both category 4.
        var shift = Overnight(_kit, person, fri, ShiftStatus.Published);

        var ledger = (await LedgerOf(_kit, person)).Ledger!;

        Assert.Equal(320m, PeriodOf(ledger, FundingPoolKind.CoreFlexible, fri).BookedAhead);
        var outside = Assert.Single(ledger.OutsideThePlan);
        Assert.Equal((fri.AddDays(1), 140m, shift.Id), (outside.Date, outside.Amount, outside.ShiftId));
    }

    [Fact]
    public async Task TheNextPlan_ShowsTheAfterMidnightPartOfAShiftTheDayBeforeItStarts()   // T3b
    {
        var person = SeedTwoPlans(_kit);
        var shift = Overnight(_kit, person, Sep30, ShiftStatus.Published);   // today is 4 Oct: a past, unresolved shift

        var ledger = (await LedgerOf(_kit, person)).Ledger!;

        Assert.Equal(Oct1, ledger.Plan.PlanStart);
        var item = Assert.Single((await LedgerOf(_kit, person)).Items, i => i.ShiftId == shift.Id);
        Assert.Equal((Oct1, 120m, LedgerGroup.Pending, LedgerRowKind.PastShift), (item.Date, item.Amount, item.Group, item.Kind));
        Assert.Equal(120m, PeriodOf(ledger, FundingPoolKind.CoreFlexible, Oct1).Pending);
    }

    [Fact]
    public async Task TheDayBeforeANewPlanBeingAPublicHoliday_PricesBothPlansPartsAsTheClaimDoes()   // T3c
    {
        var person = SeedTwoPlans(_kit);
        _kit.SeedHoliday(Sep30);                                              // a whole-day holiday on the shift's own day, before plan B starts
        var shift = Overnight(_kit, person, Sep30, ShiftStatus.Completed);

        var item = Assert.Single((await LedgerOf(_kit, person)).Items, i => i.ShiftId == shift.Id);
        var claimed = await ClaimByDateAndCategory(_kit, person, Sep30, Sep30);

        Assert.Equal(claimed.Single(c => c.Key.Item1 == Oct1).Value, item.Amount);   // plan B's ledger holds the 1 Oct part at the claim's price...
        Assert.Equal(120m, item.Amount);                                             // ...a weekday night ($60 an hour for 2 h), whatever the 30 Sep holiday cost the day part
    }

    // ── T5: counts ──

    [Fact]
    public async Task APastSplitShift_IsTwoRowsButOnePastShift_AndBothPartsArePending()
    {
        var kit = Arrange(LedgerKit.Create(now: new DateTimeOffset(2026, 10, 9, 3, 0, 0, TimeSpan.Zero)));
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(2, 100000m)));
        var shift = Overnight(kit, person, Wed, ShiftStatus.Published);

        var ledger = (await LedgerOf(kit, person)).Ledger!;
        var pool = ledger.Pools.Single();
        var period = pool.Periods.Single();

        Assert.Equal(2, period.Items.Count);
        Assert.All(period.Items, i => Assert.Equal((LedgerGroup.Pending, LedgerRowKind.PastShift, shift.Id), (i.Group, i.Kind, i.ShiftId)));
        Assert.Equal(1, period.PastUnresolvedCount);
        Assert.Equal(1, pool.Total.PastUnresolvedCount);
    }

    [Fact]
    public async Task APastSplitShiftWhosePartsLandInTwoPeriods_IsOnePastShiftForThePool()
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m)));
        Overnight(_kit, person, Sep30, ShiftStatus.Published);

        var pool = (await LedgerOf(_kit, person)).Ledger!.Pools.Single();

        Assert.Equal(new[] { 1, 1 }, pool.Periods.Select(p => p.PastUnresolvedCount));
        Assert.Equal(1, pool.Total.PastUnresolvedCount);   // one shift, not one for each period it touches
    }

    // ── T6: tenant isolation ──

    [Fact]
    public async Task AnotherOrganisationsBoundaryShift_NeverReachesThisOrganisationsLedger()
    {
        var database = Guid.NewGuid().ToString();
        var a = Arrange(LedgerKit.Create(database: database));
        var b = LedgerKit.Create(LedgerKit.TenantB, database);
        b.SeedProvider("VIC", LedgerKit.TenantB);
        var ours = a.SeedParticipant(first: "Ours");
        a.SeedPlan(ours, Oct1, new DateOnly(2027, 9, 30), Core(PlanType.PlanManaged, new PeriodSpec(Oct1, new DateOnly(2026, 12, 31), 100000m)));
        var theirs = b.SeedParticipant(tenantId: LedgerKit.TenantB, first: "Theirs");
        b.SeedPlan(theirs, Oct1, new DateOnly(2027, 9, 30), Core(PlanType.PlanManaged, new PeriodSpec(Oct1, new DateOnly(2026, 12, 31), 100000m)));
        var theirShift = Overnight(b, theirs, Sep30, ShiftStatus.Published);

        var mine = await a.Ledger.ComputeAsync(a.TenantId, new[] { ours.Id, theirs.Id }, Ct);
        var theirOwn = await b.Ledger.ComputeAsync(b.TenantId, new[] { theirs.Id }, Ct);

        Assert.Empty(mine[ours.Id].Items);
        Assert.False(mine.ContainsKey(theirs.Id));
        Assert.Equal(120m, Assert.Single(theirOwn[theirs.Id].Items, i => i.ShiftId == theirShift.Id).Amount);   // the data is real: the other organisation does see its own part
    }
}
