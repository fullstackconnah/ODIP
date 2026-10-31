using Odip.Domain.Enums;

namespace Odip.Domain.Incidents;

/// <summary>
/// Behaviour support plan due dates for a restrictive practice: the interim plan 1 month after first use, the comprehensive plan
/// 6 months after. Pure, so the register DTO and the alerts read one definition. <c>AddMonths</c> clamps a month end
/// (31 Aug + 1 month = 30 Sep). The due date itself is not overdue (inclusive, like the authorisation end date).
/// </summary>
public static class BspTimeline
{
    /// <summary>Days before the due date from which a plan reads "due soon".</summary>
    public const int DueSoonDays = 7;

    public static DateOnly InterimDue(DateOnly firstUsedOn) => firstUsedOn.AddMonths(1);

    public static DateOnly ComprehensiveDue(DateOnly firstUsedOn) => firstUsedOn.AddMonths(6);

    public static BspPlanState State(DateOnly? due, DateOnly? inPlaceOn, DateOnly today) =>
        inPlaceOn != null ? BspPlanState.InPlace
        : due == null ? BspPlanState.NotStarted
        : today > due ? BspPlanState.Overdue
        : today >= due.Value.AddDays(-DueSoonDays) ? BspPlanState.DueSoon
        : BspPlanState.Due;

    /// <summary>The interim plan counts as in place once either plan date is recorded.</summary>
    public static BspPlanState InterimState(DateOnly? due, DateOnly? interimBspDate, DateOnly? comprehensiveBspDate, DateOnly today) =>
        State(due, interimBspDate ?? comprehensiveBspDate, today);
}
