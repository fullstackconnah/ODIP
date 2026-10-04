namespace Odip.Domain.Funding;

/// <summary>
/// Where the figures of a recorded plan came from. A provider cannot see a participant's budget in the NDIA portal (a direct provider is told "budget
/// details are not available"), so every figure is typed in from a document or an answer, and this says whose. The integer values are persisted: never
/// renumber or reorder.
/// </summary>
public enum BudgetEvidenceSource
{
    /// <summary>A copy of the plan the participant (or their nominee) shared.</summary>
    PlanCopy = 0,
    /// <summary>The plan manager's statement or written confirmation.</summary>
    PlanManager = 1,
    /// <summary>What the participant told the provider.</summary>
    Participant = 2,
    /// <summary>The participant's support coordinator.</summary>
    SupportCoordinator = 3,
    Other = 4,
}

/// <summary>
/// How a pool of a plan is held. The integer values are persisted: never renumber or reorder.
/// </summary>
public enum FundingPoolKind
{
    /// <summary>One pool for PACE categories 01 to 04, which can pay for each other (the NDIA lists them as one flexible component for each management type).</summary>
    CoreFlexible = 0,
    /// <summary>One support category on its own: the plan names the support and the funds buy that support only.</summary>
    Stated = 1,
}

/// <summary>
/// What a budget check does when a one-off roster shift would take a participant's forecast past their budget for the funding period. Chosen per organisation
/// on <see cref="BudgetSettings.Mode"/>. Warn is the default for every existing and new organisation. The integer values are persisted (0 = Warn is also the
/// column's database default): never renumber or reorder.
/// </summary>
public enum BudgetLimitMode
{
    Warn = 0,
    /// <summary>Refuses a one-off roster shift that would take the forecast past the budget, unless an Admin overrides it with a reason. Emergency or safety bookings are always allowed.</summary>
    HardLimit = 1,
}
