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

/// <summary>
/// How one pool of a participant's budget stands in one funding period, or over the whole plan (budget feature, phase 2a). Computed on every read and never stored, so the
/// integer values are not persisted; they travel as names. The worst one that applies wins: Over, then Forecast over, then Approaching, then On track.
/// </summary>
public enum BudgetStatus
{
    /// <summary>The participant has no plan that has started, so there is nothing to compare with. Never "all clear": there is no figure at all.</summary>
    None = 0,
    OnTrack = 1,
    /// <summary>What is used has reached the organisation's "approaching" percentage of what is available (80 by default), and the forecast does not pass it.</summary>
    Approaching = 2,
    /// <summary>Nothing is over yet, but what is used plus what is booked ahead is more than what is available.</summary>
    ForecastOver = 3,
    /// <summary>What is used (claimed and pending) is already more than what is available.</summary>
    Over = 4,
}

/// <summary>What one row of a participant's ledger is. Wire names.</summary>
public enum LedgerRowKind
{
    /// <summary>A line of a claim that counts (see <see cref="LedgerGroup"/> for whether it is claimed or still a draft).</summary>
    ClaimLine = 0,
    /// <summary>A completed shift nobody has claimed yet, priced the way ODIP will claim it.</summary>
    CompletedShift = 1,
    /// <summary>A shift whose day has passed and that was never completed or cancelled: counted as pending and flagged.</summary>
    PastShift = 2,
    /// <summary>A rostered shift from today on, priced the way ODIP will claim it.</summary>
    FutureShift = 3,
    /// <summary>
    /// A confirmed trip booking nobody has claimed yet, priced the way ODIP will claim it: booked ahead while its trip starts today or later, and pending (flagged) once the trip has
    /// started, because the trip claim cannot be made until the trip is completed and the booking would otherwise be counted nowhere.
    /// </summary>
    TripBooking = 4,
}

/// <summary>Where a ledger row counts: the three groups of the Funding tab's ledger. Wire names.</summary>
public enum LedgerGroup
{
    /// <summary>Lines of submitted, approved or paid claims.</summary>
    Claimed = 0,
    /// <summary>Lines of draft or ready claims, completed shifts with no claim, shifts never resolved, and trips that have started with no claim yet.</summary>
    Pending = 1,
    /// <summary>Future shifts and confirmed bookings of trips that have not started.</summary>
    BookedAhead = 2,
}
