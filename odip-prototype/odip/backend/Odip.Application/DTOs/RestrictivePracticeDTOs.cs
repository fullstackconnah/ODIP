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
    public DateOnly? AuthorisationEndDate { get; init; }
    public DateOnly? FirstUsedOn { get; init; }
    public DateOnly? InterimBspDate { get; init; }
    public DateOnly? ComprehensiveBspDate { get; init; }
    public Guid? RelatedMedicationId { get; init; }
    public bool IsActive { get; init; }

    /// <summary>Whether this needs reporting to the NDIS Commission; null = leave the stored answer as it is.</summary>
    public bool? RequiresReporting { get; init; }

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
