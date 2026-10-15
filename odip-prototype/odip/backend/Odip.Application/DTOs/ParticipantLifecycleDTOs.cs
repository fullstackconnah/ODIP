using System.ComponentModel.DataAnnotations;

namespace Odip.Application.DTOs;

public record ParticipantInquiryDto
{
    public Guid Id { get; init; }
    public Guid? ParticipantId { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string Source { get; init; } = string.Empty;
    public string? Provenance { get; init; }
    public DateTime CreatedAt { get; init; }
    // The linked participant's lifecycle state, so the Enquiries tab can tell an open enquiry ("New": no participant; "Draft intake":
    // intake started, not complete) from one that has moved on, which it does not list: intake complete (the Onboarding tab) or finalised
    // (Active participants). All three are null while the enquiry has no participant.
    public bool? ParticipantIsDraft { get; init; }
    public bool? ParticipantIsActive { get; init; }
    public DateTime? ParticipantIntakeCompletedAt { get; init; }
    /// <summary>
    /// True for a row that is not an enquiry: a draft participant whose intake was started in the Intake wizard (/participants/new) with no
    /// enquiry behind it. It rides in this feed so the Enquiries tab shows every intake in progress; its <see cref="Id"/> is the participant's,
    /// there is no enquiry record to edit, and <see cref="Source"/> is empty.
    /// </summary>
    public bool IsDirectIntake { get; init; }
    // The intake visit booked for this enquiry, all null when there is none. IntakeStartsAt is an instant (UTC, Z on the wire); show it in TimeZoneId.
    public DateTime? IntakeStartsAt { get; init; }
    public int? IntakeDurationMinutes { get; init; }
    public string? IntakeLocation { get; init; }
    public Guid? IntakeStaffUserId { get; init; }
    public string? IntakeStaffFirstName { get; init; }
    public string? IntakeStaffName { get; init; }
    public string? IntakeNotes { get; init; }
    public DateTime? IntakeInviteSentAt { get; init; }
    /// <summary>Why the latest invite did not go: "NotConfigured" (no email service) or "Failed". Null after a send that worked.</summary>
    public string? IntakeInviteError { get; init; }
    public DateTime? IntakeConfirmedAt { get; init; }
    /// <summary>The provider's IANA zone, in which the visit is entered and shown.</summary>
    public string? TimeZoneId { get; init; }
}

/// <summary>
/// An email address that may be left blank. [EmailAddress] alone rejects the empty string (it has no '@'), so a form that
/// posts <c>""</c> for "no email" was answered 400 and a prospect without an email address could not be captured. Null,
/// empty and whitespace pass; anything else must be a valid address.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class OptionalEmailAddressAttribute : ValidationAttribute
{
    private static readonly EmailAddressAttribute Inner = new();
    public override bool IsValid(object? value) => value is not string text || string.IsNullOrWhiteSpace(text) || Inner.IsValid(text.Trim());
}

public record CreateParticipantInquiryDto
{
    [Required, StringLength(100)] public string FirstName { get; init; } = string.Empty;
    [Required, StringLength(100)] public string LastName { get; init; } = string.Empty;
    [StringLength(50)] public string? Phone { get; init; }
    [OptionalEmailAddress, StringLength(200)] public string? Email { get; init; }
    [Required, RegularExpression("^(Web|Email|Phone)$")] public string Source { get; init; } = string.Empty;
    [StringLength(2000)] public string? Provenance { get; init; }
}

public record UpdateParticipantInquiryDto : CreateParticipantInquiryDto;
public record ConvertParticipantInquiryDto { public Guid? ParticipantId { get; init; } }

public record SetIntakeBookingDto
{
    /// <summary>An instant: the provider-local date and time the coordinator chose, converted to UTC by the client (Z on the wire).</summary>
    public DateTime StartsAt { get; init; }
    public int DurationMinutes { get; init; }
    public string? Location { get; init; }
    public Guid StaffUserId { get; init; }
    public string? Notes { get; init; }
    /// <summary>Sent only when the enquiry has no email: validated and saved to the enquiry in the same save as the booking.</summary>
    public string? ContactEmail { get; init; }
}

public record ConfirmIntakeBookingDto { public bool Confirmed { get; init; } }

/// <summary>What a cancel did. CancellationEmail: "Sent", "NoInvite" (none had gone out, so nobody was emailed), "NotConfigured" or "Failed".</summary>
public record CancelIntakeBookingResultDto
{
    public ParticipantInquiryDto Inquiry { get; init; } = new();
    public string CancellationEmail { get; init; } = "NoInvite";
}

/// <summary>One intake visit on a schedule view (My shifts, the Schedule page). StartsAt is an instant; show it in TimeZoneId.</summary>
public record IntakeVisitDto
{
    public Guid InquiryId { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public Guid? ParticipantId { get; init; }
    public bool? ParticipantIsDraft { get; init; }
    public DateTime? ParticipantIntakeCompletedAt { get; init; }
    public DateTime StartsAt { get; init; }
    public int DurationMinutes { get; init; }
    public string Location { get; init; } = string.Empty;
    public Guid StaffUserId { get; init; }
    public string StaffName { get; init; } = string.Empty;
    public DateTime? ConfirmedAt { get; init; }
    public string TimeZoneId { get; init; } = string.Empty;
}

/// <summary>
/// The onboarding checklist (owner decision 2026-10-13), read-only and derived from data: clients cannot tick an item. Exactly four items,
/// three for a participant who is not NDIS-funded (no "Funding" item), in this order.
/// </summary>
public record ParticipantOnboardingDto
{
    public Guid ParticipantId { get; init; }
    public List<OnboardingChecklistItemDto> Items { get; init; } = [];
    /// <summary>Every item is done.</summary>
    public bool IsReady { get; init; }
    /// <summary>When "Begin services" was used; null until then.</summary>
    public DateTime? ServicesStartedAt { get; init; }
    /// <summary>The agreement record, for the form that edits it: a signed date or a reason there is no written agreement (at most one is set).</summary>
    public DateOnly? AgreementSignedOn { get; init; }
    public string? NoAgreementReason { get; init; }
}

/// <summary>
/// One checklist item. <see cref="Key"/> names it and the screen's fix for it: <c>profile</c> (Edit profile), <c>serviceNeeds</c> (Open agreement
/// draft), <c>agreement</c> (Record it: POST .../onboarding/agreement-record), <c>funding</c> (the Funding tab).
/// </summary>
public record OnboardingChecklistItemDto
{
    public string Key { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public bool Done { get; init; }
    /// <summary>One line saying what is missing; null when the item is done.</summary>
    public string? Missing { get; init; }
}

/// <summary>POST /inquiries/{id}/onboarding/agreement-record: exactly one of the two, validated by the server.</summary>
public record RecordOnboardingAgreementDto
{
    public DateOnly? SignedOn { get; init; }
    public string? NoAgreementReason { get; init; }
}

/// <summary>Server-derived worklist row (the Onboarding tab); clients cannot choose a lifecycle stage.</summary>
public record ParticipantOnboardingWorklistDto
{
    public Guid ParticipantId { get; init; }
    public string FullName { get; init; } = string.Empty;
    public DateTime? ServicesStartedAt { get; init; }
    public int CompletedSteps { get; init; }
    public int TotalSteps { get; init; }
    /// <summary>The label of the first item still open; null when every item is done.</summary>
    public string? FirstMissing { get; init; }
}

/// <summary>
/// POST /participants/{id}/status: the one way a screen changes whether a participant is active. It carries the flag and a
/// reason and nothing else, so no screen can wipe a field by sending a partial participant (PUT /participants/{id} is a
/// full replace).
/// </summary>
public record ChangeParticipantStatusDto
{
    /// <summary>Required. Nullable so an omitted flag is a 400 and never a silent "archive".</summary>
    public bool? IsActive { get; init; }
    /// <summary>Why, for the audit trail. Optional; blank is stored as nothing.</summary>
    [StringLength(500)] public string? Reason { get; init; }
}

/// <summary>What the status and restore endpoints answer.</summary>
public record ParticipantStatusResultDto
{
    public Guid Id { get; init; }
    public bool IsActive { get; init; }
    public bool IsDraft { get; init; }
    /// <summary>False when the participant was already in the requested state: nothing was written.</summary>
    public bool Changed { get; init; }
    /// <summary>Non-blocking consequences the screen should show after a success (upcoming shifts that still reference an archived participant, readiness gaps on activation).</summary>
    public List<string> Warnings { get; init; } = [];
}
