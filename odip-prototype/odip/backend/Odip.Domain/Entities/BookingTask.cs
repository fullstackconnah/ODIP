using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;

namespace Odip.Domain.Entities;

/// <summary>
/// Actions and follow-ups linked to a trip or booking, OR raised automatically as a generic
/// obligation by <see cref="Odip.Application.Interfaces.IObligationTaskService"/> against a
/// Shift/IncidentReport/MedicationAdministration/ShiftNote/LeaveRequest (item 9 of the connection
/// map — tasks as the generic obligation engine). <see cref="TripInstanceId"/> is optional so a
/// generic obligation task never needs a trip: every reader that projects
/// <see cref="TripInstance"/> must be null-safe, and a null-trip task must still appear in the
/// tasks list / dashboard overdue count exactly like a trip-linked one.
///
/// Tenant-scoped (<see cref="ITenantEntity"/>) so a task with no TripInstance to inherit scoping
/// from is still hidden from other tenants — TenantId is auto-stamped by
/// <see cref="Odip.Infrastructure.Data.OdipDbContext.SaveChangesAsync"/> on insert, the same
/// mechanism every other tenant-scoped entity relies on.
/// </summary>
public class BookingTask : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid? TripInstanceId { get; set; }
    public TripInstance? TripInstance { get; set; }
    public Guid? ParticipantBookingId { get; set; }
    public ParticipantBooking? ParticipantBooking { get; set; }
    public Guid? AccommodationReservationId { get; set; }
    public AccommodationReservation? AccommodationReservation { get; set; }
    public Guid? VehicleAssignmentId { get; set; }
    public VehicleAssignment? VehicleAssignment { get; set; }
    public Guid? StaffAssignmentId { get; set; }
    public StaffAssignment? StaffAssignment { get; set; }

    // Generic obligation source links (item 9). All optional — set only by
    // IObligationTaskService, never by the manual CreateTaskDto/UpdateTaskDto path.
    public Guid? ShiftId { get; set; }
    public Shift? Shift { get; set; }
    public Guid? IncidentReportId { get; set; }
    public IncidentReport? IncidentReport { get; set; }
    public Guid? MedicationAdministrationId { get; set; }
    public MedicationAdministration? MedicationAdministration { get; set; }
    public Guid? ShiftNoteId { get; set; }
    public ShiftNote? ShiftNote { get; set; }
    public Guid? LeaveRequestId { get; set; }
    public LeaveRequest? LeaveRequest { get; set; }

    /// <summary>Frontend deep link for a generic obligation task, e.g. "/rostering?date=2026-09-14". Null for manually-created trip/booking tasks.</summary>
    public string? LinkTo { get; set; }

    /// <summary>
    /// Idempotency key for <see cref="Odip.Application.Interfaces.IObligationTaskService.EnsureAsync"/>
    /// — e.g. "leave-coverage:{shiftId}:{leaveId}". Unique where not null. Null for manually-created
    /// trip/booking tasks, which have no obligation to be idempotent against.
    /// </summary>
    public string? SourceKey { get; set; }

    public TaskType TaskType { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? OwnerId { get; set; }
    public User? Owner { get; set; }
    public TaskPriority Priority { get; set; } = TaskPriority.Medium;
    public DateOnly? DueDate { get; set; }
    public TaskItemStatus Status { get; set; } = TaskItemStatus.NotStarted;
    public DateOnly? CompletedDate { get; set; }

    /// <summary>Stamped by IObligationTaskService.CompleteAsync alongside CompletedDate — distinguishes a system auto-completion from a coordinator manually marking a task Completed via TasksController.Update.</summary>
    public DateTime? AutoCompletedAt { get; set; }

    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
