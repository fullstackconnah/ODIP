using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT RISK ENTRIES DTOs (INTAKE-09)
// ══════════════════════════════════════════════════════════════

public record ParticipantRiskEntryDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public AtRiskParty AtRiskParty { get; init; }
    public string Description { get; init; } = string.Empty;
    public string? MitigationNotes { get; init; }
    public bool IsActive { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

/// <summary>
/// Shape used both by the nested-CRUD create endpoint (ParticipantId comes from the route) and,
/// as <see cref="CreateParticipantDto.RiskEntries"/>, for rows submitted alongside a brand-new
/// participant — see ParticipantsController.Create.
/// </summary>
public record CreateParticipantRiskEntryDto
{
    public AtRiskParty AtRiskParty { get; init; }

    [Required, StringLength(2000)]
    public string Description { get; init; } = string.Empty;

    [StringLength(2000)]
    public string? MitigationNotes { get; init; }

    public bool IsActive { get; init; } = true;
}

public record UpdateParticipantRiskEntryDto
{
    public AtRiskParty AtRiskParty { get; init; }

    [Required, StringLength(2000)]
    public string Description { get; init; } = string.Empty;

    [StringLength(2000)]
    public string? MitigationNotes { get; init; }

    public bool IsActive { get; init; }
}
