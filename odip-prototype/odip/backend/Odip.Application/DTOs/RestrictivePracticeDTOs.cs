using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// RESTRICTIVE PRACTICE REGISTER DTOs
// ══════════════════════════════════════════════════════════════

public record RestrictivePracticeDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public RestrictivePracticeType Type { get; init; }
    public string Description { get; init; } = string.Empty;
    public string? AuthorisedBy { get; init; }
    public DateOnly? AuthorisationDate { get; init; }
    public DateOnly? ReviewDate { get; init; }
    /// <summary>Routine or as needed; for a linked chemical entry it follows the medicine (RestrictivePracticeAuthorisation.UseKindOf).</summary>
    public RestrictivePracticeUseKind UseKind { get; init; }
    public DateOnly? AuthorisationEndDate { get; init; }
    public DateOnly? FirstUsedOn { get; init; }
    public DateOnly? InterimBspDate { get; init; }
    public DateOnly? ComprehensiveBspDate { get; init; }
    /// <summary>The earliest use on record (an active use incident, or an administered dose of the linked medicine); a suggestion for FirstUsedOn, never auto-filled.</summary>
    public DateOnly? EarliestRecordedUseDate { get; init; }
    public DateOnly? InterimBspDueOn { get; init; }
    public DateOnly? ComprehensiveBspDueOn { get; init; }
    public BspPlanState InterimBspState { get; init; }
    public BspPlanState ComprehensiveBspState { get; init; }
    public Guid? RelatedMedicationId { get; init; }
    public string? RelatedMedicationName { get; init; }
    public MedicationStatus? RelatedMedicationStatus { get; init; }
    public bool? RequiresReporting { get; init; }
    public string? CommissionReference { get; init; }
    public bool IsActive { get; init; }
    /// <summary>The one "Authorised" rule (RestrictivePracticeAuthorisation), judged on the organisation's calendar date. The browser shows this and never recomputes it.</summary>
    public bool IsAuthorised { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record UpdateRestrictivePracticeDto
{
    public RestrictivePracticeType Type { get; init; }

    [Required, StringLength(2000)]
    public string Description { get; init; } = string.Empty;

    [StringLength(200)]
    public string? AuthorisedBy { get; init; }
    public DateOnly? AuthorisationDate { get; init; }
    public DateOnly? ReviewDate { get; init; }
    /// <summary>Ignored while a medicine is linked (the medicine sets it); null leaves the stored value, so an older tab that does not send it changes nothing.</summary>
    public RestrictivePracticeUseKind? UseKind { get; init; }
    /// <summary>True when the sender fills in the four dates below (the end, first-use and both plan dates), so null clears one. Absent or false (a pre-register-dates tab) leaves all four as stored.</summary>
    // shortcut: drop DatesIncluded once no pre-#524 tab can be open (one release)
    public bool? DatesIncluded { get; init; }
    public DateOnly? AuthorisationEndDate { get; init; }
    public DateOnly? FirstUsedOn { get; init; }
    public DateOnly? InterimBspDate { get; init; }
    public DateOnly? ComprehensiveBspDate { get; init; }
    public Guid? RelatedMedicationId { get; init; }
    public bool IsActive { get; init; }

    /// <summary>Whether this needs reporting to the NDIS Commission; null = leave the stored answer as it is.</summary>
    public bool? RequiresReporting { get; init; }

    /// <summary>The NDIS Commission ID for this practice. Null leaves the stored value (a tab opened before this field does not send it); a blank string clears it.</summary>
    [StringLength(50)]
    public string? CommissionReference { get; init; }

    /// <summary>The version the form loaded (RestrictivePracticeDto.UpdatedAt): the server answers 409 if the entry changed since. Absent from older open tabs, which save as before.</summary>
    public DateTime? ExpectedUpdatedAt { get; init; }
}

// ══════════════════════════════════════════════════════════════
// RP-01: BULK-ADD (editable-table flow)
// ══════════════════════════════════════════════════════════════

/// <summary>
/// One row of PD-2's "Add entries" bulk table — now the only create path, so a row's
/// <see cref="Type"/> may be <see cref="RestrictivePracticeType.ChemicalRestraint"/>.
/// <see cref="RelatedMedicationId"/> is optional even for a chemical-restraint row (logged
/// before the medication record exists is still a meaningful entry); when set it's validated the
/// same way an update's related medication is, via
/// <c>RestrictivePracticesController.ValidateRelatedMedicationAsync</c>. No data-annotation
/// attributes here on purpose: bulk validation is done manually per row in the controller so
/// every failure can be reported against its row index instead of short-circuiting on the first
/// ASP.NET automatic-model-validation failure with no row context.
/// </summary>
public record BulkCreateRestrictivePracticeRowDto
{
    public RestrictivePracticeType Type { get; init; }
    public string Description { get; init; } = string.Empty;
    public string? AuthorisedBy { get; init; }
    public DateOnly? AuthorisationDate { get; init; }
    public DateOnly? ReviewDate { get; init; }
    public RestrictivePracticeUseKind UseKind { get; init; }
    public DateOnly? AuthorisationEndDate { get; init; }

    /// <summary>Only meaningful when <see cref="Type"/> is ChemicalRestraint. Optional — a
    /// chemical restraint row may be added unlinked. Must reference a medication belonging to
    /// the same participant when set.</summary>
    public Guid? RelatedMedicationId { get; init; }
    public bool IsActive { get; init; } = true;
}

public record BulkCreateRestrictivePracticeDto
{
    public List<BulkCreateRestrictivePracticeRowDto> Items { get; init; } = new();
}

// ══════════════════════════════════════════════════════════════
// MONTHLY REPORT DTOs (the NDIS Commission's monthly restrictive practice report)
// ══════════════════════════════════════════════════════════════

/// <summary>One practice's month: what is owed, when it is due, the uses behind it, and the report lodged for it once there is one.</summary>
public record RestrictivePracticeReportLineDto
{
    public Guid RestrictivePracticeId { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public RestrictivePracticeType PracticeType { get; init; }
    public string PracticeDescription { get; init; } = string.Empty;
    public RestrictivePracticeUseKind UseKind { get; init; }
    public DateOnly? AuthorisationDate { get; init; }
    public DateOnly? AuthorisationEndDate { get; init; }
    /// <summary>First day of the month.</summary>
    public DateOnly Month { get; init; }
    public DateOnly DueOn { get; init; }
    /// <summary>True when the due date skipped weekends only, because the holiday feed has no rows for a year the count touched.</summary>
    public bool DueCountedWithoutHolidays { get; init; }
    public MonthlyReportState State { get; init; }
    /// <summary>As-needed lines only: NotUsed with no uses, else UsesReported.</summary>
    public RestrictivePracticeReportType? SuggestedType { get; init; }
    public List<RestrictivePracticeUseDto> Uses { get; init; } = new();
    public RestrictivePracticeMonthlyReportDto? Report { get; init; }
}

/// <summary>One recorded use. <see cref="LocalDateTime"/> is the provider's wall clock (Kind Unspecified), serialised without an offset.</summary>
public record RestrictivePracticeUseDto
{
    public DateTime LocalDateTime { get; init; }
    public Guid? IncidentReportId { get; init; }
    public Guid? MedicationAdministrationId { get; init; }
}

public record RestrictivePracticeMonthlyReportDto
{
    public Guid Id { get; init; }
    public RestrictivePracticeReportType ReportType { get; init; }
    public RestrictivePracticeVariedKind? VariedKind { get; init; }
    public bool? VariedAlsoUnauthorised { get; init; }
    public int? UseCount { get; init; }
    public string? Note { get; init; }
    public DateOnly LodgedOn { get; init; }
    public string LodgedByName { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
}

public record LodgeRestrictivePracticeReportDto
{
    public Guid RestrictivePracticeId { get; init; }
    public DateOnly Month { get; init; }
    public RestrictivePracticeReportType ReportType { get; init; }
    public RestrictivePracticeVariedKind? VariedKind { get; init; }
    public bool? VariedAlsoUnauthorised { get; init; }
    public string? Note { get; init; }
    public DateOnly LodgedOn { get; init; }
}
