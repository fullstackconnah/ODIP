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
