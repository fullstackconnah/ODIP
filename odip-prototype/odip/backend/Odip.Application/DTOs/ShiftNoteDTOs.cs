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
    DateTime UpdatedAt,
    // NOTES-02: category names (e.g. "Falls", "Medication") ShiftNoteKeywordScanner matched in
    // Body as of the last save — see Odip.Domain.Rostering.ShiftNoteKeywordVocabulary.ToCategoryNames.
    // Empty when nothing matched.
    IReadOnlyList<string> FlaggedCategories,
    // NOTES-02: when the author dismissed the "file an incident report?" prompt for the CURRENT
    // FlaggedCategories value — see ShiftNote.FlagsAcknowledgedAt remarks. Null while unflagged or
    // not yet acknowledged.
    DateTime? FlagsAcknowledgedAt,
    // Connection-map reverse link (Deliverable 2): id of the newest active IncidentReport whose
    // ShiftNoteId points back at this note, or null when none does.
    Guid? IncidentId);

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
