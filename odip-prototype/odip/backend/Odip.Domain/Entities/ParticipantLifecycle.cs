using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>Tenant-owned prospect record. Conversion links to the single existing Participant master record.</summary>
public class ParticipantInquiry : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public Guid? ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string Source { get; set; } = "Phone";
    public string? Provenance { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Future onboarding gate scaffold. Readiness is always computed, never supplied by a UI checkbox.</summary>
public class ParticipantOnboarding : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    public bool ProfileComplete { get; set; }
    public DateTime? ProfileCompletedAt { get; set; }
    public string? ProfileCompletedBy { get; set; }
    public bool ServiceTypeConfirmed { get; set; }
    public DateTime? ServiceTypeConfirmedAt { get; set; }
    public string? ServiceTypeConfirmedBy { get; set; }
    // No UI/API setter: signed status must be established by a later immutable agreement-snapshot flow.
    public bool ServiceAgreementSigned { get; private set; }
    public DateTime? ServiceAgreementSignedAt { get; private set; }
    public string? ServiceAgreementSignedBy { get; private set; }
    public bool IsReady => ProfileComplete && ServiceTypeConfirmed && ServiceAgreementSigned;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
