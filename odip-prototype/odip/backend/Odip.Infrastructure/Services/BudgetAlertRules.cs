using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The NDIA's "the funds ran out" signal on one pool of a participant's current plan: the latest claim it refused with V17, V18, V27 or V28 whose lines belong to the pool, the day it was refused
/// (the provider's calendar day) and the code. Plain data, so the rules below need no database.
/// </summary>
public sealed record PoolNdiaRejection(Guid PoolId, Guid ClaimId, string ClaimReference, DateOnly Date, string Code);

/// <summary>
/// The participant alerts of the budget feature (phase 2b) as rules over a computed ledger: pure, no database, no clock (the ledger already carries the provider's today and which period is running).
/// A participant who has no plan that has started has no alert (there is nothing to compare with, and nothing here ever says "all clear"), and neither has one whose plan is not running now (the
/// plan-expired alert is that story). Otherwise each pool is spoken of for the period running NOW, never for a past or future one:
/// <list type="bullet">
/// <item><b>budget-over</b> (Critical): what is used (claimed and pending) is already past what is available.</item>
/// <item><b>budget-forecast-over</b> (Warning): used plus booked ahead would pass it by the period's end.</item>
/// <item><b>budget-approaching</b> (Warning): used has reached the organisation's percentage of it.</item>
/// <item><b>budget-ndia-exhausted</b> (Critical): the NDIA refused a claim of this pool for want of funds, and the funding period it was refused in is still running.</item>
/// </list>
/// The first three are one status, so a pool gets only the WORST of them, once. The NDIA's signal is a different fact (the NDIA's word, not ODIP's arithmetic) and has its own alert, so a pool the
/// ledger calls over AND the NDIA has refused is told both ways. All of them open the participant's Funding tab.
/// </summary>
public static class BudgetAlertRules
{
    public const string ApproachingType = "budget-approaching";
    public const string ForecastOverType = "budget-forecast-over";
    public const string OverType = "budget-over";
    public const string NdiaExhaustedType = "budget-ndia-exhausted";

    /// <summary>The participant page's tab every budget alert opens.</summary>
    public const string FundingTab = "funding";

    /// <param name="ledger">The participant's ledger as the ledger service computed it.</param>
    /// <param name="ndiaByPool">The NDIA's active signal for each pool of the current plan, by pool id (see <see cref="NdiaRejectionReader"/>); empty when there is none.</param>
    public static IReadOnlyList<ParticipantAlertDto> For(ParticipantLedger ledger, IReadOnlyDictionary<Guid, PoolNdiaRejection> ndiaByPool)
    {
        var alerts = new List<ParticipantAlertDto>();
        if (ledger.Ledger is not { } plan) return alerts;

        var severalCorePools = plan.Pools.Count(p => p.Pool.Kind == FundingPoolKind.CoreFlexible) > 1;
        foreach (var pool in plan.Pools)
        {
            // Only a period that is running now is spoken of: a plan that has ended, or that has not reached this pool's next period, has nothing to warn about.
            var period = pool.Periods.FirstOrDefault(p => p.IsCurrent);
            if (period is null) continue;

            var label = BudgetText.PoolLabel(pool.Pool, severalCorePools);
            if (StatusAlert(label, period) is { } status) alerts.Add(status);
            if (ndiaByPool.TryGetValue(pool.Pool.Id, out var rejection)) alerts.Add(NdiaAlert(label, rejection));
        }

        return alerts;
    }

    private static ParticipantAlertDto? StatusAlert(string label, PeriodLedger period)
    {
        var end = BudgetText.Day(period.Period.PeriodEnd);
        switch (period.Status)
        {
            case BudgetStatus.Over:
                // Every status alert names the period's figure and its last day, because "this period" may be a month, a quarter or the whole plan and the alert is read away from the Funding tab.
                return Alert(OverType, AlertSeverity.Critical, WithTheGap($"{label} is {BudgetText.Money(period.Used - period.Available)} over this period's {BudgetText.Money(period.Available)} (to {end})", period));
            case BudgetStatus.ForecastOver:
                return Alert(ForecastOverType, AlertSeverity.Warning, WithTheGap($"Booked shifts would take {label} {BudgetText.Money(period.Forecast - period.Available)} over this period's {BudgetText.Money(period.Available)} by {end}", period));
            case BudgetStatus.Approaching:
                // Rounded DOWN, so a period that is at 79.6% is never reported as the 80% that makes it "approaching" (only a period at or past the percentage gets here at all, and then it is at least that).
                var percent = (int)Math.Floor(period.Used * 100m / period.Available);
                return Alert(ApproachingType, AlertSeverity.Warning, WithTheGap($"{label} is at {percent}% of this period's {BudgetText.Money(period.Available)} (to {end})", period));
            default:
                return null;
        }
    }

    /// <summary>
    /// Shifts the shift claim cannot price are $0 in every figure, so the figures leave them out: an alert about a status says so, rather than reading as the whole picture. Only the period the alert is
    /// about counts, and only a status alert says it (a pool that is on track says nothing, and the NDIA's word is not a figure).
    /// </summary>
    private static string WithTheGap(string message, PeriodLedger period) =>
        period.UnpricedShiftCount > 0 ? $"{message}. {BudgetText.UnpricedShifts(period.UnpricedShiftCount)}" : message;

    /// <summary>
    /// "NDIA rejected a claim for Core on 8 Oct 2026: not enough funds in the funding period (V27)": one colon, the pool named in the sentence, and which of the two ran out (the plan, for V17 and
    /// V18, or the funding period, for V27 and V28). The Funding tab's note says the same after "NDIA rejected a claim on {date}".
    /// </summary>
    private static ParticipantAlertDto NdiaAlert(string label, PoolNdiaRejection rejection)
    {
        var scope = NdiaRejectionCodes.ScopeOf(rejection.Code) is { } ran ? $" in {ran}" : string.Empty;
        return Alert(NdiaExhaustedType, AlertSeverity.Critical, $"NDIA rejected a claim for {label} on {BudgetText.Day(rejection.Date)}: not enough funds{scope} ({rejection.Code})");
    }

    private static ParticipantAlertDto Alert(string type, AlertSeverity severity, string message) =>
        new() { Type = type, Severity = severity, Message = message, DeepLinkTab = FundingTab };
}
