using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Api.Rostering;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Tasks;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/tasks")]
public class TasksController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public TasksController(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>
    /// §4.4 same-tenant validation for the task-owner picker: null is always fine, otherwise the
    /// id must resolve to an active User — same-tenant scoping comes for free from _db.Users'
    /// ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidOwnerRefAsync(Guid? ownerId, CancellationToken ct) =>
        ownerId.HasValue
            ? _db.Users.AnyAsync(u => u.Id == ownerId.Value && u.IsActive, ct)
            : Task.FromResult(true);

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<TaskDto>>>> GetAll(
        [FromQuery] Guid? tripId, [FromQuery] TaskItemStatus? status,
        [FromQuery] bool? dueThisWeek, [FromQuery] Guid? ownerId, CancellationToken ct)
    {
        var query = _db.BookingTasks.Include(t => t.TripInstance).Include(t => t.Owner).AsQueryable();
        // The Admin's review of an emergency over budget names a participant whose budget is spent: only the roles that see budget standing elsewhere see it (the phase 3 review, C7).
        if (!BudgetReviewAudience.MaySee(User)) query = query.Where(t => t.TaskType != TaskType.BudgetEmergencyReview);
        if (tripId.HasValue) query = query.Where(t => t.TripInstanceId == tripId.Value);
        if (status == TaskItemStatus.Overdue)
        {
            // "Overdue" is not only the stored status (nothing writes it): it is the rule the dashboard's Overdue figure counts, judged
            // on the provider's today, so the tile's number and this filter's rows are the same tasks (L3-03).
            query = query.Where(TaskOverdue.IsOverdueExpr(await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct)));
        }
        else if (status.HasValue) query = query.Where(t => t.Status == status.Value);
        if (ownerId.HasValue) query = query.Where(t => t.OwnerId == ownerId.Value);
        if (dueThisWeek == true)
        {
            var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
            var weekEnd = today.AddDays(7);
            query = query.Where(t => t.DueDate != null && t.DueDate >= today && t.DueDate <= weekEnd);
        }

        var items = await query.OrderBy(t => t.DueDate).ThenByDescending(t => t.Priority)
            .Select(t => new TaskDto
            {
                Id = t.Id, TripInstanceId = t.TripInstanceId, TripName = t.TripInstance != null ? t.TripInstance.TripName : null,
                ParticipantBookingId = t.ParticipantBookingId, AccommodationReservationId = t.AccommodationReservationId,
                VehicleAssignmentId = t.VehicleAssignmentId, StaffAssignmentId = t.StaffAssignmentId,
                LinkTo = t.LinkTo, SourceKey = t.SourceKey, ShiftId = t.ShiftId, IncidentReportId = t.IncidentReportId,
                MedicationAdministrationId = t.MedicationAdministrationId, ShiftNoteId = t.ShiftNoteId, LeaveRequestId = t.LeaveRequestId,
                TaskType = t.TaskType, Title = t.Title, OwnerId = t.OwnerId,
                OwnerName = t.Owner != null ? t.Owner.FirstName + " " + t.Owner.LastName : null,
                Priority = t.Priority, DueDate = t.DueDate, Status = t.Status,
                CompletedDate = t.CompletedDate, Notes = t.Notes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<TaskDto>>.Ok(items));
    }

    /// <summary>
    /// PP-10/PP-11: dedicated single-task fetch for the edit page — previously the frontend
    /// fetched the whole `GetAll` list and `.find`'d the id client-side, which silently fell back
    /// to create-mode defaults on any error/not-found. Same shape and tenant scoping (via the
    /// ambient OdipDbContext query filter) as GetAll.
    /// </summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<TaskDto>>> GetById(Guid id, CancellationToken ct)
    {
        var t = await _db.BookingTasks.Include(x => x.TripInstance).Include(x => x.Owner)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t == null || (t.TaskType == TaskType.BudgetEmergencyReview && !BudgetReviewAudience.MaySee(User))) return NotFound(ApiResponse<TaskDto>.Fail("Task not found"));

        return Ok(ApiResponse<TaskDto>.Ok(new TaskDto
        {
            Id = t.Id, TripInstanceId = t.TripInstanceId, TripName = t.TripInstance?.TripName,
            ParticipantBookingId = t.ParticipantBookingId, AccommodationReservationId = t.AccommodationReservationId,
            VehicleAssignmentId = t.VehicleAssignmentId, StaffAssignmentId = t.StaffAssignmentId,
            LinkTo = t.LinkTo, SourceKey = t.SourceKey, ShiftId = t.ShiftId, IncidentReportId = t.IncidentReportId,
            MedicationAdministrationId = t.MedicationAdministrationId, ShiftNoteId = t.ShiftNoteId, LeaveRequestId = t.LeaveRequestId,
            TaskType = t.TaskType, Title = t.Title, OwnerId = t.OwnerId,
            OwnerName = t.Owner != null ? t.Owner.FirstName + " " + t.Owner.LastName : null,
            Priority = t.Priority, DueDate = t.DueDate, Status = t.Status,
            CompletedDate = t.CompletedDate, Notes = t.Notes
        }));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<TaskDto>>> Create([FromBody] CreateTaskDto dto, CancellationToken ct)
    {
        // Only the server raises the review of an emergency (with the shift): nobody but an Admin can make one by hand.
        if (dto.TaskType == TaskType.BudgetEmergencyReview && !BudgetReviewAudience.MayAct(User)) return Forbid();

        if (!await IsValidOwnerRefAsync(dto.OwnerId, ct))
            return BadRequest(ApiResponse<TaskDto>.Fail("Task owner not found."));

        var task = new BookingTask
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId,
            ParticipantBookingId = dto.ParticipantBookingId, AccommodationReservationId = dto.AccommodationReservationId,
            VehicleAssignmentId = dto.VehicleAssignmentId, StaffAssignmentId = dto.StaffAssignmentId,
            TaskType = dto.TaskType, Title = dto.Title, OwnerId = dto.OwnerId,
            Priority = dto.Priority, DueDate = dto.DueDate, Notes = dto.Notes
        };
        _db.BookingTasks.Add(task);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(task).Reference(t => t.TripInstance).LoadAsync(ct);
        if (task.OwnerId.HasValue) await _db.Entry(task).Reference(t => t.Owner).LoadAsync(ct);
        return Ok(ApiResponse<TaskDto>.Ok(new TaskDto
        {
            Id = task.Id, TripInstanceId = task.TripInstanceId, TripName = task.TripInstance?.TripName,
            ParticipantBookingId = task.ParticipantBookingId, AccommodationReservationId = task.AccommodationReservationId,
            VehicleAssignmentId = task.VehicleAssignmentId, StaffAssignmentId = task.StaffAssignmentId,
            LinkTo = task.LinkTo, SourceKey = task.SourceKey, ShiftId = task.ShiftId, IncidentReportId = task.IncidentReportId,
            MedicationAdministrationId = task.MedicationAdministrationId, ShiftNoteId = task.ShiftNoteId, LeaveRequestId = task.LeaveRequestId,
            TaskType = task.TaskType, Title = task.Title, OwnerId = task.OwnerId,
            OwnerName = task.Owner != null ? task.Owner.FirstName + " " + task.Owner.LastName : null,
            Priority = task.Priority, DueDate = task.DueDate, Status = task.Status,
            CompletedDate = task.CompletedDate, Notes = task.Notes
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<TaskDto>>> Update(Guid id, [FromBody] UpdateTaskDto dto, CancellationToken ct)
    {
        var t = await _db.BookingTasks.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t == null) return NotFound(ApiResponse<TaskDto>.Fail("Task not found"));

        // The review of an emergency booking over budget is an Admin's: complete, cancel, delete or retype it only as an Admin or SuperAdmin, and neither retype it away nor retype another task into it (C2).
        var isReview = t.TaskType == TaskType.BudgetEmergencyReview || dto.TaskType == TaskType.BudgetEmergencyReview;
        if (isReview && !BudgetReviewAudience.MayAct(User)) return Forbid();

        // Whoever completes the review owns it, unless the request names an owner: that is how the shift panel can say who reviewed the emergency.
        var ownerId = dto.OwnerId;
        if (t.TaskType == TaskType.BudgetEmergencyReview && ownerId == null && dto.Status == TaskItemStatus.Completed && t.Status != TaskItemStatus.Completed
            && Guid.TryParse(User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var reviewer))
            ownerId = reviewer;

        if (!await IsValidOwnerRefAsync(ownerId, ct))
            return BadRequest(ApiResponse<TaskDto>.Fail("Task owner not found."));

        t.TaskType = dto.TaskType; t.Title = dto.Title; t.OwnerId = ownerId;
        t.Priority = dto.Priority; t.DueDate = dto.DueDate; t.Status = dto.Status;
        t.CompletedDate = dto.CompletedDate; t.Notes = dto.Notes; t.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _db.Entry(t).Reference(x => x.TripInstance).LoadAsync(ct);
        if (t.OwnerId.HasValue) await _db.Entry(t).Reference(x => x.Owner).LoadAsync(ct);
        return Ok(ApiResponse<TaskDto>.Ok(new TaskDto
        {
            Id = t.Id, TripInstanceId = t.TripInstanceId, TripName = t.TripInstance?.TripName,
            ParticipantBookingId = t.ParticipantBookingId, AccommodationReservationId = t.AccommodationReservationId,
            VehicleAssignmentId = t.VehicleAssignmentId, StaffAssignmentId = t.StaffAssignmentId,
            LinkTo = t.LinkTo, SourceKey = t.SourceKey, ShiftId = t.ShiftId, IncidentReportId = t.IncidentReportId,
            MedicationAdministrationId = t.MedicationAdministrationId, ShiftNoteId = t.ShiftNoteId, LeaveRequestId = t.LeaveRequestId,
            TaskType = t.TaskType, Title = t.Title, OwnerId = t.OwnerId,
            OwnerName = t.Owner != null ? t.Owner.FirstName + " " + t.Owner.LastName : null,
            Priority = t.Priority, DueDate = t.DueDate, Status = t.Status,
            CompletedDate = t.CompletedDate, Notes = t.Notes
        }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var t = await _db.BookingTasks.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t == null) return NotFound(ApiResponse<bool>.Fail("Task not found"));
        if (t.TaskType == TaskType.BudgetEmergencyReview && !BudgetReviewAudience.MayAct(User)) return Forbid();
        t.Status = TaskItemStatus.Cancelled; t.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/activities")]
public class ActivitiesController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ActivitiesController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ActivityDto>>>> GetAll(CancellationToken ct)
    {
        var items = await _db.Activities.OrderBy(a => a.ActivityName)
            .Select(a => new ActivityDto
            {
                Id = a.Id, EventTemplateId = a.EventTemplateId, ActivityName = a.ActivityName,
                Category = a.Category, Location = a.Location, AccessibilityNotes = a.AccessibilityNotes,
                SuitabilityNotes = a.SuitabilityNotes, Notes = a.Notes, IsActive = a.IsActive
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<ActivityDto>>.Ok(items));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ActivityDto>>> Create([FromBody] CreateActivityDto dto, CancellationToken ct)
    {
        var a = new Activity
        {
            Id = Guid.NewGuid(), EventTemplateId = dto.EventTemplateId, ActivityName = dto.ActivityName,
            Category = dto.Category, Location = dto.Location, AccessibilityNotes = dto.AccessibilityNotes,
            SuitabilityNotes = dto.SuitabilityNotes, Notes = dto.Notes, IsActive = dto.IsActive
        };
        _db.Activities.Add(a);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ActivityDto>.Ok(new ActivityDto { Id = a.Id, ActivityName = a.ActivityName }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ActivityDto>>> Update(Guid id, [FromBody] UpdateActivityDto dto, CancellationToken ct)
    {
        var a = await _db.Activities.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<ActivityDto>.Fail("Activity not found"));

        a.EventTemplateId = dto.EventTemplateId; a.ActivityName = dto.ActivityName;
        a.Category = dto.Category; a.Location = dto.Location;
        a.AccessibilityNotes = dto.AccessibilityNotes; a.SuitabilityNotes = dto.SuitabilityNotes;
        a.Notes = dto.Notes; a.IsActive = dto.IsActive; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ActivityDto>.Ok(new ActivityDto { Id = a.Id, ActivityName = a.ActivityName }));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/event-templates")]
public class EventTemplatesController : ControllerBase
{
    private readonly OdipDbContext _db;
    public EventTemplatesController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<EventTemplateDto>>>> GetAll(CancellationToken ct)
    {
        var items = await _db.EventTemplates.Where(e => e.IsActive).OrderBy(e => e.EventName)
            .Select(e => new EventTemplateDto
            {
                Id = e.Id, EventCode = e.EventCode, EventName = e.EventName,
                DefaultDestination = e.DefaultDestination, DefaultRegion = e.DefaultRegion,
                PreferredTimeOfYear = e.PreferredTimeOfYear, StandardDurationDays = e.StandardDurationDays,
                AccessibilityNotes = e.AccessibilityNotes,
                FullyModifiedAccommodationNotes = e.FullyModifiedAccommodationNotes,
                SemiModifiedAccommodationNotes = e.SemiModifiedAccommodationNotes,
                WheelchairAccessNotes = e.WheelchairAccessNotes, TypicalActivities = e.TypicalActivities,
                IsActive = e.IsActive
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<EventTemplateDto>>.Ok(items));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<EventTemplateDto>>> Create([FromBody] CreateEventTemplateDto dto, CancellationToken ct)
    {
        var e = new EventTemplate
        {
            Id = Guid.NewGuid(), EventCode = dto.EventCode, EventName = dto.EventName,
            DefaultDestination = dto.DefaultDestination, DefaultRegion = dto.DefaultRegion,
            PreferredTimeOfYear = dto.PreferredTimeOfYear, StandardDurationDays = dto.StandardDurationDays,
            AccessibilityNotes = dto.AccessibilityNotes,
            FullyModifiedAccommodationNotes = dto.FullyModifiedAccommodationNotes,
            SemiModifiedAccommodationNotes = dto.SemiModifiedAccommodationNotes,
            WheelchairAccessNotes = dto.WheelchairAccessNotes, TypicalActivities = dto.TypicalActivities,
            IsActive = dto.IsActive
        };
        _db.EventTemplates.Add(e);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<EventTemplateDto>.Ok(new EventTemplateDto { Id = e.Id, EventName = e.EventName }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<EventTemplateDto>>> Update(Guid id, [FromBody] UpdateEventTemplateDto dto, CancellationToken ct)
    {
        var e = await _db.EventTemplates.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e == null) return NotFound(ApiResponse<EventTemplateDto>.Fail("Template not found"));

        e.EventCode = dto.EventCode; e.EventName = dto.EventName; e.DefaultDestination = dto.DefaultDestination;
        e.DefaultRegion = dto.DefaultRegion; e.PreferredTimeOfYear = dto.PreferredTimeOfYear;
        e.StandardDurationDays = dto.StandardDurationDays; e.AccessibilityNotes = dto.AccessibilityNotes;
        e.FullyModifiedAccommodationNotes = dto.FullyModifiedAccommodationNotes;
        e.SemiModifiedAccommodationNotes = dto.SemiModifiedAccommodationNotes;
        e.WheelchairAccessNotes = dto.WheelchairAccessNotes; e.TypicalActivities = dto.TypicalActivities;
        e.IsActive = dto.IsActive; e.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<EventTemplateDto>.Ok(new EventTemplateDto { Id = e.Id, EventName = e.EventName }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult> Deactivate(Guid id, CancellationToken ct)
    {
        var e = await _db.EventTemplates.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e == null) return NotFound(ApiResponse<bool>.Fail("Template not found"));
        e.IsActive = false;
        e.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}

[ApiController]
[Authorize]
[Route("api/v1")]
public class TripDayScheduleController : ControllerBase
{
    private readonly OdipDbContext _db;
    public TripDayScheduleController(OdipDbContext db) => _db = db;

    /// <summary>TripDay and ScheduledActivity have no organisation column or query filter: an activity is the caller's only if its day's trip is (TripInstances is tenant-filtered).</summary>
    private IQueryable<ScheduledActivity> TenantActivities() =>
        _db.ScheduledActivities.Where(s => _db.TripDays.Any(d => d.Id == s.TripDayId && _db.TripInstances.Any(t => t.Id == d.TripInstanceId)));

    [HttpPut("trip-days/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<TripDayDto>>> UpdateTripDay(Guid id, [FromBody] UpdateTripDayDto dto, CancellationToken ct)
    {
        var d = await _db.TripDays.FirstOrDefaultAsync(x => x.Id == id && _db.TripInstances.Any(t => t.Id == x.TripInstanceId), ct);
        if (d == null) return NotFound(ApiResponse<TripDayDto>.Fail("Trip day not found"));
        d.DayTitle = dto.DayTitle; d.DayNotes = dto.DayNotes; d.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<TripDayDto>.Ok(new TripDayDto { Id = d.Id, DayTitle = d.DayTitle }));
    }

    [HttpPost("trip-days/{id:guid}/activities")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ScheduledActivityDto>>> AddActivity(Guid id, [FromBody] CreateScheduledActivityDto dto, CancellationToken ct)
    {
        if (!await _db.TripDays.AnyAsync(d => d.Id == id && _db.TripInstances.Any(t => t.Id == d.TripInstanceId), ct))
            return NotFound(ApiResponse<ScheduledActivityDto>.Fail("Trip day not found"));

        var a = new ScheduledActivity
        {
            Id = Guid.NewGuid(), TripDayId = id, ActivityId = dto.ActivityId,
            Title = dto.Title, StartTime = dto.StartTime, EndTime = dto.EndTime,
            Location = dto.Location, AccessibilityNotes = dto.AccessibilityNotes,
            Notes = dto.Notes, SortOrder = dto.SortOrder,
            Status = dto.Status, BookingReference = dto.BookingReference,
            ProviderName = dto.ProviderName, ProviderPhone = dto.ProviderPhone,
            ProviderEmail = dto.ProviderEmail, ProviderWebsite = dto.ProviderWebsite,
            EstimatedCost = dto.EstimatedCost
        };
        _db.ScheduledActivities.Add(a);
        await _db.SaveChangesAsync(ct);
        if (a.ActivityId.HasValue) await _db.Entry(a).Reference(e => e.Activity).LoadAsync(ct);
        return Ok(ApiResponse<ScheduledActivityDto>.Ok(new ScheduledActivityDto
        {
            Id = a.Id, TripDayId = a.TripDayId, ActivityId = a.ActivityId,
            Title = a.Title, StartTime = a.StartTime, EndTime = a.EndTime,
            Location = a.Location, AccessibilityNotes = a.AccessibilityNotes,
            Notes = a.Notes, SortOrder = a.SortOrder,
            Status = a.Status, BookingReference = a.BookingReference,
            ProviderName = a.ProviderName, ProviderPhone = a.ProviderPhone,
            ProviderEmail = a.ProviderEmail, ProviderWebsite = a.ProviderWebsite,
            EstimatedCost = a.EstimatedCost, Category = a.Activity?.Category
        }));
    }

    [HttpPut("scheduled-activities/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ScheduledActivityDto>>> UpdateActivity(Guid id, [FromBody] UpdateScheduledActivityDto dto, CancellationToken ct)
    {
        var a = await TenantActivities().Include(s => s.Activity).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<ScheduledActivityDto>.Fail("Activity not found"));

        a.ActivityId = dto.ActivityId; a.Title = dto.Title; a.StartTime = dto.StartTime;
        a.EndTime = dto.EndTime; a.Location = dto.Location; a.AccessibilityNotes = dto.AccessibilityNotes;
        a.Notes = dto.Notes; a.SortOrder = dto.SortOrder; a.UpdatedAt = DateTime.UtcNow;
        a.Status = dto.Status; a.BookingReference = dto.BookingReference;
        a.ProviderName = dto.ProviderName; a.ProviderPhone = dto.ProviderPhone;
        a.ProviderEmail = dto.ProviderEmail; a.ProviderWebsite = dto.ProviderWebsite;
        a.EstimatedCost = dto.EstimatedCost;

        await _db.SaveChangesAsync(ct);
        if (a.ActivityId.HasValue) await _db.Entry(a).Reference(e => e.Activity).LoadAsync(ct);
        return Ok(ApiResponse<ScheduledActivityDto>.Ok(new ScheduledActivityDto
        {
            Id = a.Id, TripDayId = a.TripDayId, ActivityId = a.ActivityId,
            Title = a.Title, StartTime = a.StartTime, EndTime = a.EndTime,
            Location = a.Location, AccessibilityNotes = a.AccessibilityNotes,
            Notes = a.Notes, SortOrder = a.SortOrder,
            Status = a.Status, BookingReference = a.BookingReference,
            ProviderName = a.ProviderName, ProviderPhone = a.ProviderPhone,
            ProviderEmail = a.ProviderEmail, ProviderWebsite = a.ProviderWebsite,
            EstimatedCost = a.EstimatedCost, Category = a.Activity?.Category
        }));
    }

    [HttpDelete("scheduled-activities/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteActivity(Guid id, CancellationToken ct)
    {
        var a = await TenantActivities().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<bool>.Fail("Activity not found"));
        _db.ScheduledActivities.Remove(a);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/dashboard")]
public class DashboardController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public DashboardController(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    [HttpGet("summary")]
    public async Task<ActionResult<ApiResponse<DashboardSummaryDto>>> GetSummary(CancellationToken ct)
    {
        // "Today" is the provider's calendar date, not the UTC date (which is still yesterday until 10:00 or 11:00 in Sydney), so an
        // overdue task or a trip that started yesterday is judged from the provider's midnight.
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var sixtyDays = today.AddDays(60);

        var activeStatuses = new[] { TripStatus.Draft, TripStatus.Planning, TripStatus.OpenForBookings, TripStatus.WaitlistOnly, TripStatus.Confirmed, TripStatus.InProgress };

        var upcomingTrips = await _db.TripInstances
            .Include(t => t.LeadCoordinator).Include(t => t.Bookings)
            .Where(t => activeStatuses.Contains(t.Status) && t.StartDate >= today && t.StartDate <= sixtyDays)
            .OrderBy(t => t.StartDate)
            .Select(t => new TripListDto
            {
                Id = t.Id, TripName = t.TripName, TripCode = t.TripCode, Destination = t.Destination,
                Region = t.Region, StartDate = t.StartDate, EndDate = t.StartDate.AddDays(t.DurationDays - 1),
                DurationDays = t.DurationDays, Status = t.Status, MaxParticipants = t.MaxParticipants,
                CurrentParticipantCount = t.Bookings.Count(b => b.BookingStatus == BookingStatus.Confirmed),
                WaitlistCount = t.Bookings.Count(b => b.BookingStatus == BookingStatus.Waitlist),
                LeadCoordinatorName = t.LeadCoordinator != null ? t.LeadCoordinator.FirstName + " " + t.LeadCoordinator.LastName : null
            }).ToListAsync(ct);

        // The Admin's review of an emergency over budget is left out for a role that may not see budget standing, in the list and in the counts (the phase 3 review, C7).
        var mayReview = BudgetReviewAudience.MaySee(User);
        var overdueTasks = await _db.BookingTasks.Include(t => t.TripInstance).Include(t => t.Owner)
            .Where(TaskOverdue.IsOverdueExpr(today))
            .Where(t => mayReview || t.TaskType != TaskType.BudgetEmergencyReview)
            .Select(t => new TaskDto
            {
                Id = t.Id, TripInstanceId = t.TripInstanceId, TripName = t.TripInstance != null ? t.TripInstance.TripName : null,
                LinkTo = t.LinkTo, SourceKey = t.SourceKey, ShiftId = t.ShiftId, IncidentReportId = t.IncidentReportId,
                MedicationAdministrationId = t.MedicationAdministrationId, ShiftNoteId = t.ShiftNoteId, LeaveRequestId = t.LeaveRequestId,
                TaskType = t.TaskType, Title = t.Title, OwnerId = t.OwnerId,
                OwnerName = t.Owner != null ? t.Owner.FirstName + " " + t.Owner.LastName : null,
                Priority = t.Priority, DueDate = t.DueDate, Status = t.Status
            }).ToListAsync(ct);

        var upcomingTripIds = upcomingTrips.Select(t => t.Id).ToList();

        var tripsWithAccommodation = await _db.AccommodationReservations
            .Where(r => upcomingTripIds.Contains(r.TripInstanceId) && r.ReservationStatus != ReservationStatus.Cancelled)
            .Select(r => r.TripInstanceId).Distinct().ToListAsync(ct);

        var tripsWithVehicles = await _db.VehicleAssignments
            .Where(v => upcomingTripIds.Contains(v.TripInstanceId) && v.Status != VehicleAssignmentStatus.Cancelled)
            .Select(v => v.TripInstanceId).Distinct().ToListAsync(ct);

        var tripsWithStaff = await _db.StaffAssignments
            .Where(s => upcomingTripIds.Contains(s.TripInstanceId) && s.Status != AssignmentStatus.Cancelled)
            .Select(s => s.TripInstanceId).Distinct().ToListAsync(ct);

        var conflictCount = await _db.AccommodationReservations.CountAsync(r => r.HasOverlapConflict, ct)
            + await _db.VehicleAssignments.CountAsync(v => v.HasOverlapConflict, ct)
            + await _db.StaffAssignments.CountAsync(s => s.HasConflict, ct);

        var openIncidentCount = await _db.IncidentReports.CountAsync(
            i => i.IsActive && i.Status != IncidentStatus.Closed && i.Status != IncidentStatus.Resolved, ct);

        var qscOverdueCount = await _db.IncidentReports.CountAsync(QscReporting.IsOverdueExpr(_clock.GetUtcNow().UtcDateTime), ct);

        return Ok(ApiResponse<DashboardSummaryDto>.Ok(new DashboardSummaryDto
        {
            UpcomingTripCount = upcomingTrips.Count,
            ActiveParticipantCount = await _db.Participants.CountAsync(p => p.IsActive, ct),
            OutstandingTaskCount = await _db.BookingTasks.CountAsync(t => (mayReview || t.TaskType != TaskType.BudgetEmergencyReview) && t.Status != TaskItemStatus.Completed && t.Status != TaskItemStatus.Cancelled, ct),
            OverdueTaskCount = overdueTasks.Count,
            ConflictCount = conflictCount,
            TripsMissingAccommodation = upcomingTripIds.Count - tripsWithAccommodation.Count,
            TripsMissingVehicles = upcomingTripIds.Count - tripsWithVehicles.Count,
            TripsMissingStaff = upcomingTripIds.Count - tripsWithStaff.Count,
            OpenIncidentCount = openIncidentCount,
            QscOverdueCount = qscOverdueCount,
            UpcomingTrips = upcomingTrips,
            OverdueTasks = overdueTasks
        }));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/conflicts")]
public class ConflictsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ConflictsController(OdipDbContext db) => _db = db;

    /// <summary>Recheck all conflicts across accommodation, vehicles, and staff.
    /// Staff assignments are no longer re-derived here: HasConflict is normalised to
    /// (OverrideReason != null), the acknowledged-override invariant maintained at write time.</summary>
    [HttpPost("recheck")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<object>>> Recheck(CancellationToken ct)
    {
        int updated = 0;

        // Accommodation conflicts
        // Only the caller's own rows: reservations and staff assignments have no query filter, so each is limited to the caller's trips (TripInstances is tenant-filtered).
        var reservations = await _db.AccommodationReservations
            .Where(r => _db.TripInstances.Any(t => t.Id == r.TripInstanceId))
            .Where(r => r.ReservationStatus != ReservationStatus.Cancelled && r.ReservationStatus != ReservationStatus.Unavailable)
            .ToListAsync(ct);

        foreach (var r in reservations)
        {
            var hasConflict = reservations.Any(other => other.Id != r.Id
                && other.AccommodationPropertyId == r.AccommodationPropertyId
                && other.CheckInDate < r.CheckOutDate && other.CheckOutDate > r.CheckInDate);
            if (r.HasOverlapConflict != hasConflict) { r.HasOverlapConflict = hasConflict; updated++; }
        }

        // Vehicle conflicts
        var vehicleAssignments = await _db.VehicleAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.Status != VehicleAssignmentStatus.Cancelled && a.Status != VehicleAssignmentStatus.Unavailable)
            .ToListAsync(ct);

        foreach (var a in vehicleAssignments)
        {
            var tripEnd = a.TripInstance.StartDate.AddDays(a.TripInstance.DurationDays - 1);
            var hasConflict = vehicleAssignments.Any(other => other.Id != a.Id
                && other.VehicleId == a.VehicleId
                && other.TripInstance.StartDate <= tripEnd
                && other.TripInstance.StartDate.AddDays(other.TripInstance.DurationDays - 1) >= a.TripInstance.StartDate);
            if (a.HasOverlapConflict != hasConflict) { a.HasOverlapConflict = hasConflict; updated++; }
        }

        // Staff conflicts
        var staffAssignments = await _db.StaffAssignments
            .Where(a => _db.TripInstances.Any(t => t.Id == a.TripInstanceId))
            .Where(a => a.Status != AssignmentStatus.Cancelled)
            .ToListAsync(ct);

        foreach (var a in staffAssignments)
        {
            // HasConflict is the persisted acknowledged-override flag, derived at write time by
            // StaffAssignmentsController (RosterGate) — not re-derived here from other
            // assignments/availability, which would clobber that invariant.
            var hasConflict = a.OverrideReason != null;
            if (a.HasConflict != hasConflict) { a.HasConflict = hasConflict; updated++; }
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<object>.Ok(new { UpdatedRecords = updated }));
    }
}
