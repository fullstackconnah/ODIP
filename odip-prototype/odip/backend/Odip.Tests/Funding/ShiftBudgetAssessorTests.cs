using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The rules that turn "this pool, this period, with this shift in it" into roster findings (budget phase 3), without a database: each finding in each mode, one-off against pattern shifts, a change that
/// raises the cost against one that does not, and an Admin against a Coordinator. Money is whole dollars so a figure can be read off a test, and a period is a quarter.
/// </summary>
public class ShiftBudgetAssessorTests
{
    private static readonly DateOnly QStart = new(2026, 10, 1);
    private static readonly DateOnly QEnd = new(2026, 12, 31);

    private static BudgetFindingFigures Figures(decimal available = 8000m, decimal used = 1000m, decimal forecast = 3000m, decimal cost = 300m, string pool = "Core (flexible)") =>
        new(pool, QStart, QEnd, available, used, forecast, cost);

    private static ShiftBudgetContext Context(
        BudgetLimitMode mode = BudgetLimitMode.Warn, int approaching = 80, bool oneOff = true, bool raises = true, bool admin = false) =>
        new(mode, approaching, oneOff, raises, admin);

    private static RosterFinding? Find(IEnumerable<RosterFinding> findings, string code) => findings.SingleOrDefault(f => f.Code == code);

    // ── Which findings, in which mode ───────────────────────────────────────

    [Fact]
    public void WithinTheBudget_NothingIsSaid()
    {
        var findings = ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 1000m, forecast: 3000m), Context());

        Assert.Empty(findings);
    }

    [Fact]
    public void ApproachingIsUsedAtTheSetPercentOfAvailable_ExactlyAtItCounts_AndNeverNeedsAReason()
    {
        // 80% of $8,000 is $6,400 to the cent.
        var at = ShiftBudgetAssessor.Assess(Figures(used: 6400m, forecast: 6700m), Context());
        var below = ShiftBudgetAssessor.Assess(Figures(used: 6399.99m, forecast: 6700m), Context());

        var approaching = Assert.Single(at);
        Assert.Equal(BudgetFindingCodes.Approaching, approaching.Code);
        Assert.Equal((RosterFindingSeverity.Warning, false), (approaching.Severity, approaching.RequiresReason));
        Assert.Empty(below);
    }

    [Theory]
    [InlineData(50, 4000, true)]
    [InlineData(95, 7599, false)]
    [InlineData(95, 7600, true)]
    public void ApproachingFollowsTheOrganisationsOwnPercent(int percent, double used, bool expected)
    {
        var findings = ShiftBudgetAssessor.Assess(Figures(used: (decimal)used, forecast: (decimal)used), Context(approaching: percent));

        Assert.Equal(expected, Find(findings, BudgetFindingCodes.Approaching) is not null);
    }

    [Fact]
    public void UsedAlreadyAboveAvailable_IsAnInformationalWarning_AndIsNotAlsoApproaching()
    {
        var findings = ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 8100m, forecast: 8400m, cost: 300m), Context());

        var over = Find(findings, BudgetFindingCodes.Over)!;
        Assert.Equal((RosterFindingSeverity.Warning, false), (over.Severity, over.RequiresReason));
        Assert.Null(Find(findings, BudgetFindingCodes.Approaching));   // the worst one shows: over, not approaching as well
    }

    [Fact]
    public void ForecastAboveAvailable_InWarnMode_IsAWarningWithNoReason_ForEveryone()
    {
        var forCoordinator = Find(ShiftBudgetAssessor.Assess(Figures(used: 1000m, forecast: 8200m), Context(BudgetLimitMode.Warn, admin: false)), BudgetFindingCodes.ForecastOver)!;
        var forAdmin = Find(ShiftBudgetAssessor.Assess(Figures(used: 1000m, forecast: 8200m), Context(BudgetLimitMode.Warn, admin: true)), BudgetFindingCodes.ForecastOver)!;

        Assert.Equal((RosterFindingSeverity.Warning, false), (forCoordinator.Severity, forCoordinator.RequiresReason));
        Assert.Equal((RosterFindingSeverity.Warning, false), (forAdmin.Severity, forAdmin.RequiresReason));
    }

    [Fact]
    public void ForecastExactlyAtAvailable_IsNotOver()
    {
        var findings = ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 1000m, forecast: 8000m), Context(BudgetLimitMode.HardLimit));

        Assert.Null(Find(findings, BudgetFindingCodes.ForecastOver));
    }

    [Fact]
    public void HardLimit_OneOffThatRaisesTheCost_BlocksACoordinator_AndAsksAnAdminForAReason()
    {
        var figures = Figures(used: 1000m, forecast: 8200m);

        var coordinator = Find(ShiftBudgetAssessor.Assess(figures, Context(BudgetLimitMode.HardLimit, oneOff: true, raises: true, admin: false)), BudgetFindingCodes.ForecastOver)!;
        var admin = Find(ShiftBudgetAssessor.Assess(figures, Context(BudgetLimitMode.HardLimit, oneOff: true, raises: true, admin: true)), BudgetFindingCodes.ForecastOver)!;

        Assert.Equal((RosterFindingSeverity.Blocking, false), (coordinator.Severity, coordinator.RequiresReason));
        Assert.Equal((RosterFindingSeverity.Warning, true), (admin.Severity, admin.RequiresReason));
    }

    [Theory]
    [InlineData(false, false)]   // an update that does not raise the cost, for a Coordinator
    [InlineData(false, true)]    // ... and for an Admin
    public void HardLimit_AnUpdateThatDoesNotRaiseTheCost_IsAWarningOnly(bool raises, bool admin)
    {
        var finding = Find(ShiftBudgetAssessor.Assess(Figures(used: 1000m, forecast: 8200m), Context(BudgetLimitMode.HardLimit, oneOff: true, raises: raises, admin: admin)), BudgetFindingCodes.ForecastOver)!;

        Assert.Equal((RosterFindingSeverity.Warning, false), (finding.Severity, finding.RequiresReason));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void HardLimit_AShiftMadeFromAPattern_AlwaysOnlyWarns(bool admin)
    {
        var finding = Find(ShiftBudgetAssessor.Assess(Figures(used: 1000m, forecast: 8200m), Context(BudgetLimitMode.HardLimit, oneOff: false, raises: true, admin: admin)), BudgetFindingCodes.ForecastOver)!;

        Assert.Equal((RosterFindingSeverity.Warning, false), (finding.Severity, finding.RequiresReason));
    }

    [Fact]
    public void HardLimit_NeverTurnsTheNoReasonWarningsIntoBlocks()
    {
        // Used above available and approaching never block: only a forecast over, of a one-off shift that raises the cost, can.
        var findings = ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 8100m, forecast: 8100m, cost: 0m), Context(BudgetLimitMode.HardLimit, raises: false));

        Assert.All(findings, f => Assert.Equal((RosterFindingSeverity.Warning, false), (f.Severity, f.RequiresReason)));
    }

    [Fact]
    public void AnOverrunTogetherWithAnAlreadyOverPool_GivesBoth_TheForecastFirst()
    {
        var findings = ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 8100m, forecast: 8400m), Context(BudgetLimitMode.HardLimit, raises: true));

        Assert.Equal(new[] { BudgetFindingCodes.ForecastOver, BudgetFindingCodes.Over }, findings.Select(f => f.Code));
    }

    [Fact]
    public void ARecordedPoolWithNothingAvailable_IsOverTheMomentAnythingIsBooked_AndNeverApproaching()
    {
        var booked = ShiftBudgetAssessor.Assess(Figures(available: 0m, used: 0m, forecast: 300m), Context());
        var empty = ShiftBudgetAssessor.Assess(Figures(available: 0m, used: 0m, forecast: 0m, cost: 0m), Context());

        Assert.Equal(new[] { BudgetFindingCodes.ForecastOver }, booked.Select(f => f.Code));
        Assert.Empty(empty);
    }

    // ── What each finding says, and the figures behind it ──────────────────

    // A period is written with a no-break space on each side of its en dash, so a line never splits at the dash (the phase 3 design review, M3).
    private const string Dash = "\u00A0\u2013\u2060\u00A0";

    [Fact]
    public void TheForecastOverMessage_NamesThePoolTheForecastTheAvailableThePeriodAndHowFarOver_ThenTheShiftsCost()
    {
        var finding = Find(ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 1000m, forecast: 8040m, cost: 292.32m), Context()), BudgetFindingCodes.ForecastOver)!;

        Assert.Equal($"Takes Core (flexible) to $8,040.00 of $8,000.00 for 1\u00A0Oct{Dash}31\u00A0Dec\u00A02026, $40.00 over. This shift: about $292.32.", finding.Message);
    }

    [Fact]
    public void WhenThePeriodWasAlreadyOverWithoutThisShift_TheForecastOverMessageSaysSo_SoItDoesNotReadAsIfThisShiftCausedIt()
    {
        var finding = Find(ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 1000m, forecast: 8640m, cost: 292.32m), Context()), BudgetFindingCodes.ForecastOver)!;

        Assert.Equal($"Takes Core (flexible) to $8,640.00 of $8,000.00 for 1\u00A0Oct{Dash}31\u00A0Dec\u00A02026, $640.00 over. It was already $347.68 over without this shift. This shift: about $292.32.", finding.Message);
    }

    [Fact]
    public void TheOverAndApproachingMessages_SayTheStateOfThePeriod_AndDoNotRepeatTheShiftsCost()
    {
        var over = Find(ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 8100m, forecast: 8400m, cost: 300m), Context()), BudgetFindingCodes.Over)!;
        var approaching = Find(ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 6800m, forecast: 6800m, cost: 300m), Context()), BudgetFindingCodes.Approaching)!;

        // The same sentences as phase 2b's participant alerts ("{pool} is $X over this period's $Y (to {end})"), so one condition is said one way in the banner, the Budgets list and the shift panel.
        Assert.Equal("Core (flexible) is $100.00 over this period's $8,000.00 (to 31\u00A0Dec\u00A02026).", over.Message);
        Assert.Equal("Core (flexible) is at 85% of this period's $8,000.00 (to 31\u00A0Dec\u00A02026).", approaching.Message);
    }

    [Fact]
    public void APeriodAcrossTwoYears_NamesBothYears()
    {
        var figures = new BudgetFindingFigures("Core (flexible)", new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30), 8000m, 0m, 9000m, 300m);

        var finding = Find(ShiftBudgetAssessor.Assess(figures, Context()), BudgetFindingCodes.ForecastOver)!;

        Assert.Contains($"for 1\u00A0Jul\u00A02026{Dash}30\u00A0Jun\u00A02027,", finding.Message);
    }

    [Fact]
    public void MoneyIsWrittenTheSameWhateverTheServersCulture()
    {
        var previous = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("de-DE");
            var finding = Find(ShiftBudgetAssessor.Assess(Figures(available: 8000m, used: 1000m, forecast: 8640m, cost: 292.32m), Context()), BudgetFindingCodes.ForecastOver)!;

            Assert.Contains("$8,640.00 of $8,000.00", finding.Message);
        }
        finally { System.Globalization.CultureInfo.CurrentCulture = previous; }
    }

    [Fact]
    public void EveryFindingCarriesTheFiguresItWasWorkedOutFrom()
    {
        var figures = Figures(available: 8000m, used: 8100m, forecast: 8400m, cost: 300m);

        var findings = ShiftBudgetAssessor.Assess(figures, Context());

        Assert.All(findings, f => Assert.Equal(figures, f.Budget));
        Assert.Equal(-100m, figures.Remaining);
        Assert.Equal(400m, figures.OverBy);
        Assert.Equal(8100m, figures.ForecastWithout);   // the forecast without this shift, which the sentence compares with what is available
    }

    [Fact]
    public void TheFiguresAlsoCarryWhatWasBookedAheadAndHowManyShiftsCouldNotBePriced_ForTheDisclosureToPrint()
    {
        var figures = new BudgetFindingFigures("Core (flexible)", QStart, QEnd, 8000m, 1000m, 8640m, 292.32m, BookedAhead: 7347.68m, UnpricedShiftCount: 2);

        var finding = Find(ShiftBudgetAssessor.Assess(figures, Context()), BudgetFindingCodes.ForecastOver)!;

        Assert.Equal((7347.68m, 2), (finding.Budget!.BookedAhead, finding.Budget.UnpricedShiftCount));
    }

    [Fact]
    public void TheCodesAreTheContractTheMarkerReads_AndAreFrozen()
    {
        Assert.Equal("BUDGET_APPROACHING", BudgetFindingCodes.Approaching);
        Assert.Equal("BUDGET_OVER", BudgetFindingCodes.Over);
        Assert.Equal("BUDGET_FORECAST_OVER", BudgetFindingCodes.ForecastOver);
        Assert.Equal("BUDGET_EMERGENCY", BudgetFindingCodes.Emergency);
        Assert.Equal("Emergency or safety: ", BudgetFindingCodes.EmergencyReasonPrefix);
        Assert.Equal(10, BudgetFindingCodes.MinEmergencyDescriptionLength);
    }
}
