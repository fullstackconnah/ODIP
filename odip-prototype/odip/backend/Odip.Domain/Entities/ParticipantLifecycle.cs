using Odip.Domain.Enums;
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
    // The intake visit booked for this enquiry (owner decisions 2026-10-14): one current booking, every column empty when there is none.
    // IntakeStartsAt is a UTC instant; the visit is entered and shown in the provider's zone. IntakeInviteSentAt is when an invite last went out
    // for this UID; IntakeInviteError is the latest send's failure ("NotConfigured", "Failed"), cleared by a send that works. IntakeUid and
    // IntakeIcsSequence identify the calendar event across updates and a cancellation. IntakeBookedByUserId is the coordinator who booked it: the
    // invite's ORGANIZER and Reply-To stay that person for every revision, because calendar apps treat a changed ORGANIZER as another event.
    public DateTime? IntakeStartsAt { get; set; }
    public int? IntakeDurationMinutes { get; set; }
    public string? IntakeLocation { get; set; }
    public Guid? IntakeStaffUserId { get; set; }
    public User? IntakeStaffUser { get; set; }
    public Guid? IntakeBookedByUserId { get; set; }
    public User? IntakeBookedByUser { get; set; }
    public string? IntakeNotes { get; set; }
    public DateTime? IntakeInviteSentAt { get; set; }
    public string? IntakeInviteError { get; set; }
    public DateTime? IntakeConfirmedAt { get; set; }
    public int IntakeIcsSequence { get; set; }
    public string? IntakeUid { get; set; }

    /// <summary>Cancels the booking: every intake column back to empty. The next booking gets a new UID and starts at SEQUENCE 0.</summary>
    public void ClearIntakeBooking()
    {
        IntakeStartsAt = null; IntakeDurationMinutes = null; IntakeLocation = null; IntakeStaffUserId = null; IntakeBookedByUserId = null; IntakeNotes = null;
        IntakeInviteSentAt = null; IntakeInviteError = null; IntakeConfirmedAt = null; IntakeIcsSequence = 0; IntakeUid = null;
    }
}

/// <summary>
/// A contact noted on an enquiry before any participant exists (spec 2026-10-16, D3): family, guardians and others to keep in touch with. Only
/// GET /inquiries/{id} reads it, for the roles that edit enquiries. Start intake (Convert) moves it onto the participant as a Person and a contact role,
/// and deletes it; deleting the enquiry deletes it (cascade). Any role but PlanManager, which needs a plan type an enquiry hasn't got.
/// </summary>
public class InquiryContact : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid InquiryId { get; set; }
    public int SortOrder { get; set; }
    public ContactRoleType Role { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Relationship { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
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
