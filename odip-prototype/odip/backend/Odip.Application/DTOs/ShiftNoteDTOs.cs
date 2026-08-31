using System.ComponentModel.DataAnnotations;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// SHIFT NOTES DTOs (NOTES-01) — shared shape read by both PortalController (own-shift
// create/read/author-edit) and RosteringController (coordinator-facing read-only list).
// ══════════════════════════════════════════════════════════════

public record ShiftNoteDto(
    Guid Id,
    Guid ShiftId,
    Guid AuthorUserId,
    string AuthorName,
    string Body,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record CreateShiftNoteDto
{
    [Required, StringLength(1000, MinimumLength = 1)]
    public string Body { get; init; } = string.Empty;
}

public record UpdateShiftNoteDto
{
    [Required, StringLength(1000, MinimumLength = 1)]
    public string Body { get; init; } = string.Empty;
}
