using Odip.Domain.Enums;

namespace Odip.Application.Interfaces;

/// <summary>
/// One rule's worth of obligation-task creation input for
/// <see cref="IObligationTaskService.EnsureAsync"/> — see that method's remarks for the
/// idempotency/update contract.
/// </summary>
public record ObligationTaskSpec(
    string SourceKey,
    TaskType Type,
    string Title,
    DateOnly? DueDate,
    string? LinkTo,
    Guid? ShiftId = null,
    Guid? IncidentReportId = null,
    Guid? MedicationAdministrationId = null,
    Guid? ShiftNoteId = null,
    Guid? LeaveRequestId = null,
    Guid? TripInstanceId = null,
    TaskPriority Priority = TaskPriority.Medium);

/// <summary>
/// Generic obligation-task engine (item 9 of the connection map): raises a <c>BookingTask</c>
/// automatically from a domain event (leave approved, incident QSC-reportable, medication witness
/// pending, flagged shift note) and auto-completes it when the obligation is met. Takes the
/// caller's own tracked <c>OdipDbContext</c> — like <see cref="INotificationRaiser"/>, it never
/// calls <c>SaveChangesAsync</c> itself, so the caller's own existing save commits the task
/// row(s) atomically with the domain write that triggered them.
/// </summary>
public interface IObligationTaskService
{
    /// <summary>
    /// Idempotent on <see cref="ObligationTaskSpec.SourceKey"/>: creates a new NotStarted task
    /// when no row with that SourceKey exists. When one exists and is NotStarted or InProgress,
    /// only Title/DueDate are refreshed (Status/Priority/links are left as-is — a coordinator may
    /// have already started working the task). When the existing row is Completed or Cancelled,
    /// it is left untouched — a closed obligation task never reopens itself.
    /// </summary>
    Task EnsureAsync(ObligationTaskSpec spec, CancellationToken ct = default);

    /// <summary>Completes the single task matching this exact SourceKey, if it exists and is NotStarted/InProgress. No-op if absent or already Completed/Cancelled.</summary>
    Task CompleteAsync(string sourceKey, CancellationToken ct = default);

    /// <summary>Completes every NotStarted/InProgress task of the given type linked to this ShiftId — used where the caller does not have (or does not want to reconstruct) the exact SourceKey, e.g. LeaveCoverage tasks keyed by shift+leave when only the shift is in hand.</summary>
    Task CompleteByShiftAsync(Guid shiftId, TaskType type, CancellationToken ct = default);

    /// <summary>Completes every NotStarted/InProgress LeaveCoverage task linked to this LeaveRequestId — used when the leave itself is cancelled, regardless of which shifts it covers.</summary>
    Task CompleteByLeaveAsync(Guid leaveId, CancellationToken ct = default);
}
