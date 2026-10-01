using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>
/// The next worker marking a handover as READ: who read it, when, and in which of their shifts. One row per
/// (handover completion, reader) - acknowledging again is an idempotent no-op. Audited. Staged on purpose: a
/// handover is never silently assumed read.
///
/// A handover belongs to a <see cref="ShiftCompletion"/> (its <see cref="ShiftCompletion.HandoverText"/>); the
/// "latest handover for a participant" is the most recent submitted-or-approved completion's, worked out by
/// <c>ShiftHandoverService</c>.
/// </summary>
public class HandoverAcknowledgement : ITenantEntity
{
    /// <summary>Unique index on (SourceCompletionId, UserId): one acknowledgement per reader per handover.</summary>
    public const string UniqueReaderIndexName = "IX_HandoverAcknowledgements_SourceCompletionId_UserId";

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    /// <summary>The completion whose handover was read (the PREVIOUS worker's).</summary>
    public Guid SourceCompletionId { get; set; }
    public ShiftCompletion? SourceCompletion { get; set; }

    /// <summary>The reader's own shift the handover was acknowledged from.</summary>
    public Guid ShiftId { get; set; }
    public Shift? Shift { get; set; }

    /// <summary>Who read it.</summary>
    public Guid UserId { get; set; }
    public Odip.Domain.Entities.User? User { get; set; }

    /// <summary>UTC.</summary>
    public DateTime AcknowledgedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
