using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// CRUD and sub-resource operations for trip instances.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/trips")]
public class TripsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ILogger<TripsController> _logger;
    public TripsController(OdipDbContext db, ILogger<TripsController> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// §4.4 same-tenant validation for the lead-coordinator picker: null is always fine,
    /// otherwise the id must resolve to an active User — same-tenant scoping comes for free from
    /// _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidLeadCoordinatorRefAsync(Guid? userId, CancellationToken ct) =>
        userId.HasValue
            ? _db.Users.AnyAsync(u => u.Id == userId.Value && u.IsActive, ct)
            : Task.FromResult(true);

    /// <summary>List trips with optional filters.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<TripListDto>>>> GetAll(
        [FromQuery] TripStatus? status, [FromQuery] string? region, [FromQuery] string? search,
        [FromQuery] DateOnly? startFrom, [FromQuery] DateOnly? startTo,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var query = _db.TripInstances.Include(t => t.LeadCoordinator).Include(t => t.Bookings).AsQueryable();
        if (status.HasValue) query = query.Where(t => t.Status == status.Value);
        if (!string.IsNullOrWhiteSpace(region)) query = query.Where(t => t.Region == region);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(t => t.TripName.Contains(search) || (t.Destination != null && t.Destination.Contains(search)));
        if (startFrom.HasValue) query = query.Where(t => t.StartDate >= startFrom.Value);
        if (startTo.HasValue) query = query.Where(t => t.StartDate <= startTo.Value);

        var projectedQuery = query.OrderByDescending(t => t.StartDate)
            .Select(t => new TripListDto
            {
                Id = t.Id, TripName = t.TripName, TripCode = t.TripCode, Destination = t.Destination,
                Region = t.Region, StartDate = t.StartDate, EndDate = t.StartDate.AddDays(t.DurationDays - 1),
                DurationDays = t.DurationDays, Status = t.Status, MaxParticipants = t.MaxParticipants,
                CurrentParticipantCount = t.Bookings.Count(b => b.BookingStatus == BookingStatus.Confirmed),
                WaitlistCount = t.Bookings.Count(b => b.BookingStatus == BookingStatus.Waitlist),
                LeadCoordinatorName = t.LeadCoordinator != null ? t.LeadCoordinator.FirstName + " " + t.LeadCoordinator.LastName : null
            });

        var result = await PagedResult<TripListDto>.CreateAsync(projectedQuery, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<TripListDto>>.Ok(result));
    }

    /// <summary>Get full trip detail including computed counts.</summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<TripDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var t = await _db.TripInstances
            .Include(x => x.LeadCoordinator).Include(x => x.EventTemplate)
            .Include(x => x.Bookings).Include(x => x.StaffAssignments)
            .Include(x => x.Tasks)
            .FirstOrDefaultAsync(x => x.Id == id, ct);

        if (t == null) return NotFound(ApiResponse<TripDetailDto>.Fail("Trip not found"));

        return Ok(ApiResponse<TripDetailDto>.Ok(new TripDetailDto
        {
            Id = t.Id, TripName = t.TripName, TripCode = t.TripCode, Destination = t.Destination,
            Region = t.Region, StartDate = t.StartDate, EndDate = t.EndDate, DurationDays = t.DurationDays,
            Status = t.Status, MaxParticipants = t.MaxParticipants, MinParticipants = t.MinParticipants,
            EventTemplateId = t.EventTemplateId, EventTemplateName = t.EventTemplate?.EventName,
            OopDueDate = t.OopDueDate, BookingCutoffDate = t.BookingCutoffDate,
            LeadCoordinatorId = t.LeadCoordinatorId,
            LeadCoordinatorName = t.LeadCoordinator != null ? t.LeadCoordinator.FirstName + " " + t.LeadCoordinator.LastName : null,
            RequiredWheelchairCapacity = t.RequiredWheelchairCapacity, RequiredBeds = t.RequiredBeds,
            RequiredBedrooms = t.RequiredBedrooms, MinStaffRequired = t.MinStaffRequired,
            CalculatedStaffRequired = t.CalculatedStaffRequired, Notes = t.Notes,
            ActiveHoursPerDay = t.ActiveHoursPerDay, DepartureTime = t.DepartureTime, ReturnTime = t.ReturnTime,
            CurrentParticipantCount = t.Bookings.Count(b => b.BookingStatus == BookingStatus.Confirmed),
            WaitlistCount = t.Bookings.Count(b => b.BookingStatus == BookingStatus.Waitlist),
            HighSupportCount = t.Bookings.Count(b => b.HighSupportRequired && b.BookingStatus == BookingStatus.Confirmed),
            WheelchairCount = t.Bookings.Count(b => b.WheelchairRequired && b.BookingStatus == BookingStatus.Confirmed),
            OvernightSupportCount = t.Bookings.Count(b => b.NightSupportRequired && b.BookingStatus == BookingStatus.Confirmed),
            StaffAssignedCount = t.StaffAssignments.Count(s => s.Status != AssignmentStatus.Cancelled),
            OutstandingTaskCount = t.Tasks.Count(tk => tk.Status != TaskItemStatus.Completed && tk.Status != TaskItemStatus.Cancelled),
            InsuranceConfirmedCount = t.Bookings.Count(b =>
                b.InsuranceStatus == InsuranceStatus.Confirmed
                && b.BookingStatus != BookingStatus.Cancelled
                && b.BookingStatus != BookingStatus.NoLongerAttending),
            InsuranceOutstandingCount = t.Bookings.Count(b =>
                b.InsuranceStatus != InsuranceStatus.Confirmed
                && b.BookingStatus != BookingStatus.Cancelled
                && b.BookingStatus != BookingStatus.NoLongerAttending),
            CreatedAt = t.CreatedAt, UpdatedAt = t.UpdatedAt
        }));
    }

    /// <summary>Create a new trip instance.</summary>
    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<TripDetailDto>>> Create([FromBody] CreateTripDto dto, CancellationToken ct)
    {
        if (!await IsValidLeadCoordinatorRefAsync(dto.LeadCoordinatorId, ct))
            return BadRequest(ApiResponse<TripDetailDto>.Fail("Lead coordinator not found."));

        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TripName = dto.TripName, TripCode = dto.TripCode,
            EventTemplateId = dto.EventTemplateId, Destination = dto.Destination, Region = dto.Region,
            StartDate = dto.StartDate, DurationDays = dto.DurationDays, BookingCutoffDate = dto.BookingCutoffDate,
            Status = TripStatus.Draft, LeadCoordinatorId = dto.LeadCoordinatorId,
            MinParticipants = dto.MinParticipants, MaxParticipants = dto.MaxParticipants,
            RequiredWheelchairCapacity = dto.RequiredWheelchairCapacity, RequiredBeds = dto.RequiredBeds,
            RequiredBedrooms = dto.RequiredBedrooms, MinStaffRequired = dto.MinStaffRequired, Notes = dto.Notes
        };
        _db.TripInstances.Add(trip);
        await _db.SaveChangesAsync(ct);

        // Re-fetch with the same includes as GetById so the response reflects saved/computed state
        var created = await _db.TripInstances
            .Include(x => x.LeadCoordinator).Include(x => x.EventTemplate)
            .Include(x => x.Bookings).Include(x => x.StaffAssignments)
            .Include(x => x.Tasks)
            .FirstAsync(x => x.Id == trip.Id, ct);

        return CreatedAtAction(nameof(GetById), new { id = trip.Id },
            ApiResponse<TripDetailDto>.Ok(new TripDetailDto
            {
                Id = created.Id, TripName = created.TripName, TripCode = created.TripCode, Destination = created.Destination,
                Region = created.Region, StartDate = created.StartDate, EndDate = created.EndDate, DurationDays = created.DurationDays,
                Status = created.Status, MaxParticipants = created.MaxParticipants, MinParticipants = created.MinParticipants,
                EventTemplateId = created.EventTemplateId, EventTemplateName = created.EventTemplate?.EventName,
                OopDueDate = created.OopDueDate, BookingCutoffDate = created.BookingCutoffDate,
                LeadCoordinatorId = created.LeadCoordinatorId,
                LeadCoordinatorName = created.LeadCoordinator != null ? created.LeadCoordinator.FirstName + " " + created.LeadCoordinator.LastName : null,
                RequiredWheelchairCapacity = created.RequiredWheelchairCapacity, RequiredBeds = created.RequiredBeds,
                RequiredBedrooms = created.RequiredBedrooms, MinStaffRequired = created.MinStaffRequired,
                CalculatedStaffRequired = created.CalculatedStaffRequired, Notes = created.Notes,
                ActiveHoursPerDay = created.ActiveHoursPerDay, DepartureTime = created.DepartureTime, ReturnTime = created.ReturnTime,
                CurrentParticipantCount = created.Bookings.Count(b => b.BookingStatus == BookingStatus.Confirmed),
                WaitlistCount = created.Bookings.Count(b => b.BookingStatus == BookingStatus.Waitlist),
                HighSupportCount = created.Bookings.Count(b => b.HighSupportRequired && b.BookingStatus == BookingStatus.Confirmed),
                WheelchairCount = created.Bookings.Count(b => b.WheelchairRequired && b.BookingStatus == BookingStatus.Confirmed),
                OvernightSupportCount = created.Bookings.Count(b => b.NightSupportRequired && b.BookingStatus == BookingStatus.Confirmed),
                StaffAssignedCount = created.StaffAssignments.Count(s => s.Status != AssignmentStatus.Cancelled),
                OutstandingTaskCount = created.Tasks.Count(tk => tk.Status != TaskItemStatus.Completed && tk.Status != TaskItemStatus.Cancelled),
                InsuranceConfirmedCount = created.Bookings.Count(b =>
                    b.InsuranceStatus == InsuranceStatus.Confirmed
                    && b.BookingStatus != BookingStatus.Cancelled
                    && b.BookingStatus != BookingStatus.NoLongerAttending),
                InsuranceOutstandingCount = created.Bookings.Count(b =>
                    b.InsuranceStatus != InsuranceStatus.Confirmed
                    && b.BookingStatus != BookingStatus.Cancelled
                    && b.BookingStatus != BookingStatus.NoLongerAttending),
                CreatedAt = created.CreatedAt, UpdatedAt = created.UpdatedAt
            }));
    }

    /// <summary>Update a trip instance.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<TripDetailDto>>> Update(Guid id, [FromBody] UpdateTripDto dto, CancellationToken ct)
    {
        var t = await _db.TripInstances.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t == null) return NotFound(ApiResponse<TripDetailDto>.Fail("Trip not found"));

        if (!await IsValidLeadCoordinatorRefAsync(dto.LeadCoordinatorId, ct))
            return BadRequest(ApiResponse<TripDetailDto>.Fail("Lead coordinator not found."));

        t.TripName = dto.TripName; t.TripCode = dto.TripCode; t.EventTemplateId = dto.EventTemplateId;
        t.Destination = dto.Destination; t.Region = dto.Region; t.StartDate = dto.StartDate;
        t.DurationDays = dto.DurationDays; t.BookingCutoffDate = dto.BookingCutoffDate; t.Status = dto.Status;
        t.LeadCoordinatorId = dto.LeadCoordinatorId; t.MinParticipants = dto.MinParticipants;
        t.MaxParticipants = dto.MaxParticipants; t.RequiredWheelchairCapacity = dto.RequiredWheelchairCapacity;
        t.RequiredBeds = dto.RequiredBeds; t.RequiredBedrooms = dto.RequiredBedrooms;
        t.MinStaffRequired = dto.MinStaffRequired; t.Notes = dto.Notes; t.UpdatedAt = DateTime.UtcNow;
        if (dto.DepartureTime.HasValue) t.DepartureTime = dto.DepartureTime;
        if (dto.ReturnTime.HasValue) t.ReturnTime = dto.ReturnTime;

        await _db.SaveChangesAsync(ct);

        // Re-fetch with the same includes as GetById so the response reflects saved/computed state
        var updated = await _db.TripInstances
            .Include(x => x.LeadCoordinator).Include(x => x.EventTemplate)
            .Include(x => x.Bookings).Include(x => x.StaffAssignments)
            .Include(x => x.Tasks)
            .FirstAsync(x => x.Id == id, ct);

        return Ok(ApiResponse<TripDetailDto>.Ok(new TripDetailDto
        {
            Id = updated.Id, TripName = updated.TripName, TripCode = updated.TripCode, Destination = updated.Destination,
            Region = updated.Region, StartDate = updated.StartDate, EndDate = updated.EndDate, DurationDays = updated.DurationDays,
            Status = updated.Status, MaxParticipants = updated.MaxParticipants, MinParticipants = updated.MinParticipants,
            EventTemplateId = updated.EventTemplateId, EventTemplateName = updated.EventTemplate?.EventName,
            OopDueDate = updated.OopDueDate, BookingCutoffDate = updated.BookingCutoffDate,
            LeadCoordinatorId = updated.LeadCoordinatorId,
            LeadCoordinatorName = updated.LeadCoordinator != null ? updated.LeadCoordinator.FirstName + " " + updated.LeadCoordinator.LastName : null,
            RequiredWheelchairCapacity = updated.RequiredWheelchairCapacity, RequiredBeds = updated.RequiredBeds,
            RequiredBedrooms = updated.RequiredBedrooms, MinStaffRequired = updated.MinStaffRequired,
            CalculatedStaffRequired = updated.CalculatedStaffRequired, Notes = updated.Notes,
            ActiveHoursPerDay = updated.ActiveHoursPerDay, DepartureTime = updated.DepartureTime, ReturnTime = updated.ReturnTime,
            CurrentParticipantCount = updated.Bookings.Count(b => b.BookingStatus == BookingStatus.Confirmed),
            WaitlistCount = updated.Bookings.Count(b => b.BookingStatus == BookingStatus.Waitlist),
            HighSupportCount = updated.Bookings.Count(b => b.HighSupportRequired && b.BookingStatus == BookingStatus.Confirmed),
            WheelchairCount = updated.Bookings.Count(b => b.WheelchairRequired && b.BookingStatus == BookingStatus.Confirmed),
            OvernightSupportCount = updated.Bookings.Count(b => b.NightSupportRequired && b.BookingStatus == BookingStatus.Confirmed),
            StaffAssignedCount = updated.StaffAssignments.Count(s => s.Status != AssignmentStatus.Cancelled),
            OutstandingTaskCount = updated.Tasks.Count(tk => tk.Status != TaskItemStatus.Completed && tk.Status != TaskItemStatus.Cancelled),
            InsuranceConfirmedCount = updated.Bookings.Count(b =>
                b.InsuranceStatus == InsuranceStatus.Confirmed
                && b.BookingStatus != BookingStatus.Cancelled
                && b.BookingStatus != BookingStatus.NoLongerAttending),
            InsuranceOutstandingCount = updated.Bookings.Count(b =>
                b.InsuranceStatus != InsuranceStatus.Confirmed
                && b.BookingStatus != BookingStatus.Cancelled
                && b.BookingStatus != BookingStatus.NoLongerAttending),
            CreatedAt = updated.CreatedAt, UpdatedAt = updated.UpdatedAt
        }));
    }

    /// <summary>Partially update a trip (e.g. status only).</summary>
    [HttpPatch("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Patch(Guid id, [FromBody] PatchTripDto dto, CancellationToken ct)
    {
        var t = await _db.TripInstances.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t == null) return NotFound(ApiResponse<bool>.Fail("Trip not found"));

        if (dto.Status.HasValue && dto.Status.Value == TripStatus.InProgress && t.Status != TripStatus.InProgress)
        {
            var gateErrors = new List<string>();

            var hasConfirmedStaff = await _db.StaffAssignments
                .AnyAsync(sa => sa.TripInstanceId == id && sa.Status == AssignmentStatus.Confirmed, ct);
            if (!hasConfirmedStaff)
                gateErrors.Add("at least one confirmed staff assignment is required");

            var hasConfirmedBooking = await _db.ParticipantBookings
                .AnyAsync(pb => pb.TripInstanceId == id && pb.BookingStatus == BookingStatus.Confirmed, ct);
            if (!hasConfirmedBooking)
                gateErrors.Add("at least one confirmed participant booking is required");

            if (gateErrors.Count > 0)
                return BadRequest(ApiResponse<bool>.Fail(
                    $"Pre-departure gate failed: {string.Join("; ", gateErrors)}"));
        }

        // Auto-create GenerateNdisClaims task when trip moves to Completed
        if (dto.Status.HasValue && dto.Status.Value == TripStatus.Completed && t.Status != TripStatus.Completed)
        {
            var hasProviderSettings = await _db.ProviderSettings.AnyAsync(ct);
            var taskTitle = hasProviderSettings
                ? $"Generate NDIS claims for {t.TripName}"
                : $"Generate NDIS claims for {t.TripName} — configure Provider Settings first";

            var alreadyExists = await _db.BookingTasks.AnyAsync(bt =>
                bt.TripInstanceId == id && bt.TaskType == TaskType.GenerateNdisClaims, ct);

            if (!alreadyExists)
            {
                _db.BookingTasks.Add(new BookingTask
                {
                    Id = Guid.NewGuid(),
                    TripInstanceId = id,
                    TaskType = TaskType.GenerateNdisClaims,
                    Title = taskTitle,
                    Priority = TaskPriority.High,
                    Status = TaskItemStatus.NotStarted,
                    DueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(7)),
                    OwnerId = t.LeadCoordinatorId
                });
            }
        }

        if (dto.Status.HasValue) t.Status = dto.Status.Value;
        t.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>Soft-delete (archive) a trip.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var t = await _db.TripInstances.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t == null) return NotFound(ApiResponse<bool>.Fail("Trip not found"));
        t.Status = TripStatus.Archived; t.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Trip archived"));
    }

    /// <summary>Get bookings for a trip.</summary>
    [HttpGet("{id:guid}/bookings")]
    public async Task<ActionResult<ApiResponse<List<BookingListDto>>>> GetBookings(Guid id, CancellationToken ct)
    {
        var bookings = await _db.ParticipantBookings.Include(b => b.Participant)
            .Where(b => b.TripInstanceId == id)
            .Select(b => new BookingListDto
            {
                Id = b.Id, TripInstanceId = b.TripInstanceId, ParticipantId = b.ParticipantId,
                ParticipantName = b.Participant.FirstName + " " + b.Participant.LastName,
                BookingStatus = b.BookingStatus, BookingDate = b.BookingDate,
                WheelchairRequired = b.WheelchairRequired, HighSupportRequired = b.HighSupportRequired,
                NightSupportRequired = b.NightSupportRequired, HasRestrictivePracticeFlag = b.HasRestrictivePracticeFlag,
                SupportRatioOverride = b.SupportRatioOverride, ActionRequired = b.ActionRequired,
                InsuranceStatus = b.InsuranceStatus, PaymentStatus = b.PaymentStatus
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<BookingListDto>>.Ok(bookings));
    }

    /// <summary>Get accommodation reservations for a trip.</summary>
    [HttpGet("{id:guid}/accommodation")]
    public async Task<ActionResult<ApiResponse<List<ReservationDto>>>> GetAccommodation(Guid id, CancellationToken ct)
    {
        var items = await _db.AccommodationReservations.Include(r => r.AccommodationProperty)
            .Where(r => r.TripInstanceId == id)
            .Select(r => new ReservationDto
            {
                Id = r.Id, TripInstanceId = r.TripInstanceId, AccommodationPropertyId = r.AccommodationPropertyId,
                PropertyName = r.AccommodationProperty.PropertyName, CheckInDate = r.CheckInDate,
                CheckOutDate = r.CheckOutDate, ReservationStatus = r.ReservationStatus,
                ConfirmationReference = r.ConfirmationReference, BedroomsReserved = r.BedroomsReserved,
                BedsReserved = r.BedsReserved, Cost = r.Cost, HasOverlapConflict = r.HasOverlapConflict,
                Comments = r.Comments, RequestSentDate = r.RequestSentDate, DateBooked = r.DateBooked,
                DateConfirmed = r.DateConfirmed
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<ReservationDto>>.Ok(items));
    }

    /// <summary>Get vehicle assignments for a trip.</summary>
    [HttpGet("{id:guid}/vehicles")]
    public async Task<ActionResult<ApiResponse<List<VehicleAssignmentDto>>>> GetVehicles(Guid id, CancellationToken ct)
    {
        var items = await _db.VehicleAssignments.Include(v => v.Vehicle).Include(v => v.DriverUser)
            .Where(v => v.TripInstanceId == id)
            .Select(v => new VehicleAssignmentDto
            {
                Id = v.Id, TripInstanceId = v.TripInstanceId, VehicleId = v.VehicleId,
                VehicleName = v.Vehicle.VehicleName, Registration = v.Vehicle.Registration,
                Status = v.Status, RequestedDate = v.RequestedDate, ConfirmedDate = v.ConfirmedDate,
                DriverStaffId = v.DriverUserId, DriverName = v.DriverUser != null ? v.DriverUser.FirstName + " " + v.DriverUser.LastName : null,
                SeatRequirement = v.SeatRequirement, WheelchairPositionRequirement = v.WheelchairPositionRequirement,
                PickupTravelNotes = v.PickupTravelNotes, Comments = v.Comments, HasOverlapConflict = v.HasOverlapConflict,
                HasConflict = v.HasConflict, OverrideReason = v.OverrideReason, AcknowledgedFindingCodes = v.AcknowledgedFindingCodes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<VehicleAssignmentDto>>.Ok(items));
    }

    /// <summary>Get staff assignments for a trip.</summary>
    [HttpGet("{id:guid}/staff")]
    public async Task<ActionResult<ApiResponse<List<StaffAssignmentDto>>>> GetStaff(Guid id, CancellationToken ct)
    {
        var items = await _db.StaffAssignments.Include(s => s.User)
            .Where(s => s.TripInstanceId == id)
            .Select(s => new StaffAssignmentDto
            {
                Id = s.Id, TripInstanceId = s.TripInstanceId, StaffId = s.UserId,
                StaffName = s.User.FirstName + " " + s.User.LastName, AssignmentRole = s.AssignmentRole,
                AssignmentStart = s.AssignmentStart, AssignmentEnd = s.AssignmentEnd,
                Status = s.Status, IsDriver = s.IsDriver, SleepoverType = s.SleepoverType,
                ShiftNotes = s.ShiftNotes, HasConflict = s.HasConflict,
                OverrideReason = s.OverrideReason, AcknowledgedFindingCodes = s.AcknowledgedFindingCodes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffAssignmentDto>>.Ok(items));
    }

    /// <summary>Get tasks for a trip.</summary>
    [HttpGet("{id:guid}/tasks")]
    public async Task<ActionResult<ApiResponse<List<TaskDto>>>> GetTasks(Guid id, CancellationToken ct)
    {
        var items = await _db.BookingTasks.Include(t => t.Owner)
            .Where(t => t.TripInstanceId == id)
            .Select(t => new TaskDto
            {
                Id = t.Id, TripInstanceId = t.TripInstanceId, TaskType = t.TaskType, Title = t.Title,
                OwnerId = t.OwnerId, OwnerName = t.Owner != null ? t.Owner.FirstName + " " + t.Owner.LastName : null,
                Priority = t.Priority, DueDate = t.DueDate, Status = t.Status,
                CompletedDate = t.CompletedDate, Notes = t.Notes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<TaskDto>>.Ok(items));
    }

    /// <summary>Get schedule (trip days with activities) for a trip.</summary>
    [HttpGet("{id:guid}/schedule")]
    public async Task<ActionResult<ApiResponse<List<TripDayDto>>>> GetSchedule(Guid id, CancellationToken ct)
    {
        var days = await _db.TripDays.Include(d => d.ScheduledActivities).ThenInclude(sa => sa.Activity)
            .Where(d => d.TripInstanceId == id).OrderBy(d => d.DayNumber)
            .Select(d => new TripDayDto
            {
                Id = d.Id, TripInstanceId = d.TripInstanceId, DayNumber = d.DayNumber,
                Date = d.Date, DayTitle = d.DayTitle, DayNotes = d.DayNotes,
                ScheduledActivities = d.ScheduledActivities.OrderBy(sa => sa.SortOrder)
                    .Select(sa => new ScheduledActivityDto
                    {
                        Id = sa.Id, TripDayId = sa.TripDayId, ActivityId = sa.ActivityId,
                        Title = sa.Title, StartTime = sa.StartTime, EndTime = sa.EndTime,
                        Location = sa.Location, AccessibilityNotes = sa.AccessibilityNotes,
                        Notes = sa.Notes, SortOrder = sa.SortOrder,
                        Status = sa.Status, BookingReference = sa.BookingReference,
                        ProviderName = sa.ProviderName, ProviderPhone = sa.ProviderPhone,
                        ProviderEmail = sa.ProviderEmail, ProviderWebsite = sa.ProviderWebsite,
                        EstimatedCost = sa.EstimatedCost,
                        Category = sa.Activity != null ? sa.Activity.Category : null
                    }).ToList()
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<TripDayDto>>.Ok(days));
    }

    /// <summary>Get documents for a trip.</summary>
    [HttpGet("{id:guid}/documents")]
    public async Task<ActionResult<ApiResponse<List<TripDocumentDto>>>> GetDocuments(Guid id, CancellationToken ct)
    {
        var items = await _db.TripDocuments.Where(d => d.TripInstanceId == id)
            .Select(d => new TripDocumentDto
            {
                Id = d.Id, TripInstanceId = d.TripInstanceId, ParticipantBookingId = d.ParticipantBookingId,
                DocumentType = d.DocumentType, FileName = d.FileName, FilePath = d.FilePath,
                FileSize = d.FileSize, DocumentDate = d.DocumentDate, Notes = d.Notes, UploadedAt = d.UploadedAt
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<TripDocumentDto>>.Ok(items));
    }

    /// <summary>Ensure TripDay records exist for a trip, reconciling with DurationDays.</summary>
    [HttpPost("{id:guid}/schedule/generate")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<TripDayDto>>>> GenerateSchedule(Guid id, CancellationToken ct)
    {
        var trip = await _db.TripInstances.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (trip == null) return NotFound(ApiResponse<List<TripDayDto>>.Fail("Trip not found"));
        if (trip.DurationDays <= 0) return BadRequest(ApiResponse<List<TripDayDto>>.Fail("Trip has no days configured"));

        var existingDays = await _db.TripDays
            .Include(d => d.ScheduledActivities)
            .Where(d => d.TripInstanceId == id)
            .OrderBy(d => d.DayNumber)
            .ToListAsync(ct);

        if (existingDays.Count == 0)
        {
            for (int i = 0; i < trip.DurationDays; i++)
            {
                _db.TripDays.Add(new TripDay
                {
                    Id = Guid.NewGuid(), TripInstanceId = id, DayNumber = i + 1,
                    Date = trip.StartDate.AddDays(i),
                    DayTitle = i == 0 ? "Arrival Day" : i == trip.DurationDays - 1 ? "Departure Day" : $"Day {i + 1}"
                });
            }
        }
        else if (existingDays.Count < trip.DurationDays)
        {
            for (int i = existingDays.Count; i < trip.DurationDays; i++)
            {
                _db.TripDays.Add(new TripDay
                {
                    Id = Guid.NewGuid(), TripInstanceId = id, DayNumber = i + 1,
                    Date = trip.StartDate.AddDays(i), DayTitle = $"Day {i + 1}"
                });
            }
        }
        else if (existingDays.Count > trip.DurationDays)
        {
            var trailingDays = existingDays.Where(d => d.DayNumber > trip.DurationDays).ToList();
            var daysToRemove = trailingDays.Where(d => d.ScheduledActivities.Count == 0).ToList();
            var protectedDays = trailingDays.Where(d => d.ScheduledActivities.Count > 0).ToList();
            foreach (var pd in protectedDays)
                _logger.LogWarning("TripDay {DayId} (Day {DayNumber}) for trip {TripId} exceeds DurationDays but has {Count} activities — keeping it",
                    pd.Id, pd.DayNumber, id, pd.ScheduledActivities.Count);
            _db.TripDays.RemoveRange(daysToRemove);
        }

        await _db.SaveChangesAsync(ct);

        // Re-fetch with activities for response
        var days = await _db.TripDays
            .Include(d => d.ScheduledActivities).ThenInclude(sa => sa.Activity)
            .Where(d => d.TripInstanceId == id)
            .OrderBy(d => d.DayNumber)
            .Select(d => new TripDayDto
            {
                Id = d.Id, TripInstanceId = d.TripInstanceId, DayNumber = d.DayNumber,
                Date = d.Date, DayTitle = d.DayTitle, DayNotes = d.DayNotes,
                ScheduledActivities = d.ScheduledActivities.OrderBy(sa => sa.SortOrder)
                    .Select(sa => new ScheduledActivityDto
                    {
                        Id = sa.Id, TripDayId = sa.TripDayId, ActivityId = sa.ActivityId,
                        Title = sa.Title, StartTime = sa.StartTime, EndTime = sa.EndTime,
                        Location = sa.Location, AccessibilityNotes = sa.AccessibilityNotes,
                        Notes = sa.Notes, SortOrder = sa.SortOrder,
                        Status = sa.Status, BookingReference = sa.BookingReference,
                        ProviderName = sa.ProviderName, ProviderPhone = sa.ProviderPhone,
                        ProviderEmail = sa.ProviderEmail, ProviderWebsite = sa.ProviderWebsite,
                        EstimatedCost = sa.EstimatedCost,
                        Category = sa.Activity != null ? sa.Activity.Category : null
                    }).ToList()
            }).ToListAsync(ct);

        return Ok(ApiResponse<List<TripDayDto>>.Ok(days));
    }

    /// <summary>Get full itinerary (composite read-only view) for a trip.</summary>
    [HttpGet("{id:guid}/itinerary")]
    public async Task<ActionResult<ApiResponse<ItineraryDto>>> GetItinerary(Guid id, CancellationToken ct)
    {
        var trip = await _db.TripInstances
            .Include(t => t.EventTemplate)
            .Include(t => t.LeadCoordinator)
            .FirstOrDefaultAsync(t => t.Id == id, ct);
        if (trip == null) return NotFound(ApiResponse<ItineraryDto>.Fail("Trip not found"));

        // Fetch all related data sequentially (DbContext is not thread-safe)
        var days = await _db.TripDays
            .Include(d => d.ScheduledActivities).ThenInclude(sa => sa.Activity)
            .Where(d => d.TripInstanceId == id)
            .OrderBy(d => d.DayNumber)
            .ToListAsync(ct);

        var bookings = await _db.ParticipantBookings
            .Include(b => b.Participant)
            .Where(b => b.TripInstanceId == id && b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending)
            .ToListAsync(ct);

        var reservations = await _db.AccommodationReservations
            .Include(r => r.AccommodationProperty)
            .Where(r => r.TripInstanceId == id && r.ReservationStatus != ReservationStatus.Cancelled)
            .OrderBy(r => r.CheckInDate)
            .ToListAsync(ct);

        var vehicleAssignments = await _db.VehicleAssignments
            .Include(v => v.Vehicle)
            .Include(v => v.DriverUser)
            .Where(v => v.TripInstanceId == id && v.Status != VehicleAssignmentStatus.Cancelled)
            .ToListAsync(ct);

        var staffAssignments = await _db.StaffAssignments
            .Include(s => s.User)
            .Where(s => s.TripInstanceId == id && s.Status != AssignmentStatus.Cancelled)
            .OrderBy(s => s.AssignmentStart)
            .ToListAsync(ct);

        // Build accommodation events indexed by date
        var accommodationEvents = new List<(DateOnly Date, ItineraryDayAccommodationEventDto Event)>();
        foreach (var r in reservations)
        {
            var addr = string.Join(", ", new[] { r.AccommodationProperty.Address, r.AccommodationProperty.Suburb, r.AccommodationProperty.State }.Where(s => !string.IsNullOrEmpty(s)));
            accommodationEvents.Add((r.CheckInDate, new ItineraryDayAccommodationEventDto
            {
                EventType = "Check-in",
                PropertyName = r.AccommodationProperty.PropertyName,
                Address = string.IsNullOrEmpty(addr) ? null : addr,
                ConfirmationReference = r.ConfirmationReference
            }));
            accommodationEvents.Add((r.CheckOutDate, new ItineraryDayAccommodationEventDto
            {
                EventType = "Check-out",
                PropertyName = r.AccommodationProperty.PropertyName,
                Address = string.IsNullOrEmpty(addr) ? null : addr,
                ConfirmationReference = r.ConfirmationReference
            }));
        }

        // Total estimated cost
        var activityCost = days.SelectMany(d => d.ScheduledActivities)
            .Where(sa => sa.EstimatedCost.HasValue)
            .Sum(sa => sa.EstimatedCost!.Value);
        var accommodationCost = reservations
            .Where(r => r.Cost.HasValue)
            .Sum(r => r.Cost!.Value);

        var itinerary = new ItineraryDto
        {
            TripId = trip.Id,
            TripName = trip.TripName,
            TripCode = trip.TripCode,
            Destination = trip.Destination,
            Region = trip.Region,
            StartDate = trip.StartDate,
            EndDate = trip.EndDate,
            DurationDays = trip.DurationDays,
            Status = trip.Status,
            LeadCoordinatorName = trip.LeadCoordinator != null ? $"{trip.LeadCoordinator.FirstName} {trip.LeadCoordinator.LastName}" : null,
            Notes = trip.Notes,
            ParticipantCount = bookings.Count,
            StaffCount = staffAssignments.Count,
            TotalEstimatedCost = activityCost + accommodationCost,
            Participants = bookings.Select(b => new ItineraryParticipantDto
            {
                Id = b.ParticipantId,
                Name = b.Participant.PreferredName ?? $"{b.Participant.FirstName} {b.Participant.LastName}",
                WheelchairRequired = b.WheelchairRequired,
                HighSupportRequired = b.HighSupportRequired,
                NightSupportRequired = b.NightSupportRequired,
                SupportRatio = b.SupportRatioOverride ?? b.Participant.SupportRatio,
                MobilityNotes = b.Participant.MobilityNotes,
                MedicalSummary = b.Participant.MedicalSummary
            }).ToList(),
            Accommodation = reservations.Select(r => new ItineraryAccommodationDto
            {
                PropertyName = r.AccommodationProperty.PropertyName,
                Address = r.AccommodationProperty.Address,
                Suburb = r.AccommodationProperty.Suburb,
                State = r.AccommodationProperty.State,
                Phone = r.AccommodationProperty.Phone,
                CheckInDate = r.CheckInDate,
                CheckOutDate = r.CheckOutDate,
                BedroomsReserved = r.BedroomsReserved,
                BedsReserved = r.BedsReserved,
                ConfirmationReference = r.ConfirmationReference,
                ReservationStatus = r.ReservationStatus,
                Cost = r.Cost,
                Comments = r.Comments
            }).ToList(),
            Vehicles = vehicleAssignments.Select(v => new ItineraryVehicleDto
            {
                VehicleName = v.Vehicle.VehicleName,
                Registration = v.Vehicle.Registration,
                VehicleType = v.Vehicle.VehicleType,
                TotalSeats = v.Vehicle.TotalSeats,
                WheelchairPositions = v.Vehicle.WheelchairPositions,
                DriverName = v.DriverUser != null ? $"{v.DriverUser.FirstName} {v.DriverUser.LastName}" : null,
                Status = v.Status,
                PickupTravelNotes = v.PickupTravelNotes
            }).ToList(),
            Staff = staffAssignments.Select(s => new ItineraryStaffDto
            {
                Name = $"{s.User.FirstName} {s.User.LastName}",
                Role = s.AssignmentRole ?? (s.User.Position ?? Position.SupportWorker).ToString(),
                Email = s.User.Email,
                Mobile = s.User.Mobile,
                AssignmentStart = s.AssignmentStart,
                AssignmentEnd = s.AssignmentEnd,
                IsDriver = s.IsDriver,
                SleepoverType = s.SleepoverType,
                Status = s.Status
            }).ToList(),
            Days = days.Select(d => new ItineraryDayDto
            {
                DayNumber = d.DayNumber,
                Date = d.Date,
                DayTitle = d.DayTitle,
                DayNotes = d.DayNotes,
                Activities = d.ScheduledActivities.OrderBy(sa => sa.SortOrder).Select(sa => new ItineraryActivityDto
                {
                    Title = sa.Title,
                    StartTime = sa.StartTime,
                    EndTime = sa.EndTime,
                    Location = sa.Location,
                    Category = sa.Activity?.Category,
                    Status = sa.Status,
                    AccessibilityNotes = sa.AccessibilityNotes,
                    Notes = sa.Notes,
                    BookingReference = sa.BookingReference,
                    ProviderName = sa.ProviderName,
                    ProviderPhone = sa.ProviderPhone,
                    EstimatedCost = sa.EstimatedCost
                }).ToList(),
                AccommodationEvents = accommodationEvents
                    .Where(e => e.Date == d.Date)
                    .Select(e => e.Event)
                    .ToList(),
                StaffOnDuty = staffAssignments
                    .Where(s => s.AssignmentStart <= d.Date && s.AssignmentEnd >= d.Date)
                    .Select(s => $"{s.User.FirstName} {s.User.LastName}")
                    .ToList()
            }).ToList()
        };

        return Ok(ApiResponse<ItineraryDto>.Ok(itinerary));
    }
}
