using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Application.DTOs;

// The Budgets list (budget phase 2b): every participant's pools for the funding period running now, sorted by risk. The figures are the budget ledger's, worked out for the whole organisation
// in one batched call; nothing here is added up by a screen. Money is on this response, so it follows the ledger: SuperAdmin, Admin and Coordinator only. Every date is a DateOnly (a
// calendar day, in the provider's own time), enums travel as their names, and a null member is left out.

/// <summary>One pool of one participant's current plan, for the funding period running now.</summary>
public record BudgetListRowDto
{
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public Guid PoolId { get; init; }
    /// <summary>The pool as a sentence names it: "Core", the stated support's name, or "Core (plan managed)" when the plan holds two Core pools.</summary>
    public string PoolName { get; init; } = string.Empty;
    public FundingPoolKind Kind { get; init; }
    public PlanType ManagementType { get; init; }
    public DateOnly PeriodStart { get; init; }
    public DateOnly PeriodEnd { get; init; }
    /// <summary>The period's limit plus what earlier periods left unspent.</summary>
    public decimal Available { get; init; }
    /// <summary>
    /// How much of <see cref="Available"/> is rolled over from earlier periods of the plan (0 when none): the ledger labels it "not confirmed", because somebody else may have used it, and the list
    /// says so beside Available so a row that is on track by rolled-over money does not read as if it were the period's own.
    /// </summary>
    public decimal Carried { get; init; }
    /// <summary>Claimed plus pending.</summary>
    public decimal Used { get; init; }
    /// <summary>
    /// Available minus used: what is left, or, when it is below zero, how far over the period already is (the Funding tab says "$X over"). The first question about a row that is Over is by how
    /// much, and the server answers it so that no screen subtracts.
    /// </summary>
    public decimal Remaining { get; init; }
    public decimal BookedAhead { get; init; }
    /// <summary>Used plus booked ahead.</summary>
    public decimal Forecast { get; init; }
    public BudgetStatus Status { get; init; }
    /// <summary>
    /// How many shifts in this period the shift claim cannot price yet (a sleepover, a passive night, a group or shared shift, or a shift no catalogue rate covers). Each is $0 in every figure above, so
    /// they leave those shifts out: this says how many, and the row says so. The ledger's own count for the period; zero when every shift priced.
    /// </summary>
    public int UnpricedShiftCount { get; init; }
    /// <summary>
    /// The NDIA's own word that this pool's funds ran out (a claim of the pool refused with V17, V18, V27 or V28, while the funding period it was refused in is the one running); omitted when it
    /// has none. ODIP's arithmetic can say On track while the NDIA has refused a claim for want of funds, and the list must not be silent about it. The same shape and rule as the Funding tab's note.
    /// </summary>
    public NdiaRejectionDto? NdiaRejection { get; init; }
}

/// <summary>Why an NDIS-funded participant has no row.</summary>
public enum BudgetListNoBudgetReason
{
    /// <summary>No plan budget has been recorded that has started (an upcoming plan does not count yet: there is nothing to spend against).</summary>
    NotRecorded = 0,
    /// <summary>A plan is recorded but it has ended and no successor is recorded.</summary>
    PlanEnded = 1,
}

/// <summary>An NDIS-funded participant with no budget in force, kept apart from the rows: there is no figure for them and nothing ever warns about them.</summary>
public record BudgetListNoBudgetDto
{
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public BudgetListNoBudgetReason Reason { get; init; }
    /// <summary>The last day of the plan that ended; omitted when none was recorded.</summary>
    public DateOnly? PlanEnd { get; init; }
}

/// <summary>
/// <c>GET api/v1/funding/budgets</c>. <see cref="Rows"/> are sorted by risk - Over, then the pools the NDIA has refused a claim of for want of funds, then Forecast over, then Approaching, then On
/// track - and then by participant name and the plan's own order of pools. <see cref="NoBudget"/> are the NDIS-funded participants that have no row, by name. Archived participants and drafts are left out, as they are from the participant alerts.
/// </summary>
public record BudgetListDto
{
    /// <summary>The provider's today, which every "current period" was decided against.</summary>
    public DateOnly AsOf { get; init; }
    /// <summary>The organisation's "approaching" percentage the statuses were worked out with.</summary>
    public int ApproachingPercent { get; init; }
    public List<BudgetListRowDto> Rows { get; init; } = new();
    public List<BudgetListNoBudgetDto> NoBudget { get; init; } = new();
}
