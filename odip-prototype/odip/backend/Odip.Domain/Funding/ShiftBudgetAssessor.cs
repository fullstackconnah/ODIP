using System.Globalization;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;

namespace Odip.Domain.Funding;

/// <summary>
/// The codes of the budget findings the roster check raises (budget phase 3), and the words the emergency path is stored under. They are a contract: the shift panel and the board chip read them, and
/// the stored <c>Shift.AcknowledgedFindingCodes</c> is what says a shift went past its budget on purpose. Never rename one.
/// </summary>
public static class BudgetFindingCodes
{
    /// <summary>Used is at or above the organisation's "approaching" percentage of what is available. A warning that asks for nothing.</summary>
    public const string Approaching = "BUDGET_APPROACHING";
    /// <summary>Used is already above what is available. A warning that asks for nothing.</summary>
    public const string Over = "BUDGET_OVER";
    /// <summary>The forecast with this shift in it is above what is available. A warning; under a hard limit a one-off shift that raises the cost is refused for a Coordinator and asks an Admin for a reason.</summary>
    public const string ForecastOver = "BUDGET_FORECAST_OVER";
    /// <summary>Never a finding: the acknowledgement stored with a shift the server accepted as an emergency or safety booking.</summary>
    public const string Emergency = "BUDGET_EMERGENCY";

    /// <summary>What the server writes in front of the description of an emergency or safety booking, in <c>Shift.OverrideReason</c>.</summary>
    public const string EmergencyReasonPrefix = "Emergency or safety: ";

    /// <summary>The shortest description, in trimmed characters, an emergency or safety booking is accepted with.</summary>
    public const int MinEmergencyDescriptionLength = 10;

    public static bool IsBudgetCode(string? code) => code is not null && code.StartsWith("BUDGET_", StringComparison.Ordinal);
}

/// <summary>
/// The figures behind a budget finding, for one pool in one funding period with the shift in question already counted: what is available, what is used, what is forecast, and what the shift is estimated
/// to cost. Worked out by the server so that no screen does a sum of its own.
/// </summary>
public sealed record BudgetFindingFigures(string PoolName, DateOnly PeriodStart, DateOnly PeriodEnd, decimal Available, decimal Used, decimal Forecast, decimal ShiftCost)
{
    /// <summary>What the period has left after what is used (negative once it is over).</summary>
    public decimal Remaining => Available - Used;

    /// <summary>How far the forecast is past what is available; zero when it is not.</summary>
    public decimal OverBy => Math.Max(0m, Forecast - Available);
}

/// <summary>What decides how a finding is raised: the organisation's mode and "approaching" percentage, whether the shift is a one-off, whether the change raises the cost in this period, and who is saving it.</summary>
public sealed record ShiftBudgetContext(BudgetLimitMode Mode, int ApproachingPercent, bool IsOneOff, bool Raises, bool CallerIsAdmin);

/// <summary>
/// The roster check's budget rules (budget phase 3), pure: the figures of the shift's pool and period go in, the findings come out.
/// <list type="bullet">
/// <item><b>Over</b>: used is already above available. <b>Approaching</b>: used is at or above the percentage of available (and not over). Both are warnings that ask for nothing, in every mode.</item>
/// <item><b>Forecast over</b>: the forecast with this shift is above available. A warning that asks for nothing, except under a hard limit for a ONE-OFF shift whose change RAISES the cost in this period:
///   an Admin gets a warning that needs a written reason, anyone else a block (the emergency or safety path is the way through for them). A shift made from a pattern, and a change that does not raise the cost,
///   only warn, in every mode.</item>
/// </list>
/// Every comparison is on exact decimals: 80% of $8,000 is $6,400 to the cent, and no rounding decides a finding.
/// </summary>
public static class ShiftBudgetAssessor
{
    public static IReadOnlyList<RosterFinding> Assess(BudgetFindingFigures figures, ShiftBudgetContext context)
    {
        var findings = new List<RosterFinding>();

        if (figures.Forecast > figures.Available)
        {
            var hard = context.Mode == BudgetLimitMode.HardLimit && context.IsOneOff && context.Raises;
            var severity = hard && !context.CallerIsAdmin ? RosterFindingSeverity.Blocking : RosterFindingSeverity.Warning;
            findings.Add(new RosterFinding(
                BudgetFindingCodes.ForecastOver, severity,
                string.Create(CultureInfo.InvariantCulture, $"Takes {figures.PoolName} to {Money(figures.Forecast)} of {Money(figures.Available)} for {Period(figures)}.{Cost(figures)}"),
                RequiresReason: hard && context.CallerIsAdmin, Budget: figures));
        }

        if (figures.Used > figures.Available)
        {
            findings.Add(new RosterFinding(
                BudgetFindingCodes.Over, RosterFindingSeverity.Warning,
                string.Create(CultureInfo.InvariantCulture, $"{figures.PoolName} is already over for {Period(figures)}: {Money(figures.Used)} used of {Money(figures.Available)}.{Cost(figures)}"),
                Budget: figures));
        }
        else if (figures.Available > 0m && figures.Used * 100m >= context.ApproachingPercent * figures.Available)
        {
            var percent = (int)Math.Floor(figures.Used * 100m / figures.Available);
            findings.Add(new RosterFinding(
                BudgetFindingCodes.Approaching, RosterFindingSeverity.Warning,
                string.Create(CultureInfo.InvariantCulture, $"{figures.PoolName} is {percent}% used for {Period(figures)}: {Money(figures.Used)} of {Money(figures.Available)}.{Cost(figures)}"),
                Budget: figures));
        }

        return findings;
    }

    /// <summary>Money as the findings say it: dollars and cents, thousands separated, whatever the culture of the server.</summary>
    public static string Money(decimal amount) => "$" + amount.ToString("N2", CultureInfo.InvariantCulture);

    /// <summary>A funding period as the findings say it: "1 Oct–31 Dec 2026", or with both years when it crosses one.</summary>
    public static string Period(BudgetFindingFigures figures) => Period(figures.PeriodStart, figures.PeriodEnd);

    public static string Period(DateOnly start, DateOnly end) =>
        start.Year == end.Year
            ? string.Create(CultureInfo.InvariantCulture, $"{start:d MMM}–{end:d MMM yyyy}")
            : string.Create(CultureInfo.InvariantCulture, $"{start:d MMM yyyy}–{end:d MMM yyyy}");

    /// <summary>The estimate of the shift itself, said after every finding: "This shift: about $292.32." Nothing when the shift adds nothing.</summary>
    private static string Cost(BudgetFindingFigures figures) => figures.ShiftCost > 0m ? $" This shift: about {Money(figures.ShiftCost)}." : string.Empty;
}
