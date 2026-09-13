using System.ComponentModel.DataAnnotations;
using Odip.Domain.Rostering;

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

// ══════════════════════════════════════════════════════════════
// FLAGGED SHIFT NOTES (connection-map Deliverable 3) — coordinator work queue of shift notes
// whose keyword scan matched a category, optionally narrowed to those with no active incident
// filed against them yet. RosteringController.GetFlaggedShiftNotes only; the frontend already
// codes against this exact shape (frontend/src/api/types/rostering.ts) minus StartTime/EndTime/
// EndsNextDay, added here so the frontend can prefill real shift times.
// ══════════════════════════════════════════════════════════════

public record FlaggedShiftNoteDto
{
    public Guid ShiftNoteId { get; init; }
    public Guid ShiftId { get; init; }
    public DateOnly ShiftDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public Guid? StaffId { get; init; }
    public string? StaffName { get; init; }
    // NOTES-02/connection-map: category names (e.g. "Falls", "Medication") — same
    // ShiftNoteKeywordVocabulary.ToCategoryNames-produced shape as ShiftNoteDto.FlaggedCategories,
    // not the raw [Flags] enum. Empty when nothing matched.
    public IReadOnlyList<string> FlaggedCategories { get; init; } = Array.Empty<string>();
    /// <summary>First 200 characters of the note's Body.</summary>
    public string Excerpt { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public Guid? IncidentId { get; init; }
}
