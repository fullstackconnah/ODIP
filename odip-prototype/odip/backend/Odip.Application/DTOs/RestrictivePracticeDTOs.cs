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
    public Guid? RelatedMedicationId { get; init; }
    public string? RelatedMedicationName { get; init; }
    public bool IsActive { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record CreateRestrictivePracticeDto
{
    public RestrictivePracticeType Type { get; init; }

    [Required, StringLength(2000)]
    public string Description { get; init; } = string.Empty;

    [StringLength(200)]
    public string? AuthorisedBy { get; init; }
    public DateOnly? AuthorisationDate { get; init; }
    public DateOnly? ReviewDate { get; init; }

    /// <summary>Only meaningful for Type == ChemicalRestraint. Must reference a medication belonging to the same participant.</summary>
    public Guid? RelatedMedicationId { get; init; }
    public bool IsActive { get; init; } = true;
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
    public Guid? RelatedMedicationId { get; init; }
    public bool IsActive { get; init; }
}

// ══════════════════════════════════════════════════════════════
// RP-01: BULK-ADD (editable-table flow)
// ══════════════════════════════════════════════════════════════

/// <summary>
/// One row of PD-2's "Add entries" bulk table — now the only create path, so a row's
/// <see cref="Type"/> may be <see cref="RestrictivePracticeType.ChemicalRestraint"/>.
/// <see cref="RelatedMedicationId"/> is optional even for a chemical-restraint row (logged
/// before the medication record exists is still a meaningful entry); when set it's validated the
/// same way <see cref="CreateRestrictivePracticeDto.RelatedMedicationId"/> is, via
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
