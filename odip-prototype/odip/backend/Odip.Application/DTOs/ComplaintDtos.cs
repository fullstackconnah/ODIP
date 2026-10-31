using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// COMPLAINTS REGISTER DTOs
// ══════════════════════════════════════════════════════════════

public record ComplaintListDto
{
    public Guid Id { get; init; }
    public DateOnly ReceivedOn { get; init; }
    public ComplaintChannel Channel { get; init; }
    public ComplainantKind ComplainantKind { get; init; }
    public string? ComplainantName { get; init; }
    public string? ParticipantName { get; init; }
    /// <summary>The first 200 characters; the detail has the whole text.</summary>
    public string Summary { get; init; } = string.Empty;
    public ComplaintStatus Status { get; init; }
    /// <summary>Calendar days open on the organisation's date; null once Resolved or Closed. The browser prints this and never recomputes it.</summary>
    public int? OpenDays { get; init; }
    public DateOnly? AcknowledgedOn { get; init; }
    public bool IsActive { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record ComplaintDto
{
    public Guid Id { get; init; }
    public DateOnly ReceivedOn { get; init; }
    public ComplaintChannel Channel { get; init; }
    public ComplainantKind ComplainantKind { get; init; }
    public Guid? ParticipantId { get; init; }
    public string? ParticipantName { get; init; }
    public string? ComplainantName { get; init; }
    public string Summary { get; init; } = string.Empty;
    public ComplaintStatus Status { get; init; }
    public DateOnly? AcknowledgedOn { get; init; }
    public string? ActionsTaken { get; init; }
    public string? Outcome { get; init; }
    public DateOnly? OutcomeCommunicatedOn { get; init; }
    public bool ToldAboutCommission { get; init; }
    public DateOnly? ToldAboutCommissionOn { get; init; }
    public DateOnly? ClosedOn { get; init; }
    public Guid? HandledByUserId { get; init; }
    public string? HandledByName { get; init; }
    public Guid? IncidentReportId { get; init; }
    public string? IncidentReportTitle { get; init; }
    public int? OpenDays { get; init; }
    public bool IsActive { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

/// <summary>The body of both POST and PUT. A new complaint always starts Open, so POST ignores <see cref="Status"/>.</summary>
public record SaveComplaintDto
{
    public DateOnly ReceivedOn { get; init; }
    public ComplaintChannel Channel { get; init; }
    public ComplainantKind ComplainantKind { get; init; }
    public Guid? ParticipantId { get; init; }
    public string? ComplainantName { get; init; }
    public string? Summary { get; init; }
    public ComplaintStatus Status { get; init; }
    public DateOnly? AcknowledgedOn { get; init; }
    public string? ActionsTaken { get; init; }
    public string? Outcome { get; init; }
    public DateOnly? OutcomeCommunicatedOn { get; init; }
    public bool ToldAboutCommission { get; init; }
    public DateOnly? ToldAboutCommissionOn { get; init; }
    public DateOnly? ClosedOn { get; init; }
    public Guid? HandledByUserId { get; init; }
    public Guid? IncidentReportId { get; init; }
    /// <summary>PUT only: the version the form loaded. Null saves as before (an older tab); a stale one is a 409.</summary>
    public DateTime? ExpectedUpdatedAt { get; init; }
}
