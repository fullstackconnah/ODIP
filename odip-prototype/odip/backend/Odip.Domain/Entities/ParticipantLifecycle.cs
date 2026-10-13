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

/// <summary>Server-owned onboarding evidence. Readiness is derived, never supplied by a UI checkbox.</summary>
public class ParticipantOnboarding : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    // Retired 2026-10-13: the checklist derives "Profile details" and "Service needs" from the participant's data, so no code reads or writes
    // these four any more. The columns stay (no data is dropped).
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
    // The checklist's "Signed agreement" item, recorded by hand: the date the written agreement was signed, OR why there is none (NDIS Practice
    // Standards: a signed copy, or a record of why not). Exactly one is set. Separate from the e-sign evidence above, which stays closed.
    public DateOnly? AgreementSignedOn { get; private set; }
    public string? NoAgreementReason { get; private set; }
    public DateTime? AgreementRecordedAt { get; private set; }
    public string? AgreementRecordedBy { get; private set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Records the agreement item; the caller has checked that exactly one of <paramref name="signedOn"/> and <paramref name="reason"/> is given.</summary>
    public void RecordAgreement(DateOnly? signedOn, string? reason, string actor, DateTime atUtc)
    {
        AgreementSignedOn = signedOn; NoAgreementReason = reason; AgreementRecordedBy = actor; AgreementRecordedAt = atUtc; UpdatedAt = atUtc;
    }
}
