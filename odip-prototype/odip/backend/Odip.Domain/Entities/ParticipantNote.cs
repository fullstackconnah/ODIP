using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A free-text note about a participant — e.g. a personal-care preference, a general
/// observation, or a reminder for support staff. Pinned notes surface first; archived
/// notes are hidden from the default view but never hard-deleted (record retention).
/// </summary>
public class ParticipantNote : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    public bool IsPinned { get; set; }
    public bool IsArchived { get; set; }

    /// <summary>Set server-side from JWT claims at creation time — never client-supplied.</summary>
    public string CreatedByName { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // ── PD-5: safety-critical auto-generated notes ──────────────────

    /// <summary>Non-null only for a system-generated note; identifies which safety-critical field
    /// group produced it (e.g. "safety:allergies"). Unique per (ParticipantId, SourceKey) — enforced
    /// by a partial unique index (WHERE "SourceKey" IS NOT NULL) so manual notes (SourceKey == null)
    /// are never constrained. A manually-edited note KEEPS its SourceKey (never nulled out) — see
    /// IsManuallyEdited below for why that's what prevents a duplicate.</summary>
    public string? SourceKey { get; set; }

    /// <summary>PRODUCT DECISION (resolved): once a human edits an auto-generated note, that edit
    /// STICKS — the sync (<see cref="Odip.Infrastructure.Services.SafetyNoteSyncService"/>) never
    /// overwrites this note's content again, permanently, even after the source field changes
    /// further. A clinician's own wording is usually more accurate than generated text, and
    /// silently destroying it would be worse than a stale note. Set to true by
    /// ParticipantNotesController.Update whenever it's called on a note with a non-null SourceKey
    /// (any edit — title-only, description-only, or both — counts).</summary>
    public bool IsManuallyEdited { get; set; }

    /// <summary>A normalised snapshot of the source field value(s) at the moment content was last
    /// machine-generated, OR last acknowledged as current by a human (dismiss/regenerate). The
    /// ORIGINAL GENERATED TEXT is not recoverable once a human overwrites Description, so drift is
    /// detected by comparing source VALUES, not text. Null for a manual (non-auto) note.</summary>
    public string? SourceValueSnapshot { get; set; }

    /// <summary>True when IsManuallyEdited is true AND the live source field value(s) no longer match
    /// SourceValueSnapshot — i.e. the field changed after a human took ownership of this note's text.
    /// Drives the "source field has changed" hint in NotesTab. Recomputed by the sync service on every
    /// pass; never true for a non-auto note (SourceKey == null) or one that's still machine-managed.</summary>
    public bool HasSourceDrift { get; set; }
}
