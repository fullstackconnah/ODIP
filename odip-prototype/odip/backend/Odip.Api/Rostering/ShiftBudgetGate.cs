using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;

namespace Odip.Api.Rostering;

/// <summary>
/// What the roster gate does with the budget findings of a shift (budget phase 3), on top of <see cref="RosterGate"/>, which it leaves as it is.
/// <list type="bullet">
/// <item><b>The emergency or safety path.</b> A request that carries <c>emergency: true</c> and a description of at least ten characters (in the override reason) is accepted past a BUDGET_FORECAST_OVER finding, whatever its
///   severity and in every mode: that one finding no longer gates the save. Every other finding still does. A request that says emergency when the check found no BUDGET_FORECAST_OVER is simply a save: there is nothing
///   past the budget to record, and a false marker and a needless review task would be worse than ignoring a flag.</item>
/// <item><b>What is stored.</b> <c>Shift.AcknowledgedFindingCodes</c> is the audit truth the over-budget marker is read from, so the client never decides it: a BUDGET_FORECAST_OVER or BUDGET_EMERGENCY the client sends is
///   dropped; BUDGET_FORECAST_OVER is stored only for a genuine Admin override (a finding that required a reason, saved with one), BUDGET_EMERGENCY only for an emergency the server accepted. A warn-mode warning is not an override.</item>
/// <item><b>Carried forward.</b> A save that does not decide the budget again (assigning a worker, editing a note, any edit that is not a new override) keeps the budget acknowledgement the shift already had, and its
///   reason when nothing else supplies one, so a later benign edit cannot erase the marker of an emergency whose Admin review is still open.</item>
/// </list>
/// </summary>
public static class ShiftBudgetGate
{
    public const string DescribeEmergencyMessage = "Describe the emergency or safety need in at least 10 characters.";
    public const string EmergencyDescriptionTooLongMessage = "Describe the emergency or safety need in at most 1,900 characters.";

    public sealed record Decision(List<RosterFinding> GateFindings, bool EmergencyAccepted, string? Error)
    {
        /// <summary>The findings gate nothing different: no emergency was asked for, or it did not apply.</summary>
        public static Decision NoEmergency(List<RosterFinding> findings) => new(findings, false, null);
    }

    /// <summary>Works out which findings gate the save. A description that is too short refuses the request (<see cref="Decision.Error"/>) only when there is a budget finding it would answer.</summary>
    public static Decision Resolve(List<RosterFinding> findings, bool emergencyRequested, string? overrideReason)
    {
        if (!emergencyRequested || !findings.Any(f => f.Code == BudgetFindingCodes.ForecastOver)) return Decision.NoEmergency(findings);

        var length = overrideReason?.Trim().Length ?? 0;
        if (length < BudgetFindingCodes.MinEmergencyDescriptionLength) return new Decision(findings, false, DescribeEmergencyMessage);
        if (length > BudgetFindingCodes.MaxEmergencyDescriptionLength) return new Decision(findings, false, EmergencyDescriptionTooLongMessage);

        // The emergency path answers the budget finding and nothing else.
        return new Decision(findings.Where(f => f.Code != BudgetFindingCodes.ForecastOver).ToList(), true, null);
    }

    /// <summary>
    /// The (OverrideReason, AcknowledgedFindingCodes) pair to store: <see cref="RosterGate.ComputeOverride"/> over every finding, then the budget rules above. <paramref name="previousReason"/> and
    /// <paramref name="previousCodes"/> are what the shift holds now (null for a new shift).
    /// </summary>
    public static (string? Reason, string? Codes) ToStore(
        List<RosterFinding> findings, Decision decision, string? overrideReason, List<string>? clientCodes, string? previousReason, string? previousCodes)
    {
        var (reason, joined) = RosterGate.ComputeOverride(findings, overrideReason, clientCodes);
        var codes = (joined ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        // Never the client's say: these two codes mean "an Admin pushed it through" and "an emergency was accepted".
        codes.RemoveAll(c => c is BudgetFindingCodes.ForecastOver or BudgetFindingCodes.Emergency);

        var forecast = findings.FirstOrDefault(f => f.Code == BudgetFindingCodes.ForecastOver);
        var adminOverride = !decision.EmergencyAccepted && forecast is { RequiresReason: true } && reason is not null;
        if (adminOverride) codes.Add(BudgetFindingCodes.ForecastOver);

        if (decision.EmergencyAccepted)
        {
            reason = BudgetFindingCodes.EmergencyReasonPrefix + overrideReason!.Trim();
            codes.Add(BudgetFindingCodes.Emergency);
        }
        else if (!adminOverride && PreviousBudgetCode(previousReason, previousCodes) is { } carried)
        {
            // Not decided again: the shift keeps what it already carries, and its reason when nothing else asked for a new one.
            codes.Add(carried);
            reason ??= previousReason;
        }

        var distinct = codes.Distinct(StringComparer.Ordinal).ToList();
        return (reason, distinct.Count == 0 ? null : string.Join(",", distinct));
    }

    /// <summary>
    /// The budget acknowledgement a saved shift carries: the emergency, or an Admin override (BUDGET_FORECAST_OVER together with the written reason it was saved with). Null for a shift that carries neither.
    /// </summary>
    public static string? PreviousBudgetCode(string? reason, string? codes)
    {
        var held = SplitCodes(codes);
        if (held.Contains(BudgetFindingCodes.Emergency)) return BudgetFindingCodes.Emergency;
        if (held.Contains(BudgetFindingCodes.ForecastOver) && !string.IsNullOrWhiteSpace(reason)) return BudgetFindingCodes.ForecastOver;
        return null;
    }

    public static List<string> SplitCodes(string? codes) =>
        (codes ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
}
