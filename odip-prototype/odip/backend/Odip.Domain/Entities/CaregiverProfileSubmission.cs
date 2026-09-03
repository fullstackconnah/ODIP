using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A caregiver's staged edits to one participant's caregiver-visible profile, reached via a
/// tokenised public link. Nothing here touches the Participant until an admin accepts it.
/// Tenant-scoped directly (unlike IncidentWitness) because there is no non-tenant parent to
/// inherit scope from. See docs/specs/2026-09-03-caregiver-profile-form-design.md.
/// </summary>
public class CaregiverProfileSubmission : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant Participant { get; set; } = null!;

    /// <summary>Lowercase hex SHA-256 of the raw link token. The raw token is never stored.</summary>
    public string TokenHash { get; set; } = string.Empty;

    public CaregiverSubmissionStatus Status { get; set; } = CaregiverSubmissionStatus.Draft;

    public string? CaregiverName { get; set; }
    public string? CaregiverRelationship { get; set; }

    /// <summary>JSON-serialised PatchParticipantDto. Null until the caregiver first saves.</summary>
    public string? Payload { get; set; }
    public int PayloadVersion { get; set; } = 1;

    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }

    public DateTime? SubmittedAt { get; set; }
    public Guid? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? RejectionNote { get; set; }
}
