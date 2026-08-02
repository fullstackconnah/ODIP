namespace Odip.Domain.Entities;

/// <summary>
/// Restricted/sensitive support profile data for a participant. One-to-one with Participant.
/// </summary>
public class SupportProfile
{
    public Guid Id { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant Participant { get; set; } = null!;
    public string? CommunicationNotes { get; set; }
    public string? BehaviourSupportNotes { get; set; }
    public string? RestrictivePracticeDetails { get; set; }
    public string? ManualHandlingNotes { get; set; }
    public string? MedicationHealthSummary { get; set; }
    public string? EmergencyConsiderations { get; set; }
    public string? TravelSpecificNotes { get; set; }
    public DateOnly? ReviewDate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
