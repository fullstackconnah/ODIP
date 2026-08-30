using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// NDIS reportable incident — tracks incidents during trips,
/// including mandatory QSC escalation within 24 hours for critical incidents.
/// </summary>
public class IncidentReport
{
    public Guid Id { get; set; }

    // Trip context (required)
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;

    // Optional participant/staff links
    public Guid? ParticipantBookingId { get; set; }
    public ParticipantBooking? ParticipantBooking { get; set; }
    public Guid? InvolvedParticipantId { get; set; }
    public Participant? InvolvedParticipant { get; set; }
    public Guid? InvolvedUserId { get; set; }
    public User? InvolvedUser { get; set; }

    // Reporting user
    public Guid ReportedByUserId { get; set; }
    public User ReportedByUser { get; set; } = null!;

    // Incident details
    public IncidentType IncidentType { get; set; }
    public IncidentSeverity Severity { get; set; }
    public IncidentStatus Status { get; set; } = IncidentStatus.Draft;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    // When/where
    public DateTime IncidentDateTime { get; set; }
    public string? Location { get; set; }

    // Immediate response
    public string? ImmediateActionsTaken { get; set; }
    public bool WereEmergencyServicesCalled { get; set; }
    public string? EmergencyServicesDetails { get; set; }

    // Witness/evidence
    public string? WitnessNames { get; set; }
    public string? WitnessStatements { get; set; }

    // QSC compliance
    public QscReportingStatus QscReportingStatus { get; set; } = QscReportingStatus.NotRequired;
    public DateTime? QscReportedAt { get; set; }
    public string? QscReferenceNumber { get; set; }

    // Review/resolution
    public Guid? ReviewedByUserId { get; set; }
    public User? ReviewedByUser { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewNotes { get; set; }
    public string? CorrectiveActions { get; set; }
    public DateTime? ResolvedAt { get; set; }

    // Notifications
    public bool FamilyNotified { get; set; }
    public DateTime? FamilyNotifiedAt { get; set; }
    public bool SupportCoordinatorNotified { get; set; }
    public DateTime? SupportCoordinatorNotifiedAt { get; set; }

    // Standard fields
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
