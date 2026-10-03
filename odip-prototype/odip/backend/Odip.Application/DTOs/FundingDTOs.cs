using Odip.Domain.Billing;
using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Application.DTOs;

// Participant budgets (phase 1). Money is on these DTOs and nowhere else: never on the participant DTO, and never visible to SupportWorker or ReadOnly
// (ParticipantFundingController is admitted to SuperAdmin, Admin and Coordinator only). Dates are DateOnly, instants are UTC DateTimes.

/// <summary>One NDIS support category, as <c>GET api/v1/funding/pace-categories</c> serves it. The screens keep no copy of this list.</summary>
public record PaceCategoryDto
{
    public int Number { get; init; }
    public string Name { get; init; } = string.Empty;
    public PaceBudget Budget { get; init; }
    /// <summary>Flexible: the participant may spend it across the other flexible categories of the component. Stated: the plan names the support.</summary>
    public bool Flexible { get; init; }
    /// <summary>False for 01 to 04 (they are Core flexible) and 18 (paid to the participant): the editor never offers them as a stated support.</summary>
    public bool OfferedAsStatedPool { get; init; }
}

public record FundingPeriodDto
{
    public Guid Id { get; init; }
    public int Position { get; init; }
    public DateOnly PeriodStart { get; init; }
    public DateOnly PeriodEnd { get; init; }
    public decimal PlanAmount { get; init; }
    /// <summary>Oassist's share of the amount; omitted when none is recorded (then the limit is the plan amount).</summary>
    public decimal? SetAside { get; init; }
}

public record FundingPoolDto
{
    public Guid Id { get; init; }
    public int Position { get; init; }
    public FundingPoolKind Kind { get; init; }
    /// <summary>0 for a Core (flexible) pool; the support category number for a stated pool.</summary>
    public int PaceCategory { get; init; }
    public PlanType ManagementType { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? Notes { get; init; }
    /// <summary>The sum of the periods' plan amounts (a pool stores no total).</summary>
    public decimal PlanTotal { get; init; }
    /// <summary>The sum of the periods' set-asides; omitted when the pool has none.</summary>
    public decimal? SetAsideTotal { get; init; }
    public List<FundingPeriodDto> Periods { get; init; } = new();
}

public record FundingPlanDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public DateOnly PlanStart { get; init; }
    public DateOnly PlanEnd { get; init; }
    public DateOnly? ReassessmentDate { get; init; }
    /// <summary>1, 3, 6 or 12; omitted when the plan has no funding periods.</summary>
    public int? PeriodLengthMonths { get; init; }
    public BudgetEvidenceSource Evidence { get; init; }
    public DateOnly? ConfirmedOn { get; init; }
    public string? ConfirmedByName { get; init; }
    public string? Notes { get; init; }
    public int Revision { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public List<FundingPoolDto> Pools { get; init; } = new();
}

/// <summary>The plan dates the participant's profile carries (the profile's own scalars), so the screen can show a mismatch with a recorded plan.</summary>
public record ProfilePlanDatesDto
{
    public DateOnly? Start { get; init; }
    public DateOnly? End { get; init; }
}

/// <summary><c>GET .../funding/plans</c>: every plan of the participant, newest first.</summary>
public record FundingPlansDto
{
    public List<FundingPlanDto> Plans { get; init; } = new();
    public ProfilePlanDatesDto ProfilePlanDates { get; init; } = new();
}

public record SaveFundingPeriodDto
{
    public DateOnly? PeriodStart { get; init; }
    public DateOnly? PeriodEnd { get; init; }
    public decimal? PlanAmount { get; init; }
    public decimal? SetAside { get; init; }
}

public record SaveFundingPoolDto
{
    public FundingPoolKind? Kind { get; init; }
    public int PaceCategory { get; init; }
    public PlanType? ManagementType { get; init; }
    /// <summary>As printed on the plan; blank takes the category's name ("Core (flexible)" for a Core pool).</summary>
    public string? Name { get; init; }
    public string? Notes { get; init; }
    public List<SaveFundingPeriodDto>? Periods { get; init; }
}

/// <summary>
/// The body of a create (POST) and a replace (PUT): the plan's fields and ALL its pools and periods. A PUT carries the <see cref="Revision"/> it was made from and
/// a mismatch is a 409. Every reason a save is refused is in <c>errors</c>, in plain words.
/// </summary>
public record SaveFundingPlanDto
{
    public DateOnly? PlanStart { get; init; }
    public DateOnly? PlanEnd { get; init; }
    public DateOnly? ReassessmentDate { get; init; }
    public int? PeriodLengthMonths { get; init; }
    public BudgetEvidenceSource? Evidence { get; init; }
    public DateOnly? ConfirmedOn { get; init; }
    public string? ConfirmedByName { get; init; }
    public string? Notes { get; init; }
    /// <summary>The revision the client's copy of the plan was loaded at. Required by PUT, ignored by POST.</summary>
    public int? Revision { get; init; }
    public List<SaveFundingPoolDto>? Pools { get; init; }
}

/// <summary>The data of a 409 for a stale save: the revision the plan is at now.</summary>
public record FundingRevisionConflictDto
{
    public int CurrentRevision { get; init; }
}

/// <summary>The data of a 409 for overlapping plans: the plan that is in the way.</summary>
public record FundingPlanOverlapDto
{
    public Guid ConflictingPlanId { get; init; }
    public DateOnly ConflictingPlanStart { get; init; }
    public DateOnly ConflictingPlanEnd { get; init; }
}

/// <summary>What <c>POST .../apply-dates-to-profile</c> answers: the profile's plan dates after the change. <see cref="Changed"/> is false when they already matched.</summary>
public record ApplyPlanDatesResultDto
{
    public DateOnly Start { get; init; }
    public DateOnly End { get; init; }
    public bool Changed { get; init; }
}

/// <summary>One Billing funding source row behind the hint. The rows are never changed by anything in this feature.</summary>
public record BillingSourceHintRowDto
{
    public Guid Id { get; init; }
    public FundingRouteType RouteType { get; init; }
    public string? BudgetCategory { get; init; }
    public decimal Budget { get; init; }
    public DateOnly? PlanStartDate { get; init; }
    public DateOnly? PlanEndDate { get; init; }
    public string? PayerName { get; init; }
}

/// <summary>
/// <c>GET .../funding/billing-sources-hint</c>: what the participant's Billing funding sources already say, as a one-off starting point for a Core (flexible)
/// pool. The sources are the active ones on an NDIS route (agency, plan or self managed) with a budget above zero, the same filter the plan builder's budget bar
/// uses. Empty <see cref="Rows"/> means there is nothing to start from.
/// </summary>
public record BillingSourcesHintDto
{
    public decimal Total { get; init; }
    /// <summary>The earliest start and latest end among the rows' own plan dates; omitted when none of them has one.</summary>
    public DateOnly? PlanStart { get; init; }
    public DateOnly? PlanEnd { get; init; }
    /// <summary>The management type of the rows holding most of the money.</summary>
    public PlanType? ManagementType { get; init; }
    public List<BillingSourceHintRowDto> Rows { get; init; } = new();
}

/// <summary>The organisation's budget settings. <see cref="IsDefault"/> says nothing is stored yet and these are the defaults.</summary>
public record BudgetSettingsDto
{
    public BudgetLimitMode Mode { get; init; }
    public int ApproachingPercent { get; init; }
    public bool IsDefault { get; init; }
}

/// <summary>A change to the budget settings. Each setting changes ONLY when the request carries it, so a stale client can never revert one it does not know about.</summary>
public record UpdateBudgetSettingsDto
{
    public BudgetLimitMode? Mode { get; init; }
    public int? ApproachingPercent { get; init; }
}
