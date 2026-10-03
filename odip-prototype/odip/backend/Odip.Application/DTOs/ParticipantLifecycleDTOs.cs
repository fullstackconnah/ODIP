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

/// <summary>Read-only, server-derived onboarding state; clients cannot set any step status.</summary>
public record ParticipantOnboardingDto
{
    public Guid ParticipantId { get; init; }
    public bool IntakeComplete { get; init; }
    public bool ProfileComplete { get; init; }
    public DateTime? ProfileCompletedAt { get; init; }
    public string? ProfileCompletedBy { get; init; }
    public bool ServiceTypeConfirmed { get; init; }
    public DateTime? ServiceTypeConfirmedAt { get; init; }
    public string? ServiceTypeConfirmedBy { get; init; }
    public bool ServiceAgreementSigned { get; init; }
    /// <summary>
    /// The "Funding recorded" step of the activation checklist: whether an NDIS-funded participant has a plan budget on record that has not ended (provider time). Null when the step
    /// does not apply, because the participant is not NDIS-funded: the checklist does not show it. Money is not here, only whether a plan is recorded.
    /// </summary>
    public bool? FundingRecorded { get; init; }
    public bool IsReady { get; init; }
    public List<string> Reasons { get; init; } = [];
}

/// <summary>Server-derived worklist row; clients cannot choose a lifecycle stage.</summary>
public record ParticipantOnboardingWorklistDto
{
    public Guid ParticipantId { get; init; }
    public string FullName { get; init; } = string.Empty;
    public string Stage { get; init; } = string.Empty;
    public string NextAction { get; init; } = string.Empty;
    public int CompletedSteps { get; init; }
    public int TotalSteps { get; init; } = 5;
    public List<string> Reasons { get; init; } = [];
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
