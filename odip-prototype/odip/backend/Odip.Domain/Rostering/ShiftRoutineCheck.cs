using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>
/// A routine the worker ticked off during a shift ("done"), recorded against the shift's ACTIVE <see cref="ShiftCompletion"/> (so a Return,
/// which archives the completion, archives its ticks with it - the resubmitting worker starts the checklist afresh, like the breaks).
/// Until now a tick was only local state in the browser: nothing was kept for the coordinator and a reload lost it.
///
/// A routine has at most ONE occurrence in a shift window, so a tick is identified by (completion, routine): that is how the package and the
/// review find it, and it stays found when the routine's time or days are edited afterwards (matching on the recomputed occurrence time made an
/// edit hide the tick, and ticking again create a second row). <see cref="ScheduledAt"/> and <see cref="RoutineTitle"/> are a SNAPSHOT of what was
/// ticked: the provider-local time of the occurrence the routine matched in the shift window (<see cref="RoutineOccurrence.OccursAtLocal"/>, or NULL
/// for an untimed routine) and the routine's title at that moment. They let the coordinator's review list a tick whose routine was LATER edited out of
/// the window, retired or deleted, as it was when the worker ticked it. Uniqueness backs the same-occurrence double tap with two partial unique
/// indexes (timed: WHERE ScheduledAt IS NOT NULL; untimed: WHERE ScheduledAt IS NULL, because a plain unique index treats NULLs as distinct) - see
/// <see cref="UniqueTimedIndexName"/> and <see cref="UniqueUntimedIndexName"/>. Ticking again is an idempotent no-op that keeps the original who and
/// when; unticking removes the row (the delete is audited, like every change to this entity).
///
/// The routine, the completion and the worker are all Restrict: a tick is history. The routine endpoints retire a routine (IsActive = false) instead of
/// deleting it, so its ticks survive on every past completion.
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

    /// <summary>Provider-local wall-clock start of the occurrence this tick is for (Kind Unspecified); null for an untimed routine. A snapshot.</summary>
    public DateTime? ScheduledAt { get; set; }

    /// <summary>The routine's title when it was ticked (a snapshot, so the review can still say what was ticked after the routine is renamed or retired).
    /// Nullable: it was added after the table, and a tick without it falls back to the routine's current title.</summary>
    public string? RoutineTitle { get; set; }

    /// <summary>The worker who ticked it - the shift's own worker.</summary>
    public Guid CheckedByUserId { get; set; }
    public User? CheckedByUser { get; set; }

    /// <summary>UTC. Server-stamped.</summary>
    public DateTime CheckedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
