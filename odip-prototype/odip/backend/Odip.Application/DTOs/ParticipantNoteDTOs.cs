using System.ComponentModel.DataAnnotations;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT NOTES DTOs
// ══════════════════════════════════════════════════════════════

public record ParticipantNoteDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public bool IsPinned { get; init; }
    public bool IsArchived { get; init; }
    public string CreatedByName { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }

    /// <summary>PD-5: non-null identifies this as a system-generated safety-critical note (e.g.
    /// "safety:allergies") and drives the "Auto-generated" tag in NotesTab.</summary>
    public string? SourceKey { get; init; }

    /// <summary>PD-5: true when a manually-edited auto-note's source field has changed since the
    /// edit — drives the "source data has changed" hint in NotesTab.</summary>
    public bool HasSourceDrift { get; init; }
}

public record CreateParticipantNoteDto
{
    [Required, StringLength(200)]
    public string Title { get; init; } = string.Empty;

    [Required, StringLength(4000)]
    public string Description { get; init; } = string.Empty;

    public bool IsPinned { get; init; }
}

public record UpdateParticipantNoteDto
{
    [Required, StringLength(200)]
    public string Title { get; init; } = string.Empty;

    [Required, StringLength(4000)]
    public string Description { get; init; } = string.Empty;

    public bool IsPinned { get; init; }
    public bool IsArchived { get; init; }
}
