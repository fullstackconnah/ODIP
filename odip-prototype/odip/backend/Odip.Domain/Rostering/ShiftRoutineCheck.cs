using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>
/// A routine the worker ticked off during a shift ("done"), recorded against the shift's ACTIVE <see cref="ShiftCompletion"/> (so a Return,
/// which archives the completion, archives its ticks with it - the resubmitting worker starts the checklist afresh, like the breaks).
/// Until now a tick was only local state in the browser: nothing was kept for the coordinator and a reload lost it.
///
/// One tick per (completion, routine, <see cref="ScheduledAt"/>): <see cref="ScheduledAt"/> is the provider-local time of the occurrence the
/// routine matched in the shift window (<see cref="RoutineOccurrence.OccursAtLocal"/>), or NULL for an untimed routine (those are only
/// surfaced when critical and have no time to sit under). A plain unique index would treat NULLs as distinct, so uniqueness is two partial
/// unique indexes (timed: WHERE ScheduledAt IS NOT NULL; untimed: WHERE ScheduledAt IS NULL) - see <see cref="UniqueTimedIndexName"/> and
/// <see cref="UniqueUntimedIndexName"/>. Ticking again is an idempotent no-op that keeps the original who and when; unticking removes the row
/// (the delete is audited, like every change to this entity).
///
/// A hard-deleted routine (the routine endpoints allow it) takes its ticks with it (cascade); the completion and the worker are Restrict.
/// </summary>
public class ShiftRoutineCheck : ITenantEntity
{
    /// <summary>Partial unique index on (ShiftCompletionId, ParticipantRoutineId, ScheduledAt) WHERE ScheduledAt IS NOT NULL.</summary>
    public const string UniqueTimedIndexName = "IX_ShiftRoutineChecks_Completion_Routine_ScheduledAt";

    /// <summary>Partial unique index on (ShiftCompletionId, ParticipantRoutineId) WHERE ScheduledAt IS NULL.</summary>
    public const string UniqueUntimedIndexName = "IX_ShiftRoutineChecks_Completion_Routine_Untimed";

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid ShiftCompletionId { get; set; }
    public ShiftCompletion? ShiftCompletion { get; set; }

    public Guid ParticipantRoutineId { get; set; }
    public ParticipantRoutine? ParticipantRoutine { get; set; }

    /// <summary>Provider-local wall-clock start of the occurrence this tick is for (Kind Unspecified); null for an untimed routine.</summary>
    public DateTime? ScheduledAt { get; set; }

    /// <summary>The worker who ticked it - the shift's own worker.</summary>
    public Guid CheckedByUserId { get; set; }
    public User? CheckedByUser { get; set; }

    /// <summary>UTC. Server-stamped.</summary>
    public DateTime CheckedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
