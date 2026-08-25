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
