using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Application.DTOs;

// The budget ledger (phase 2a): what a participant's plan has been spent on, is waiting to be spent on and is booked to be spent on, per pool and funding period. Computed on every read from the
// claims, shifts and trip bookings, never stored. Money is on these DTOs and on the claim DTOs' "budget" blocks only, which only SuperAdmin, Admin and Coordinator can reach. Every date is a
// DateOnly (a calendar day, in the provider's own time); there is no instant anywhere in them.

/// <summary>
/// <summary>The figures of one pool in one period, or over a whole plan. Nothing here is for a screen to add up: <see cref="Remaining"/> and <see cref="ForecastRemaining"/> are the two
/// subtractions a sentence needs, and a negative one means over.
/// </summary>
public record LedgerFiguresDto
{
    /// <summary>The period's set-aside when the pool has set-asides, otherwise its plan amount.</summary>
    public decimal Limit { get; init; }
    /// <summary>What the pool's earlier periods left unspent, rolled forward and chained. Not confirmed: others may have used it.</summary>
    public decimal Carried { get; init; }
    /// <summary>Limit plus carried.</summary>
    public decimal Available { get; init; }
    /// <summary>The lines of submitted, approved and paid claims.</summary>
    public decimal Claimed { get; init; }
    /// <summary>Draft and ready claim lines, completed shifts with no claim, and shifts never completed or cancelled.</summary>
    public decimal Pending { get; init; }
    /// <summary>Claimed plus pending.</summary>
    public decimal Used { get; init; }
    /// <summary>Future shifts and confirmed trip bookings, priced the way ODIP will claim them.</summary>
    public decimal BookedAhead { get; init; }
    /// <summary>Used plus booked ahead.</summary>
    public decimal Forecast { get; init; }
    /// <summary>
    /// How many booked trip days no catalogue rate covers, so those days contribute $0 to <see cref="BookedAhead"/> and <see cref="Forecast"/>. A count, never an invented rate: the
    /// gap is shown and measurable, and the money figures stay exactly what the catalogue can price. It counts days: each date of a booking once, however many pieces of it (weekday,
    /// weekday evening) are unpriced and however many categories the booking's price is split across.
    /// </summary>
    public int UnpricedTripDayCount { get; init; }
    /// <summary>Available minus used; negative when over.</summary>
    public decimal Remaining { get; init; }
    /// <summary>Available minus forecast; negative when the booked shifts would take the period over.</summary>
    public decimal ForecastRemaining { get; init; }
    public BudgetStatus Status { get; init; }
}

/// <summary>One thing that makes up a figure: a claim line, a shift or a trip booking. <see cref="Link"/> is an in-app path to it.</summary>
public record LedgerRowDto
{
    /// <summary>The claim line, shift or trip booking the row stands for (a booking priced in more than one category has one row for each, with the same id).</summary>
    public Guid Id { get; init; }
    public LedgerRowKind Kind { get; init; }
    /// <summary>Which of the three groups of the ledger it counts in.</summary>
    public LedgerGroup Group { get; init; }
    /// <summary>The service date: what puts the row in a period.</summary>
    public DateOnly Date { get; init; }
    public string Description { get; init; } = string.Empty;
    public decimal Amount { get; init; }
    /// <summary>The record's own status, as its name (the claim's, the shift's, the booking's).</summary>
    public string Status { get; init; } = string.Empty;
    public string Link { get; init; } = string.Empty;
    /// <summary>Something worth saying about the figure, for instance that no catalogue rate covers the date so it is counted as $0; omitted when there is nothing to say.</summary>
    public string? Note { get; init; }
    /// <summary>How many of this row's trip days no catalogue rate covers (always 0 for a row that is not a trip booking), the same count the period's and the pool's figures carry.</summary>
    public int UnpricedTripDayCount { get; init; }
}

public record LedgerPeriodDto : LedgerFiguresDto
{
    public Guid Id { get; init; }
    public int Position { get; init; }
    public DateOnly PeriodStart { get; init; }
    public DateOnly PeriodEnd { get; init; }
    /// <summary>The period that holds the provider's today; at most one per pool, and none once the plan has ended.</summary>
    public bool IsCurrent { get; init; }
    /// <summary>How many shifts in this period were never completed or cancelled although their day has passed (they are counted as pending).</summary>
    public int PastUnresolvedCount { get; init; }
    /// <summary>
    /// How many confirmed trip bookings in this period belong to a trip that has started and has no claim yet. They are counted as pending (the trip claim waits for the trip to be
    /// completed, so until then nothing else would count them) and flagged the way <see cref="PastUnresolvedCount"/> flags shifts.
    /// </summary>
    public int StartedUnclaimedTripCount { get; init; }
    /// <summary>
    /// How many shifts in this period the shift claim cannot price yet (a sleepover, a passive night, a group or shared shift, or a shift no catalogue rate covers). They are in every figure as
    /// $0, so the figures leave them out: this says how many, and <see cref="UnpricedShiftReasons"/> why. Zero when every shift priced.
    /// </summary>
    public int UnpricedShiftCount { get; init; }
    /// <summary>The distinct reasons behind <see cref="UnpricedShiftCount"/>, each in a few words ("a sleepover", "a 1:3 group shift", "no catalogue rate for the date"), in a fixed order; empty when nothing is unpriced.</summary>
    public List<string> UnpricedShiftReasons { get; init; } = new();
    /// <summary>How many rows the period has in all; <see cref="Rows"/> holds the first page of them.</summary>
    public int RowCount { get; init; }
    public List<LedgerRowDto> Rows { get; init; } = new();
}

public record LedgerPoolDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public FundingPoolKind Kind { get; init; }
    /// <summary>0 for a Core (flexible) pool.</summary>
    public int PaceCategory { get; init; }
    public PlanType ManagementType { get; init; }
    /// <summary>The pool's limits are set-asides, not plan amounts.</summary>
    public bool HasSetAside { get; init; }
    public List<LedgerPeriodDto> Periods { get; init; } = new();
    /// <summary>The same sums over the whole plan, against the sum of the limits.</summary>
    public LedgerFiguresDto PlanTotal { get; init; } = new();
    public int PastUnresolvedCount { get; init; }
    /// <summary>The same flag as the periods', over the whole plan: started trips that have no claim yet.</summary>
    public int StartedUnclaimedTripCount { get; init; }
    /// <summary>The same count as the periods', over the whole plan: shifts the shift claim cannot price yet, which every figure leaves out.</summary>
    public int UnpricedShiftCount { get; init; }
}

/// <summary>Rows that are in no pool or period of the plan: shown, never dropped.</summary>
public record LedgerBucketDto
{
    public int Count { get; init; }
    public decimal Amount { get; init; }
    public List<LedgerRowDto> Rows { get; init; } = new();
}

/// <summary>
/// <c>GET api/v1/participants/{id}/funding/ledger</c>: the ledger of the participant's current plan (the one whose dates include the provider's today; with none, the latest plan that has
/// started). With no plan that has started, <see cref="PlanId"/> is omitted and there are no pools: there is no figure, and nothing here says "all clear".
/// </summary>
public record ParticipantLedgerDto
{
    public Guid? PlanId { get; init; }
    public DateOnly? PlanStart { get; init; }
    public DateOnly? PlanEnd { get; init; }
    /// <summary>The plan runs today. False for a plan that has ended and has no successor recorded yet.</summary>
    public bool PlanIsCurrent { get; init; }
    /// <summary>The provider's today, which every "current period" and "booked ahead" is decided against.</summary>
    public DateOnly AsOf { get; init; }
    /// <summary>The time zone that day was worked out in (the provider's, from its state), as an IANA id.</summary>
    public string TimeBasis { get; init; } = string.Empty;
    /// <summary>The organisation's "approaching" percentage the statuses were worked out with.</summary>
    public int ApproachingPercent { get; init; }
    public List<LedgerPoolDto> Pools { get; init; } = new();
    /// <summary>Claim lines, shifts and bookings in the plan's dates whose category no recorded pool covers.</summary>
    public LedgerBucketDto NotInARecordedPool { get; init; } = new();
    /// <summary>Claim lines, shifts and bookings dated after the plan ends (or in no period of their pool).</summary>
    public LedgerBucketDto OutsideThePlanDates { get; init; } = new();
}

/// <summary><c>GET .../funding/ledger/rows</c>: one more page of one period's rows.</summary>
public record LedgerRowsPageDto
{
    public int Total { get; init; }
    public int Skip { get; init; }
    public List<LedgerRowDto> Rows { get; init; } = new();
}

// ── The budget effect of one claim ──────────────────────────────────────────

/// <summary>Where the part of a claim in one row of a budget block landed.</summary>
public enum ClaimBudgetPlacement
{
    /// <summary>In a period of a recorded pool: the figures are the pool's.</summary>
    Pool = 0,
    /// <summary>In no recorded pool: it uses no pool's money, and there are no figures to compare with.</summary>
    NotInAPool = 1,
    /// <summary>Dated outside the plan: no figures either.</summary>
    OutsideThePlan = 2,
}

/// <summary>One affected pool and period of a claim, as of now. <see cref="Available"/> and the figures after it are omitted for a row that is in no pool or outside the plan.</summary>
public record ClaimBudgetRowDto
{
    public ClaimBudgetPlacement Placement { get; init; }
    public string PoolName { get; init; } = string.Empty;
    public DateOnly? PeriodStart { get; init; }
    public DateOnly? PeriodEnd { get; init; }
    public decimal? Available { get; init; }
    /// <summary>What the pool's period had used without this claim.</summary>
    public decimal? UsedBefore { get; init; }
    /// <summary>What this claim takes of it.</summary>
    public decimal ThisClaim { get; init; }
    /// <summary>Used before plus this claim: what is used once the claim counts.</summary>
    public decimal? UsedAfter { get; init; }
    /// <summary>Available minus used after; negative when this claim leaves the period over.</summary>
    public decimal? LeftAfter { get; init; }
    /// <summary>The status of the period with this claim counted (and everything booked ahead as it stands).</summary>
    public BudgetStatus? StatusAfter { get; init; }
}

public record ClaimBudgetParticipantDto
{
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public List<ClaimBudgetRowDto> Rows { get; init; } = new();
}

/// <summary>
/// What a claim does to the budget, for each participant it covers (a trip claim covers several): one row for each affected pool and period. It is a warning and nothing more: generating,
/// submitting or paying a claim is never blocked by it, in any mode. The whole block is omitted when none of the claim's participants has a plan that has started.
/// </summary>
public record ClaimBudgetDto
{
    public List<ClaimBudgetParticipantDto> Participants { get; init; } = new();
}
