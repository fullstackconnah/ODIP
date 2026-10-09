using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Application.DTOs;

// The agreement budget bar's check (budget phase 2b): what an agreement would cost against what the participant's real pools have left, for each pool and funding period it touches. The
// figures are the pricing engine's (the agreement is priced in process) and the ledger's (what each period has available and used), placed with the ledger's own rule; no screen adds anything
// up. A warning and nothing more: it never blocks a save or an approval. Money is on these shapes, so the endpoint is for SuperAdmin, Admin and Coordinator only. Every date is a DateOnly.

/// <summary>
/// <c>POST api/v1/participants/{id}/funding/agreement-check</c>. Say what to price in ONE of two ways: the draft's <see cref="Blocks"/> with the agreement's <see cref="PeriodFrom"/> and
/// <see cref="PeriodTo"/> (the plan as it is on screen, saved or not), or the id of a saved draft revision (<see cref="DraftId"/>), whose own blocks and dates are used. Both, or neither, is refused.
/// </summary>
public record AgreementCheckRequestDto
{
    public Guid? DraftId { get; init; }
    public List<PlanBlock>? Blocks { get; init; }
    /// <summary>The agreement period, first day included.</summary>
    public DateOnly? PeriodFrom { get; init; }
    /// <summary>The agreement period, last day included.</summary>
    public DateOnly? PeriodTo { get; init; }
}

/// <summary>One funding period of one pool the agreement touches.</summary>
public record AgreementCheckPeriodDto
{
    public Guid PeriodId { get; init; }
    public DateOnly PeriodStart { get; init; }
    public DateOnly PeriodEnd { get; init; }
    /// <summary>The period that holds the provider's today.</summary>
    public bool IsCurrent { get; init; }
    /// <summary>What the agreement costs in this period: the priced lines delivered on its days that belong to this pool.</summary>
    public decimal AgreementCost { get; init; }
    /// <summary>
    /// The period's limit plus what earlier periods would leave unspent once this agreement had spent its share of them, so a later period never counts money the same agreement uses earlier.
    /// With no agreement cost in the earlier periods it is the ledger's own figure.
    /// </summary>
    public decimal Available { get; init; }
    /// <summary>Claimed plus pending (the ledger's figure). What is booked ahead is not taken off: it is not used yet.</summary>
    public decimal Used { get; init; }
    /// <summary>Available minus used.</summary>
    public decimal Remaining { get; init; }
    /// <summary>How far the agreement passes what is left; 0 when it fits.</summary>
    public decimal OverBy { get; init; }
}

public record AgreementCheckPoolDto
{
    public Guid PoolId { get; init; }
    /// <summary>The pool as a sentence names it ("Core", the stated support's name, "Core (plan managed)" when the plan holds two).</summary>
    public string PoolName { get; init; } = string.Empty;
    public FundingPoolKind Kind { get; init; }
    public PlanType ManagementType { get; init; }
    /// <summary>What the agreement costs in this pool over all the periods it touches.</summary>
    public decimal AgreementCost { get; init; }
    /// <summary>Some period would be over.</summary>
    public bool Over { get; init; }
    /// <summary>
    /// How far the agreement passes what the pool has across the periods it touches: the sum of the periods' own over-bys. Each period's overspend leaves nothing to carry and is not charged to the
    /// next, so the sum is the pool's whole shortfall; 0 when every period fits. The bar's one line for a pool that spans several periods says it without adding anything up.
    /// </summary>
    public decimal OverBy { get; init; }
    /// <summary>The periods the agreement touches, in date order.</summary>
    public List<AgreementCheckPeriodDto> Periods { get; init; } = new();
}

public record AgreementCheckDto
{
    /// <summary>The participant has a plan that is running now to check against. False is "No budget recorded": the answer then has no pools and no figures, and the bar links to the Funding tab.</summary>
    public bool HasBudget { get; init; }
    /// <summary>
    /// Why there is no budget to compare with, when <see cref="HasBudget"/> is false, in the Budgets list's own two words: no plan that has started is recorded (<c>NotRecorded</c>), or the plan
    /// ended and no successor is recorded (<c>PlanEnded</c>, and <see cref="PlanEnd"/> is its last day). The bar says "No budget recorded" either way and, for an ended plan, that it ended. Omitted when there is a budget.
    /// </summary>
    public BudgetListNoBudgetReason? NoBudgetReason { get; init; }
    public Guid? PlanId { get; init; }
    public DateOnly? PlanStart { get; init; }
    public DateOnly? PlanEnd { get; init; }
    /// <summary>The provider's today.</summary>
    public DateOnly AsOf { get; init; }
    /// <summary>The agreement period that was priced.</summary>
    public DateOnly PeriodFrom { get; init; }
    public DateOnly PeriodTo { get; init; }
    /// <summary>Everything the engine could price in the agreement, in the pools or not.</summary>
    public decimal AgreementCost { get; init; }
    /// <summary>Only the pools and periods the agreement touches, in the plan's order of pools.</summary>
    public List<AgreementCheckPoolDto> Pools { get; init; } = new();
    /// <summary>The part of the agreement whose PACE category no recorded pool of the plan covers: shown, never dropped.</summary>
    public decimal NotInARecordedPool { get; init; }
    /// <summary>The part of the agreement delivered outside the plan's dates: shown, never dropped.</summary>
    public decimal OutsideThePlan { get; init; }
}
