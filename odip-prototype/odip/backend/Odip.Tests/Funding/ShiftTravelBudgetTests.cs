using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// Provider travel in the budget ledger and the roster estimate (travel plan A2, D5 and F-4): forecast from the agreement block until the completion is submitted, then the actual legs; one rule with the claim.
/// Prices: NSW community access is $60 an hour on a weekday, so an eight-hour shift is $480; the kilometre item is $1.00 an item and the rate $0.99 a kilometre.
/// </summary>
public class ShiftTravelBudgetTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Future = new(2026, 10, 12);   // a Monday after the fixed clock (4 Oct 2026)
    private static readonly DateOnly Past = new(2026, 10, 1);      // a Thursday before it

    private static (LedgerKit Kit, Participant Person) Arrange(bool orgClaims = true)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        kit.Item(ClaimDayType.Weekday).ProviderTravel = CatalogueClaimFlag.Yes;
        kit.Item(ClaimDayType.Weekday).RegistrationGroup = "0125";
        kit.Item(ClaimDayType.Weekday).ItemNumber = "04_104_0125_6_1";
        var km = kit.SeedItem("04_799_0125_6_1", 4, "GRP_PROVIDER_TRAVEL", 1m);
        km.Unit = "E"; km.RegistrationGroup = "0125";
        if (!orgClaims) kit.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = kit.TenantId, ClaimProviderTravel = false });
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(1, 5000m), LedgerKit.Q(2, 5000m), LedgerKit.Q(3, 5000m), LedgerKit.Q(4, 5000m)));
        kit.Db.SaveChanges();
        return (kit, person);
    }

    private static ShiftPattern Pattern(LedgerKit kit, Participant person, PlanProviderTravel travel)
    {
        var draft = new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = kit.TenantId, ParticipantId = person.Id, Version = 1, State = "NSW" };
        kit.Db.ServiceAgreementDrafts.Add(draft);
        kit.Db.ServiceAgreementDraftBlocks.Add(new ServiceAgreementDraftBlock
        {
            Id = Guid.NewGuid(), DraftId = draft.Id, BlockKey = "blk", BlockJson = DraftJson.Write(new PlanBlock { Travel = travel, Location = new PlanLocation { State = "NSW", Zone = PriceZone.National, Mm = 1 } }),
        });
        var pattern = new ShiftPattern { Id = Guid.NewGuid(), TenantId = kit.TenantId, ParticipantId = person.Id, SourceDraftId = draft.Id, SourceBlockKey = "blk", DayOfWeek = DayOfWeek.Monday, EffectiveFrom = Future };
        kit.Db.ShiftPatterns.Add(pattern);
        kit.Db.SaveChanges();
        return pattern;
    }

    private static Shift WithPattern(LedgerKit kit, Shift shift, ShiftPattern pattern)
    {
        shift.ShiftPatternId = pattern.Id;
        kit.Db.SaveChanges();
        return shift;
    }

    private static void Submit(LedgerKit kit, Shift shift, int? preMin = null, decimal? preKm = null, int? postMin = null, decimal? postKm = null)
    {
        kit.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = kit.TenantId, ShiftId = shift.Id, ActualStart = DateTime.UtcNow, ActualEnd = DateTime.UtcNow, TimeZoneId = "Australia/Sydney", SubmittedByUserId = Guid.NewGuid(),
            StartedAt = DateTime.UtcNow, SubmittedAt = DateTime.UtcNow, IsActive = true,
            PreShiftTravelMinutes = preMin, PreShiftTravelKilometres = preKm, PostShiftTravelMinutes = postMin, PostShiftTravelKilometres = postKm,
        });
        kit.Db.SaveChanges();
    }

    private static async Task<decimal> Total(LedgerKit kit, Participant person)
    {
        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id].Ledger!;
        return ledger.Pools[0].Periods[1].Items.Sum(i => i.Amount);
    }

    private static readonly PlanProviderTravel TwentyBothWays = new() { Claim = true, MinutesEachWay = 20, KmEachWay = 4m, ReturnToBase = true };

    [Fact]
    public async Task T14_AFutureAgreementShift_ShowsTheForecast_TwoLegsWithTheReturnBoxAndOneWithout()
    {
        var (kit, person) = Arrange();
        WithPattern(kit, kit.SeedShift(person, Future), Pattern(kit, person, TwentyBothWays));
        Assert.Equal(480m + 40.20m + 7.92m, await Total(kit, person));   // 40 min = 0.67 h x 60, and 8 km x 0.99

        var (kit2, person2) = Arrange();
        WithPattern(kit2, kit2.SeedShift(person2, Future), Pattern(kit2, person2, TwentyBothWays with { ReturnToBase = false }));
        Assert.Equal(480m + 19.80m + 3.96m, await Total(kit2, person2));   // 20 min = 0.33 h x 60, and 4 km x 0.99
    }

    [Fact]
    public async Task T14_OnceTheCompletionIsSubmitted_TheLedgerShowsTheActuals_NotTheForecast()
    {
        var (kit, person) = Arrange();
        var shift = WithPattern(kit, kit.SeedShift(person, Past, ShiftStatus.Completed), Pattern(kit, person, TwentyBothWays));
        Submit(kit, shift, preMin: 30);   // before-shift only, no km
        Assert.Equal(480m + 30.00m, await Total(kit, person));
    }

    [Fact]
    public async Task C22_ASubmittedCompletionWithNoTravel_IsNotForecast()
    {
        var (kit, person) = Arrange();
        var shift = WithPattern(kit, kit.SeedShift(person, Past, ShiftStatus.Completed), Pattern(kit, person, TwentyBothWays));
        Submit(kit, shift);
        Assert.Equal(480m, await Total(kit, person));
    }

    [Fact]
    public async Task T5_OrgOff_TheLedgerIsTheSameAsWithNoTravel()
    {
        var (kit, person) = Arrange(orgClaims: false);
        WithPattern(kit, kit.SeedShift(person, Future), Pattern(kit, person, TwentyBothWays));
        var done = kit.SeedShift(person, Past, ShiftStatus.Completed);
        Submit(kit, done, preMin: 30, preKm: 5m);
        Assert.Equal(480m + 480m, await Total(kit, person));
    }

    [Fact]
    public async Task T6_BlockOff_TheLedgerIsTheSameAsWithNoTravel()
    {
        var (kit, person) = Arrange();
        var pattern = Pattern(kit, person, TwentyBothWays with { Claim = false });
        WithPattern(kit, kit.SeedShift(person, Future), pattern);
        var done = WithPattern(kit, kit.SeedShift(person, Past, ShiftStatus.Completed), pattern);
        Submit(kit, done, preMin: 30, preKm: 5m);
        Assert.Equal(480m + 480m, await Total(kit, person));
    }

    [Fact]
    public async Task T16_TheRosterEstimate_CountsAnAgreementShiftsForecast_AndNothingForAHandMadeShift()
    {
        var (kit, person) = Arrange();
        var pattern = Pattern(kit, person, TwentyBothWays);
        var source = new LedgerShiftCostSource(kit.Db, kit.Ledger);
        ShiftSpec Spec(Guid? patternId = null, Guid? shiftId = null) =>
            new(Future, new TimeOnly(9, 0), new TimeOnly(17, 0), false, SupportRatio.OneToOne, SleepoverType.None, ShiftPatternId: patternId, ShiftId: shiftId);

        var estimates = await source.EstimateAsync(kit.TenantId, person.Id, new[] { Spec(pattern.Id), Spec() }, Ct);

        Assert.Equal(480m + 40.20m + 7.92m, Assert.IsType<ShiftCostEstimate.Priced>(estimates[0]).Amount);
        Assert.Equal(480m, Assert.IsType<ShiftCostEstimate.Priced>(estimates[1]).Amount);
    }

    [Fact]
    public async Task C22_TheRosterEstimate_OfAShiftWithASubmittedCompletionAndNoLegs_IsNotForecast()
    {
        var (kit, person) = Arrange();
        var pattern = Pattern(kit, person, TwentyBothWays);
        var shift = WithPattern(kit, kit.SeedShift(person, Future), pattern);
        Submit(kit, shift);
        var spec = new ShiftSpec(Future, new TimeOnly(9, 0), new TimeOnly(17, 0), false, SupportRatio.OneToOne, SleepoverType.None, ShiftPatternId: pattern.Id, ShiftId: shift.Id);

        var estimates = await new LedgerShiftCostSource(kit.Db, kit.Ledger).EstimateAsync(kit.TenantId, person.Id, new[] { spec }, Ct);

        Assert.Equal(480m, Assert.IsType<ShiftCostEstimate.Priced>(Assert.Single(estimates)).Amount);
    }

    // MM level on the participant (hand-made shift): the ledger and the roster estimate read the same 60-minute cap as the claim.
    [Fact]
    public async Task M5_AHandMadeCompletedShift_CountsTheParticipantsCap_AndTwoParticipantsInOneBatchKeepTheirOwn()
    {
        var (kit, mm4) = Arrange();
        mm4.MmLevel = 4;
        var unknown = kit.SeedParticipant(first: "Kim", last: "Lee");
        kit.SeedPlan(unknown, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(1, 5000m), LedgerKit.Q(2, 5000m), LedgerKit.Q(3, 5000m), LedgerKit.Q(4, 5000m)));
        Submit(kit, kit.SeedShift(mm4, Past, ShiftStatus.Completed), preMin: 60);
        Submit(kit, kit.SeedShift(unknown, Past, ShiftStatus.Completed), preMin: 60);
        kit.Db.SaveChanges();

        var both = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { mm4.Id, unknown.Id }, Ct);

        Assert.Equal(480m + 60.00m, both[mm4.Id].Ledger!.Pools[0].Periods[1].Items.Sum(i => i.Amount));   // 60 min = 1.00 h x 60
        Assert.Equal(480m + 30.00m, both[unknown.Id].Ledger!.Pools[0].Periods[1].Items.Sum(i => i.Amount));   // no level: 30
    }

    [Fact]
    public async Task M6_TheRosterEstimate_OfAHandMadeShiftWithASubmittedCompletion_UsesTheParticipantsLevel()
    {
        var (kit, person) = Arrange();
        person.MmLevel = 4;
        var shift = kit.SeedShift(person, Past, ShiftStatus.Completed);
        Submit(kit, shift, preMin: 60);
        var spec = new ShiftSpec(Past, new TimeOnly(9, 0), new TimeOnly(17, 0), false, SupportRatio.OneToOne, SleepoverType.None, ShiftId: shift.Id);

        var estimates = await new LedgerShiftCostSource(kit.Db, kit.Ledger).EstimateAsync(kit.TenantId, person.Id, new[] { spec }, Ct);

        Assert.Equal(480m + 60.00m, Assert.IsType<ShiftCostEstimate.Priced>(Assert.Single(estimates)).Amount);
    }
}
