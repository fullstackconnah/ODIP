using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// One complaint received by the provider: when it came in, who made it, what was done and the outcome. Personal data, so Admin and Coordinator only (ComplaintsController).
/// No contact details are kept on the row. <see cref="ToldAboutCommission"/> records that the person was told they can complain to the NDIS Commission; nothing is ever sent to it.
/// Archived with <see cref="IsActive"/>, never hard-deleted.
/// </summary>
public class Complaint : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public DateOnly ReceivedOn { get; set; }
    public ComplaintChannel Channel { get; set; }
    public ComplainantKind ComplainantKind { get; set; }

    public Guid? ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    public string? ComplainantName { get; set; }

    public string Summary { get; set; } = string.Empty;
    public ComplaintStatus Status { get; set; } = ComplaintStatus.Open;
    public DateOnly? AcknowledgedOn { get; set; }
    public string? ActionsTaken { get; set; }
    public string? Outcome { get; set; }
    public DateOnly? OutcomeCommunicatedOn { get; set; }
    public bool ToldAboutCommission { get; set; }
    public DateOnly? ToldAboutCommissionOn { get; set; }
    public DateOnly? ClosedOn { get; set; }

    public Guid? HandledByUserId { get; set; }
    public User? HandledBy { get; set; }

    public Guid? IncidentReportId { get; set; }
    public IncidentReport? IncidentReport { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>The row's version as well as its last change: a concurrency token (OdipDbContext). Held in whole microseconds, as PostgreSQL stores it, so the value a GET sends, returned as ExpectedUpdatedAt, still matches the stored one.</summary>
    public DateTime UpdatedAt { get => _updatedAt; set => _updatedAt = Micro(value); }
    private DateTime _updatedAt = Micro(DateTime.UtcNow);
    private static DateTime Micro(DateTime value) => new(value.Ticks - value.Ticks % 10, value.Kind);
}
