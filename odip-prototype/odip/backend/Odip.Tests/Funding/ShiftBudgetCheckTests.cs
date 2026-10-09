using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The budget check of one shift (budget phase 3) against a real ledger: the participant's current plan, what is already claimed, pending and booked, and this shift counted in (or, for an edit, the
/// shift's old cost replaced by its new one). Fixed clock: 4 Oct 2026, a Sunday. The fixtures are NSW weekdays at $60 an hour, so an 8-hour shift is $480.
/// </summary>
public class ShiftBudgetCheckTests : IDisposable
{
    // Weekdays in the October to December quarter (Mon 12 Oct 2026 onwards) and in the next quarter (Mon 11 Jan 2027).
    private static readonly DateOnly Mon12Oct = new(2026, 10, 12);
    private static readonly DateOnly Tue13Oct = new(2026, 10, 13);
    private static readonly DateOnly Wed14Oct = new(2026, 10, 14);
    private static readonly DateOnly Mon11Jan = new(2027, 1, 11);

    private readonly LedgerKit _kit = LedgerKit.Create();

    public void Dispose() => _kit.Dispose();

    private (Participant Participant, FundingPlan Plan) Seed(decimal october = 1000m, decimal january = 5000m, PlanType planType = PlanType.PlanManaged, bool withCatalogue = true)
    {
        _kit.SeedProvider("NSW");
        if (withCatalogue) _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant(planType);
        var plan = _kit.SeedPlan(participant, LedgerKit.Core(planType, LedgerKit.Q(2, october), LedgerKit.Q(3, january)));
        return (participant, plan);
    }

    private void Mode(BudgetLimitMode mode, int approaching = 80, Guid? tenantId = null)
    {
        _kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = tenantId ?? _kit.TenantId, Mode = mode, ApproachingPercent = approaching });
        _kit.Db.SaveChanges();
    }

    private ShiftBudgetCheck Service(IShiftCostSource? costs = null) => new(_kit.Db, _kit.Ledger, costs);

    private static ShiftBudgetRequest Request(
        Participant participant, DateOnly date, int startHour = 9, int endHour = 17, Guid? shiftId = null, ShiftStatus? status = null, bool admin = false, Guid? tenantId = null) =>
        new(tenantId ?? participant.TenantId, participant.Id, shiftId, date, new TimeOnly(startHour, 0), new TimeOnly(endHour, 0), false, SupportRatio.OneToOne, SleepoverType.None, status, admin);

    private static RosterFinding? Find(ShiftBudgetOutcome outcome, string code) => outcome.Findings.SingleOrDefault(f => f.Code == code);

    // ── Creating a shift ────────────────────────────────────────────────────

    [Fact]
    public async Task AParticipantWithNoPlan_GetsNoFindingAtAll()
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant();
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct), default);

        Assert.Empty(outcome.Findings);
        Assert.Null(outcome.NotCheckedReason);
    }

    [Fact]
    public async Task AShiftWithinTheBudget_GetsNoFinding()
    {
        var (participant, _) = Seed(october: 5000m);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct), default);

        Assert.Empty(outcome.Findings);
    }

    [Fact]
    public async Task AShiftThatTakesTheForecastPastTheBudget_InWarnMode_IsAWarningWithTheFigures()
    {
        var (participant, _) = Seed(october: 1000m);
        _kit.SeedShift(participant, Mon12Oct);   // $480 booked ahead
        _kit.SeedShift(participant, Tue13Oct);   // $960 in all

        var outcome = await Service().CheckAsync(Request(participant, Wed14Oct), default);

        var finding = Assert.Single(outcome.Findings);
        Assert.Equal((BudgetFindingCodes.ForecastOver, RosterFindingSeverity.Warning, false), (finding.Code, finding.Severity, finding.RequiresReason));
        Assert.Equal("Takes Core (flexible) to $1,440.00 of $1,000.00 for 1\u00A0Oct\u00A0\u2013\u2060\u00A031\u00A0Dec\u00A02026, $440.00 over. This shift: about $480.00.", finding.Message);
        Assert.Equal(new BudgetFindingFigures("Core (flexible)", new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 31), 1000m, 0m, 1440m, 480m, BookedAhead: 960m, UnpricedShiftCount: 0), finding.Budget);
    }

    [Fact]
    public async Task TheFindingsFiguresCountThePeriodsShiftsThatCouldNotBePriced_BecauseTheyAreLeftOutOfTheForecast()
    {
        // The fix branch counts, in each period, the shifts the estimator refuses (a sleepover, a group shift, no rate): they are $0 in every figure, so the figures say how many were left out.
        var (participant, _) = Seed(october: 1000m);
        _kit.SeedShift(participant, Mon12Oct);   // $480 booked ahead
        _kit.SeedShift(participant, Tue13Oct);   // $960 in all
        var sleepover = _kit.SeedShift(participant, new DateOnly(2026, 10, 15));
        sleepover.NightType = SleepoverType.Sleepover;
        _kit.Db.SaveChanges();

        var outcome = await Service().CheckAsync(Request(participant, Wed14Oct), default);

        var figures = Find(outcome, BudgetFindingCodes.ForecastOver)!.Budget!;
        Assert.Equal((1, 960m), (figures.UnpricedShiftCount, figures.BookedAhead));
    }

    [Fact]
    public async Task AShiftDatedBeforeToday_IsPending_SoUsedLeavesItOut_AndTheRowsAddUp()
    {
        // Phase 3 review, N3: a shift dated before today is Pending, so the period's Used already holds it. The figures report Used WITHOUT the new shift, as they report booked ahead without it, so used + booked ahead
        // + this shift is the forecast the panel prints.
        var (participant, _) = Seed(october: 1000m);
        _kit.SeedShift(participant, new DateOnly(2026, 10, 1), ShiftStatus.Completed);   // $480 used, not yet claimed
        _kit.SeedShift(participant, Mon12Oct);                                           // $480 booked ahead

        var outcome = await Service().CheckAsync(Request(participant, new DateOnly(2026, 10, 2)), default);   // a backfill: Friday 2 Oct, before the 4 Oct clock

        var figures = Find(outcome, BudgetFindingCodes.ForecastOver)!.Budget!;
        Assert.Equal((480m, 480m, 480m, 1440m), (figures.Used, figures.BookedAhead, figures.ShiftCost, figures.Forecast));
        Assert.Equal(figures.Forecast, figures.Used + figures.BookedAhead + figures.ShiftCost);
    }

    [Fact]
    public async Task AShiftDatedBeforeToday_IsNotCalledAnOverrunThePeriodDidNotHaveBeforeIt()
    {
        // $480 used of $700: the period was not over before this $480 backfill, so "already over" would be false, though used WITH the shift ($960) is above $700.
        var (participant, _) = Seed(october: 700m);
        _kit.SeedShift(participant, new DateOnly(2026, 10, 1), ShiftStatus.Completed);

        var outcome = await Service().CheckAsync(Request(participant, new DateOnly(2026, 10, 2)), default);

        Assert.Null(Find(outcome, BudgetFindingCodes.Over));
        Assert.NotNull(Find(outcome, BudgetFindingCodes.ForecastOver));   // it is the new shift that takes it over
    }

    [Theory]
    [InlineData(false, RosterFindingSeverity.Blocking, false)]
    [InlineData(true, RosterFindingSeverity.Warning, true)]
    public async Task UnderAHardLimit_ANewOneOffShiftPastTheBudget_BlocksACoordinator_AndAsksAnAdminForAReason(bool admin, RosterFindingSeverity severity, bool requiresReason)
    {
        var (participant, _) = Seed(october: 1000m);
        _kit.SeedShift(participant, Mon12Oct);
        _kit.SeedShift(participant, Tue13Oct);
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Wed14Oct, admin: admin), default);

        var finding = Find(outcome, BudgetFindingCodes.ForecastOver)!;
        Assert.Equal((severity, requiresReason), (finding.Severity, finding.RequiresReason));
    }

    [Fact]
    public async Task AShiftDatedBeforeTodayThatNobodyResolved_CountsAsUsed_SoItCanMakeThePoolOverOrApproaching()
    {
        var (participant, _) = Seed(october: 1200m);
        _kit.SeedShift(participant, new DateOnly(2026, 10, 1), ShiftStatus.Completed);   // $480 pending: completed, not yet claimed
        _kit.SeedShift(participant, new DateOnly(2026, 10, 2), ShiftStatus.Completed);   // $960 pending: 80% of $1,200

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct, startHour: 9, endHour: 10), default);   // a one-hour shift, $60

        var finding = Assert.Single(outcome.Findings);
        Assert.Equal(BudgetFindingCodes.Approaching, finding.Code);
    }

    [Fact]
    public async Task TheApproachingPercentAndTheModeComeFromTheOrganisationsOwnSettings()
    {
        var (participant, _) = Seed(october: 1200m);
        _kit.SeedShift(participant, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        _kit.SeedShift(participant, new DateOnly(2026, 10, 2), ShiftStatus.Completed);   // 80% used
        Mode(BudgetLimitMode.Warn, approaching: 85);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct, startHour: 9, endHour: 10), default);

        Assert.Empty(outcome.Findings);   // 80% is below this organisation's 85%
    }

    [Fact]
    public async Task APoolWithASetAside_IsCheckedAgainstTheSetAside_NotThePlanAmount()
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant();
        _kit.SeedPlan(participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 10000m, setAside: 400m)));

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct), default);   // $480 against a $400 set-aside

        var finding = Assert.Single(outcome.Findings);
        Assert.Equal((BudgetFindingCodes.ForecastOver, 400m), (finding.Code, finding.Budget!.Available));
    }

    [Fact]
    public async Task OnlyTheParticipantsOwnShiftsCount()
    {
        var (participant, _) = Seed(october: 1000m);
        var other = _kit.SeedParticipant();
        _kit.SeedPlan(other, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 1000m)));
        _kit.SeedShift(other, Mon12Oct);
        _kit.SeedShift(other, Tue13Oct);

        var outcome = await Service().CheckAsync(Request(participant, Wed14Oct), default);

        Assert.Empty(outcome.Findings);
    }

    [Fact]
    public async Task AShiftOutsideThePlanDates_OrInNoRecordedPool_GetsNoFinding()
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant();
        _kit.SeedPlan(participant, LedgerKit.Stated(15, PlanType.PlanManaged, LedgerKit.Q(2, 10m)));   // no Core pool: community access has no pool here
        Mode(BudgetLimitMode.HardLimit);

        var noPool = await Service().CheckAsync(Request(participant, Mon12Oct), default);
        var beforeThePlan = await Service().CheckAsync(Request(participant, new DateOnly(2026, 6, 15)), default);
        var afterThePlan = await Service().CheckAsync(Request(participant, new DateOnly(2027, 8, 2)), default);

        Assert.Empty(noPool.Findings);
        Assert.Empty(beforeThePlan.Findings);
        Assert.Empty(afterThePlan.Findings);
    }

    // ── What is never blocked ───────────────────────────────────────────────

    [Fact]
    public async Task CancellingAShift_NeverGetsAFinding_InAnyMode()
    {
        var (participant, _) = Seed(october: 100m);
        var shift = _kit.SeedShift(participant, Mon12Oct);
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct, shiftId: shift.Id, status: ShiftStatus.Cancelled), default);

        Assert.Empty(outcome.Findings);
    }

    [Theory]
    [InlineData(ShiftStatus.InProgress)]
    [InlineData(ShiftStatus.PendingReview)]
    [InlineData(ShiftStatus.Completed)]
    public async Task AShiftThatHasStartedOrFinished_NeverGetsAFinding_AndSoIsNeverBlocked(ShiftStatus status)
    {
        var (participant, _) = Seed(october: 100m);
        var shift = _kit.SeedShift(participant, Mon12Oct, status);
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct, shiftId: shift.Id), default);

        Assert.Empty(outcome.Findings);
    }

    // ── Editing a shift ─────────────────────────────────────────────────────

    [Fact]
    public async Task AnEditThatRaisesTheCost_IsBlockedForACoordinator_AndTheOldCostIsReplacedNotAdded()
    {
        var (participant, _) = Seed(october: 600m);
        var shift = _kit.SeedShift(participant, Mon12Oct);   // $480 of $600
        Mode(BudgetLimitMode.HardLimit);

        var toTenHours = await Service().CheckAsync(Request(participant, Mon12Oct, endHour: 19, shiftId: shift.Id), default);      // $600 of $600: within
        var toElevenHours = await Service().CheckAsync(Request(participant, Mon12Oct, endHour: 20, shiftId: shift.Id), default);   // $660 of $600

        Assert.Empty(toTenHours.Findings);
        var finding = Find(toElevenHours, BudgetFindingCodes.ForecastOver)!;
        Assert.Equal(RosterFindingSeverity.Blocking, finding.Severity);
        Assert.Equal(660m, finding.Budget!.Forecast);   // the old $480 is replaced by the new $660, not added to it
    }

    [Theory]
    [InlineData(17, false)]   // unchanged, a Coordinator
    [InlineData(15, false)]   // lowered, a Coordinator
    [InlineData(17, true)]    // unchanged, an Admin
    [InlineData(15, true)]    // lowered, an Admin
    public async Task AnEditThatDoesNotRaiseTheCost_OfAShiftAlreadyPastTheBudget_OnlyWarns(int endHour, bool admin)
    {
        var (participant, _) = Seed(october: 300m);
        var shift = _kit.SeedShift(participant, Mon12Oct);   // $480 of $300: already past
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct, endHour: endHour, shiftId: shift.Id, admin: admin), default);

        var finding = Find(outcome, BudgetFindingCodes.ForecastOver)!;
        Assert.Equal((RosterFindingSeverity.Warning, false), (finding.Severity, finding.RequiresReason));
    }

    [Fact]
    public async Task MovingAShiftIntoATighterPeriod_IsARaiseThere_EvenAtTheSameCost()
    {
        var (participant, _) = Seed(october: 500m, january: 5000m);
        _kit.SeedShift(participant, Mon12Oct);                          // $480 of $500 in the October quarter
        var movable = _kit.SeedShift(participant, Mon11Jan);            // $480 in January, well within budget
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Tue13Oct, shiftId: movable.Id), default);   // same $480, now into October: $960 of $500

        var finding = Find(outcome, BudgetFindingCodes.ForecastOver)!;
        Assert.Equal(RosterFindingSeverity.Blocking, finding.Severity);
        Assert.Equal(960m, finding.Budget!.Forecast);
    }

    [Fact]
    public async Task AnEditNotChangingThePeriod_DoesNotCountTheShiftTwice()
    {
        var (participant, _) = Seed(october: 1000m);
        var shift = _kit.SeedShift(participant, Mon12Oct);   // $480

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct, shiftId: shift.Id), default);

        Assert.Empty(outcome.Findings);   // $480 of $1,000, not $960
    }

    [Fact]
    public async Task UnCancellingAShift_RaisesTheCostFromNothing()
    {
        var (participant, _) = Seed(october: 300m);
        var shift = _kit.SeedShift(participant, Mon12Oct, ShiftStatus.Cancelled);
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct, shiftId: shift.Id, status: ShiftStatus.Draft), default);

        Assert.Equal(RosterFindingSeverity.Blocking, Find(outcome, BudgetFindingCodes.ForecastOver)!.Severity);
    }

    [Fact]
    public async Task AShiftOfAnotherParticipantsLedger_IsNotTakenOutOfThisOnes_WhenAnEditMovesIt()
    {
        var (participant, _) = Seed(october: 600m);
        var other = _kit.SeedParticipant();
        _kit.SeedPlan(other, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 5000m)));
        var shift = _kit.SeedShift(other, Mon12Oct);
        _kit.SeedShift(participant, Tue13Oct);   // $480 of $600 already
        Mode(BudgetLimitMode.HardLimit);

        // The shift is moved onto this participant: for them it is a new shift, so it adds its whole $480.
        var outcome = await Service().CheckAsync(Request(participant, Wed14Oct, shiftId: shift.Id), default);

        var finding = Find(outcome, BudgetFindingCodes.ForecastOver)!;
        Assert.Equal((RosterFindingSeverity.Blocking, 960m), (finding.Severity, finding.Budget!.Forecast));
    }

    // ── One-off or from a pattern ───────────────────────────────────────────

    private ShiftPattern SeedPattern(Participant participant)
    {
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        };
        _kit.Db.ShiftPatterns.Add(pattern);
        _kit.Db.SaveChanges();
        return pattern;
    }

    [Fact]
    public async Task ANewShift_IsAOneOff_WhateverPatternAnyoneNamed_BecauseOnlyALinkTheServerSetCounts()
    {
        // The phase 3 review (C3). A new shift has no saved link, so the check never sees a pattern for it; the controller drops one a request names.
        var (participant, _) = Seed(october: 300m);
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct), default);

        Assert.Equal(RosterFindingSeverity.Blocking, Find(outcome, BudgetFindingCodes.ForecastOver)!.Severity);
    }

    [Fact]
    public async Task AnEditJudgesTheShiftByItsSavedPatternLink()
    {
        var (participant, _) = Seed(october: 300m);
        var pattern = SeedPattern(participant);
        var fromPattern = _kit.SeedShift(participant, Mon12Oct);
        fromPattern.ShiftPatternId = pattern.Id;
        var oneOff = _kit.SeedShift(participant, Tue13Oct);
        _kit.Db.SaveChanges();
        Mode(BudgetLimitMode.HardLimit);

        var routine = await Service().CheckAsync(Request(participant, Mon12Oct, endHour: 19, shiftId: fromPattern.Id), default);
        var single = await Service().CheckAsync(Request(participant, Tue13Oct, endHour: 19, shiftId: oneOff.Id), default);

        Assert.Equal((RosterFindingSeverity.Warning, false), (Find(routine, BudgetFindingCodes.ForecastOver)!.Severity, Find(routine, BudgetFindingCodes.ForecastOver)!.RequiresReason));
        Assert.Equal(RosterFindingSeverity.Blocking, Find(single, BudgetFindingCodes.ForecastOver)!.Severity);
    }

    [Fact]
    public async Task ALinkToAnotherParticipantsPattern_DoesNotMakeAShiftRoutine_SoAShiftMovedToSomeoneElseMeetsTheLimit()
    {
        var (participant, _) = Seed(october: 300m);
        var other = _kit.SeedParticipant();
        var strangers = SeedPattern(other);
        var moved = _kit.SeedShift(participant, Mon12Oct);
        moved.ShiftPatternId = strangers.Id;   // it was another participant's pattern shift before it was moved here
        _kit.Db.SaveChanges();
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct, endHour: 19, shiftId: moved.Id), default);

        Assert.Equal(RosterFindingSeverity.Blocking, Find(outcome, BudgetFindingCodes.ForecastOver)!.Severity);
    }

    // ── A shift the estimator cannot price ──────────────────────────────────

    [Fact]
    public async Task AShiftTheEstimatorCannotPrice_GetsNoFinding_IsNeverBlocked_AndSaysWhyItWasNotChecked()
    {
        var (participant, _) = Seed(october: 1m);
        Mode(BudgetLimitMode.HardLimit);
        var stub = new Mock<IShiftCostSource>();
        stub.Setup(s => s.EstimateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<ShiftSpec>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid _, Guid _, IReadOnlyList<ShiftSpec> specs, CancellationToken _) => specs.Select(_ => (ShiftCostEstimate)new ShiftCostEstimate.NotPriced("sleepover shifts are not priced yet")).ToList());

        var outcome = await Service(stub.Object).CheckAsync(Request(participant, Mon12Oct), default);

        Assert.Empty(outcome.Findings);
        Assert.Equal("sleepover shifts are not priced yet", outcome.NotCheckedReason);
        Assert.Equal("Budget not checked: sleepover shifts are not priced yet.", outcome.Note);
    }

    [Fact]
    public async Task AnEditWhoseOldVersionCannotBePriced_CountsTheOldCostAsNothing_SoTheNewOneIsARaise()
    {
        var (participant, _) = Seed(october: 300m);
        var shift = _kit.SeedShift(participant, Mon12Oct);
        Mode(BudgetLimitMode.HardLimit);
        var calls = 0;
        var stub = new Mock<IShiftCostSource>();
        stub.Setup(s => s.EstimateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<ShiftSpec>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid _, Guid _, IReadOnlyList<ShiftSpec> specs, CancellationToken _) =>
            {
                calls++;
                // The first spec is the new version: priced. The second, the saved one: not priced.
                return specs.Select((_, i) => i == 0 ? new ShiftCostEstimate.Priced(480m, 4) : (ShiftCostEstimate)new ShiftCostEstimate.NotPriced("unpriced")).ToList();
            });

        var outcome = await Service(stub.Object).CheckAsync(Request(participant, Mon12Oct, shiftId: shift.Id), default);

        Assert.Equal(1, calls);   // one batch for both versions
        Assert.Equal(RosterFindingSeverity.Blocking, Find(outcome, BudgetFindingCodes.ForecastOver)!.Severity);
    }

    [Fact]
    public async Task WithNoCatalogueRateForTheDate_TheRealEstimatorSaysSo_AndNothingIsChecked()
    {
        var (participant, _) = Seed(october: 1m, withCatalogue: false);
        Mode(BudgetLimitMode.HardLimit);

        var outcome = await Service().CheckAsync(Request(participant, Mon12Oct), default);

        Assert.Empty(outcome.Findings);
        Assert.StartsWith("no catalogue rate covers", outcome.NotCheckedReason);   // the exact words are the estimator's own, and may change with it
    }

    // Through the REAL estimator, as the budget fix (round 1b) leaves it: the shift claim engine prices one-to-one and two-to-one community access only, so a group shift, a sleepover and a passive night have no
    // price, are not checked and are never blocked, even where the same shift as one-to-one would be refused. When the engine prices them this test is where to decide what a hard limit does about them.
    [Theory]
    [InlineData(SupportRatio.OneToThree, SleepoverType.None)]
    [InlineData(SupportRatio.OneToOne, SleepoverType.Sleepover)]
    [InlineData(SupportRatio.OneToOne, SleepoverType.PassiveNight)]
    public async Task AShiftTheClaimEngineDoesNotPriceYet_IsNotChecked_EvenWhereAOneToOneShiftWouldBeRefused(SupportRatio ratio, SleepoverType nightType)
    {
        var (participant, _) = Seed(october: 100m);
        Mode(BudgetLimitMode.HardLimit);

        var oneToOne = await Service().CheckAsync(Request(participant, Mon12Oct), default);
        var unpriced = await Service().CheckAsync(Request(participant, Mon12Oct) with { Ratio = ratio, NightType = nightType }, default);

        Assert.Equal(RosterFindingSeverity.Blocking, Find(oneToOne, BudgetFindingCodes.ForecastOver)!.Severity);
        Assert.Empty(unpriced.Findings);
        Assert.StartsWith("Budget not checked: ", unpriced.Note);
    }

    // ── Whose money ─────────────────────────────────────────────────────────

    [Fact]
    public async Task AnotherOrganisationsParticipant_IsAbsent_AndGetsNothing()
    {
        var database = Guid.NewGuid().ToString();
        using var a = LedgerKit.Create(LedgerKit.TenantA, database);
        using var b = LedgerKit.Create(LedgerKit.TenantB, database);
        a.SeedProvider("NSW");
        a.SeedCommunityAccessCatalogue();
        var theirs = a.SeedParticipant();
        a.SeedPlan(theirs, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 100m)));

        var asB = await new ShiftBudgetCheck(b.Db, b.Ledger).CheckAsync(Request(theirs, Mon12Oct, tenantId: LedgerKit.TenantB), default);
        var asA = await new ShiftBudgetCheck(a.Db, a.Ledger).CheckAsync(Request(theirs, Mon12Oct), default);

        Assert.Empty(asB.Findings);   // organisation B cannot see A's participant, so it has no money to show
        Assert.NotEmpty(asA.Findings);
    }
}
