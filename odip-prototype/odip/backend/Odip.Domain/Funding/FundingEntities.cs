using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Funding;

/// <summary>
/// A participant's NDIS plan budget as the provider records it (budget feature, phase 1): one row per plan, a new one at each reassessment or new plan, the old
/// ones kept. It holds the plan's dates, how its funding is released, where the figures came from and who confirmed them; the money is in its
/// <see cref="Pools"/> and their <see cref="FundingPool.Periods"/>. It is a table of its own and never a field of <see cref="Participant"/>: a dollar figure on
/// the participant would reach SupportWorker and ReadOnly, and a plan history would be lost to the profile's overwritten plan dates.
///
/// Named FundingPlan because <c>FundingSource</c> is the Billing entity (and the participant's NDIS-or-other enum) and <c>PlanBudget</c> is a phase C type.
/// No spending, forecast or alert is stored or computed here: those are later phases, and they compute from these rows and never write to them.
/// </summary>
public class FundingPlan : ITenantEntity
{
    /// <summary>The longest a plan may run, in days: the pricing engine's own ceiling for a period.</summary>
    public const int MaxPlanDays = 800;

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    /// <summary>The first day of the plan. Plan dates are calendar days (DateOnly), inclusive at both ends.</summary>
    public DateOnly PlanStart { get; set; }
    /// <summary>The last day of the plan, inclusive. On or after <see cref="PlanStart"/>, and at most <see cref="MaxPlanDays"/> days from it.</summary>
    public DateOnly PlanEnd { get; set; }
    public DateOnly? ReassessmentDate { get; set; }

    /// <summary>
    /// The length of the plan's funding periods in months: 1, 3, 6 or 12. Null means the plan has no funding periods (the whole plan is one period, and
    /// each pool then holds exactly one period equal to the plan's dates).
    /// </summary>
    public int? PeriodLengthMonths { get; set; }

    public BudgetEvidenceSource Evidence { get; set; } = BudgetEvidenceSource.PlanCopy;
    /// <summary>The day somebody checked these figures against the source, and who.</summary>
    public DateOnly? ConfirmedOn { get; set; }
    public string? ConfirmedByName { get; set; }
    public string? Notes { get; set; }

    /// <summary>Starts at 1 and goes up by 1 on every save. A save carries the revision it was made from, and a mismatch is a 409 (somebody saved in between).</summary>
    public int Revision { get; set; } = 1;

    /// <summary>UTC instants, from the injected clock.</summary>
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    /// <summary>The NameIdentifier claim of the user who created the plan, and of the one who last saved it.</summary>
    public string CreatedBy { get; set; } = string.Empty;
    public string UpdatedBy { get; set; } = string.Empty;

    public ICollection<FundingPool> Pools { get; set; } = new List<FundingPool>();
}

/// <summary>
/// One pool of a <see cref="FundingPlan"/>, as the plan prints it: a Core (flexible) pool for categories 01 to 04, or one stated support category. A plan can
/// hold two Core (flexible) pools with different management types (the NDIA splits Core by management type). Money is not stored here: a pool's total is the
/// sum of its <see cref="Periods"/>.
/// </summary>
public class FundingPool : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid FundingPlanId { get; set; }
    public FundingPlan? FundingPlan { get; set; }

    /// <summary>The order the plan prints the pools in, from 0.</summary>
    public int Position { get; set; }
    public FundingPoolKind Kind { get; set; }

    /// <summary>0 for <see cref="FundingPoolKind.CoreFlexible"/>. For a stated pool one of 5 to 17, 19, 20 or 21: never 1 to 4 (Core flexible) and never 18 (paid to the participant).</summary>
    public int PaceCategory { get; set; }

    /// <summary>Who manages the money: the participant (SelfManaged), a plan manager (PlanManaged) or the NDIA (AgencyManaged). It decides the claim path.</summary>
    public PlanType ManagementType { get; set; }

    /// <summary>As printed on the plan; the category's name when the plan gives none.</summary>
    public string Name { get; set; } = string.Empty;
    public string? Notes { get; set; }

    public ICollection<FundingPeriod> Periods { get; set; } = new List<FundingPeriod>();
}

/// <summary>
/// One release period of a <see cref="FundingPool"/>: the money the plan makes available for a stretch of the plan. The periods of a pool run one straight after
/// the other from the plan's first day to its last. A plan with no funding periods has one period equal to the plan's dates.
/// </summary>
public class FundingPeriod : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid FundingPoolId { get; set; }
    public FundingPool? FundingPool { get; set; }

    public int Position { get; set; }
    /// <summary>Inclusive calendar days.</summary>
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }

    /// <summary>What the plan releases for the period, in dollars: decimal(18,2), zero or more.</summary>
    public decimal PlanAmount { get; set; }

    /// <summary>
    /// The organisation's share of <see cref="PlanAmount"/> when the participant also uses other providers: zero or more, and no more than the plan amount. Set on every
    /// period of a pool or on none; null everywhere means the limit is the plan amount.
    /// </summary>
    public decimal? SetAside { get; set; }
}

/// <summary>
/// One organisation's budget settings: what a budget check does about a forecast over the budget, and when a participant counts as approaching it. One row per
/// tenant; an organisation with no row has the defaults, which are also the defaults of every column here (constant database defaults, so a missing row and a
/// row written by an older build both read as the defaults). The phase 1 release stores the choice; checks arrive in a later phase. A table of its own, like
/// <c>PlanPricingSettings</c>, and audited by the generic interceptor (it holds nothing private).
/// </summary>
public class BudgetSettings : ITenantEntity
{
    public const BudgetLimitMode DefaultMode = BudgetLimitMode.Warn;
    public const int DefaultApproachingPercent = 80;
    public const int MinApproachingPercent = 50;
    public const int MaxApproachingPercent = 95;
    public const int ApproachingPercentStep = 5;

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public BudgetLimitMode Mode { get; set; } = DefaultMode;
    /// <summary>A participant is "approaching" their budget once what is used reaches this percentage of what is available: 50 to 95 in steps of 5.</summary>
    public int ApproachingPercent { get; set; } = DefaultApproachingPercent;

    public static bool IsAllowedApproachingPercent(int percent) =>
        percent is >= MinApproachingPercent and <= MaxApproachingPercent && percent % ApproachingPercentStep == 0;
}
