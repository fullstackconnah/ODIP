using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Billing;

/// <summary>How a pool of money is managed: by the agency, a plan manager, the participant, or a private / business payer.</summary>
public enum FundingRouteType
{
    AgencyManaged = 0,
    PlanManaged = 1,
    SelfManaged = 2,
    Private = 3,
    BusinessToBusiness = 4
}

/// <summary>
/// A source of funds attached to a participant: an NDIS plan budget category,
/// a private payer, or a B2B customer. One participant can hold several.
/// </summary>
public class FundingSource : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public FundingRouteType RouteType { get; set; }
    /// <summary>e.g. "Core - Social & Community Participation" or "CB - Improved Relationships".</summary>
    public string? BudgetCategory { get; set; }
    public string? NdisPlanNumber { get; set; }
    public DateOnly? PlanStartDate { get; set; }
    public DateOnly? PlanEndDate { get; set; }
    public decimal? Budget { get; set; }

    /// <summary>Payer contact for invoice routes (plan manager org / family / B2B org).</summary>
    public string? PayerName { get; set; }
    public string? PayerEmail { get; set; }
    public bool IsActive { get; set; } = true;
}
