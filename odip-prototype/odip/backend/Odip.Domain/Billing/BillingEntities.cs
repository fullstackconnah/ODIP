using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Billing;

/// <summary>
/// How a pool of money is managed — drives billing routing:
/// Agency → NDIS claim (PRODA bulk file / Brevity), PlanManaged → Xero invoice to plan manager,
/// SelfManaged → invoice participant/nominee, Private/B2B → direct invoice.
/// </summary>
public enum FundingRouteType
{
    AgencyManaged = 0,
    PlanManaged = 1,
    SelfManaged = 2,
    Private = 3,
    BusinessToBusiness = 4
}

public enum BillableEventStatus
{
    Draft = 0,
    Validated = 1,
    Routed = 2,
    Claimed = 3,
    Invoiced = 4,
    Paid = 5,
    Rejected = 6,
    Cancelled = 7
}

/// <summary>Income stream a billable event belongs to (revenue dashboard dimension).</summary>
public enum IncomeStream
{
    Holidays = 0,
    CommunityAccess = 1,
    CapacityBuilding = 2,
    Nursing = 3,
    Training = 4,
    PositiveBehaviourSupport = 5,
    ShortTermAccommodation = 6,
    SupportedIndependentLiving = 7,
    WhiteLabel = 8,
    Other = 99
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

/// <summary>
/// Mirror of a PRODA service booking for agency-managed funding.
/// Balance tracking here prevents the #1 documented claim-rejection cause:
/// "entered amount greater than available service booking amount".
/// </summary>
public class ServiceBooking : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid FundingSourceId { get; set; }
    public FundingSource? FundingSource { get; set; }

    public string ProdaBookingReference { get; set; } = string.Empty;
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    /// <summary>Days after EndDate in which claims must be lodged (NDIA terms; confirm 60 — see open question 7a).</summary>
    public int ClaimWindowDays { get; set; } = 60;

    public ICollection<ServiceBookingLine> Lines { get; set; } = new List<ServiceBookingLine>();

    public DateOnly ClaimDeadline => EndDate.AddDays(ClaimWindowDays);
}

public class ServiceBookingLine
{
    public Guid Id { get; set; }
    public Guid ServiceBookingId { get; set; }
    public ServiceBooking? ServiceBooking { get; set; }

    public string SupportItemNumber { get; set; } = string.Empty;
    public decimal AllocatedAmount { get; set; }
    public decimal ClaimedAmount { get; set; }

    public decimal RemainingAmount => AllocatedAmount - ClaimedAmount;
}

/// <summary>
/// The universal billing unit. Every income stream produces these
/// (trip funding-plan lines, completed shifts, STA nights, training enrolments…),
/// and the router turns them into claim lines or invoice lines.
/// </summary>
public class BillableEvent : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Guid FundingSourceId { get; set; }
    public FundingSource? FundingSource { get; set; }
    public Guid? ServiceBookingId { get; set; }

    public IncomeStream Stream { get; set; }
    /// <summary>Origin entity for traceability, e.g. TripInstance, Shift, Enrolment.</summary>
    public string? SourceEntityType { get; set; }
    public Guid? SourceEntityId { get; set; }

    public string SupportItemNumber { get; set; } = string.Empty;
    public DateOnly SupportsDeliveredFrom { get; set; }
    public DateOnly SupportsDeliveredTo { get; set; }
    public ClaimDayType DayType { get; set; }

    /// <summary>Exactly one of Quantity / Hours must be set (NDIS bulk-file rule).</summary>
    public decimal? Quantity { get; set; }
    public TimeSpan? Hours { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal TotalAmount { get; set; }
    public GSTCode GstCode { get; set; } = GSTCode.P2;

    public ClaimType ClaimType { get; set; } = ClaimType.Standard;
    public string? CancellationReasonCode { get; set; }
    public bool ParticipantApproved { get; set; }

    /// <summary>Unique claim/invoice reference, e.g. the WOW invoice number. Duplicate detection key.</summary>
    public string ClaimReference { get; set; } = string.Empty;

    public BillableEventStatus Status { get; set; } = BillableEventStatus.Draft;
    public string? RejectionReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A batch of agency-managed billable events exported as one PRODA bulk payment request file.</summary>
public class ClaimBatch : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    /// <summary>File name per Oassist convention, e.g. NDISUPLOAD020826.csv.</summary>
    public string FileName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SubmittedAt { get; set; }
    public ICollection<BillableEvent> Events { get; set; } = new List<BillableEvent>();
}
