using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/vehicles")]
public class VehiclesController : ControllerBase
{
    private readonly OdipDbContext _db;
    public VehiclesController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<VehicleListDto>>>> GetAll(
        [FromQuery] bool? isActive, CancellationToken ct)
    {
        var query = _db.Vehicles.OrderBy(v => v.VehicleName).AsQueryable();
        if (isActive.HasValue) query = query.Where(v => v.IsActive == isActive.Value);

        var items = await query
            .Select(v => new VehicleListDto
            {
                Id = v.Id, VehicleName = v.VehicleName, Registration = v.Registration,
                VehicleType = v.VehicleType, TotalSeats = v.TotalSeats,
                WheelchairPositions = v.WheelchairPositions, IsInternal = v.IsInternal,
                IsActive = v.IsActive, ServiceDueDate = v.ServiceDueDate,
                RegistrationDueDate = v.RegistrationDueDate
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<VehicleListDto>>.Ok(items));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<VehicleDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var v = await _db.Vehicles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (v == null) return NotFound(ApiResponse<VehicleDetailDto>.Fail("Vehicle not found"));

        return Ok(ApiResponse<VehicleDetailDto>.Ok(new VehicleDetailDto
        {
            Id = v.Id, VehicleName = v.VehicleName, Registration = v.Registration,
            VehicleType = v.VehicleType, TotalSeats = v.TotalSeats,
            WheelchairPositions = v.WheelchairPositions, IsInternal = v.IsInternal,
            IsActive = v.IsActive, ServiceDueDate = v.ServiceDueDate,
            RegistrationDueDate = v.RegistrationDueDate, RampHoistDetails = v.RampHoistDetails,
            DriverRequirements = v.DriverRequirements, Notes = v.Notes
        }));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleDetailDto>>> Create([FromBody] CreateVehicleDto dto, CancellationToken ct)
    {
        var v = new Vehicle
        {
            Id = Guid.NewGuid(), VehicleName = dto.VehicleName, Registration = dto.Registration,
            VehicleType = dto.VehicleType, TotalSeats = dto.TotalSeats, WheelchairPositions = dto.WheelchairPositions,
            RampHoistDetails = dto.RampHoistDetails, DriverRequirements = dto.DriverRequirements,
            IsInternal = dto.IsInternal, IsActive = dto.IsActive, ServiceDueDate = dto.ServiceDueDate,
            RegistrationDueDate = dto.RegistrationDueDate, Notes = dto.Notes
        };
        _db.Vehicles.Add(v);
        await _db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById), new { id = v.Id }, ApiResponse<VehicleDetailDto>.Ok(new VehicleDetailDto
        {
            Id = v.Id, VehicleName = v.VehicleName, Registration = v.Registration,
            VehicleType = v.VehicleType, TotalSeats = v.TotalSeats,
            WheelchairPositions = v.WheelchairPositions, IsInternal = v.IsInternal,
            IsActive = v.IsActive, ServiceDueDate = v.ServiceDueDate,
            RegistrationDueDate = v.RegistrationDueDate, RampHoistDetails = v.RampHoistDetails,
            DriverRequirements = v.DriverRequirements, Notes = v.Notes
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleDetailDto>>> Update(Guid id, [FromBody] UpdateVehicleDto dto, CancellationToken ct)
    {
        var v = await _db.Vehicles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (v == null) return NotFound(ApiResponse<VehicleDetailDto>.Fail("Vehicle not found"));

        v.VehicleName = dto.VehicleName; v.Registration = dto.Registration; v.VehicleType = dto.VehicleType;
        v.TotalSeats = dto.TotalSeats; v.WheelchairPositions = dto.WheelchairPositions;
        v.RampHoistDetails = dto.RampHoistDetails; v.DriverRequirements = dto.DriverRequirements;
        v.IsInternal = dto.IsInternal; v.IsActive = dto.IsActive; v.ServiceDueDate = dto.ServiceDueDate;
        v.RegistrationDueDate = dto.RegistrationDueDate; v.Notes = dto.Notes; v.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<VehicleDetailDto>.Ok(new VehicleDetailDto
        {
            Id = v.Id, VehicleName = v.VehicleName, Registration = v.Registration,
            VehicleType = v.VehicleType, TotalSeats = v.TotalSeats,
            WheelchairPositions = v.WheelchairPositions, IsInternal = v.IsInternal,
            IsActive = v.IsActive, ServiceDueDate = v.ServiceDueDate,
            RegistrationDueDate = v.RegistrationDueDate, RampHoistDetails = v.RampHoistDetails,
            DriverRequirements = v.DriverRequirements, Notes = v.Notes
        }));
    }

    /// <summary>Archive (soft-delete) a vehicle.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var v = await _db.Vehicles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (v == null) return NotFound(ApiResponse<bool>.Fail("Vehicle not found"));
        v.IsActive = false; v.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Vehicle archived"));
    }

    [HttpGet("{id:guid}/assignments")]
    public async Task<ActionResult<ApiResponse<List<VehicleAssignmentDto>>>> GetAssignments(Guid id, CancellationToken ct)
    {
        var items = await _db.VehicleAssignments.Include(a => a.TripInstance).Include(a => a.DriverStaff)
            .Where(a => a.VehicleId == id)
            .Select(a => new VehicleAssignmentDto
            {
                Id = a.Id, TripInstanceId = a.TripInstanceId, VehicleId = a.VehicleId,
                Status = a.Status, DriverStaffId = a.DriverStaffId,
                DriverName = a.DriverStaff != null ? a.DriverStaff.FirstName + " " + a.DriverStaff.LastName : null,
                HasOverlapConflict = a.HasOverlapConflict
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<VehicleAssignmentDto>>.Ok(items));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/vehicle-assignments")]
public class VehicleAssignmentsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public VehicleAssignmentsController(OdipDbContext db) => _db = db;

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleAssignmentDto>>> Create([FromBody] CreateVehicleAssignmentDto dto, CancellationToken ct)
    {
        var trip = await _db.TripInstances.FirstOrDefaultAsync(t => t.Id == dto.TripInstanceId, ct);
        if (trip == null) return NotFound(ApiResponse<VehicleAssignmentDto>.Fail("Trip not found"));

        var assignment = new VehicleAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId, VehicleId = dto.VehicleId,
            DriverStaffId = dto.DriverStaffId, SeatRequirement = dto.SeatRequirement,
            WheelchairPositionRequirement = dto.WheelchairPositionRequirement,
            PickupTravelNotes = dto.PickupTravelNotes, Comments = dto.Comments,
            RequestedDate = DateOnly.FromDateTime(DateTime.UtcNow)
        };

        // Check vehicle overlap conflict
        var hasConflict = await _db.VehicleAssignments
            .Include(a => a.TripInstance)
            .AnyAsync(a => a.VehicleId == dto.VehicleId && a.Id != assignment.Id
                && a.Status != VehicleAssignmentStatus.Cancelled && a.Status != VehicleAssignmentStatus.Unavailable
                && a.TripInstance.StartDate <= trip.StartDate.AddDays(trip.DurationDays - 1)
                && a.TripInstance.StartDate.AddDays(a.TripInstance.DurationDays - 1) >= trip.StartDate, ct);
        assignment.HasOverlapConflict = hasConflict;

        _db.VehicleAssignments.Add(assignment);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(assignment).Reference(a => a.Vehicle).LoadAsync(ct);
        if (assignment.DriverStaffId.HasValue) await _db.Entry(assignment).Reference(a => a.DriverStaff).LoadAsync(ct);
        return Ok(ApiResponse<VehicleAssignmentDto>.Ok(new VehicleAssignmentDto
        {
            Id = assignment.Id, TripInstanceId = assignment.TripInstanceId, VehicleId = assignment.VehicleId,
            VehicleName = assignment.Vehicle?.VehicleName, Registration = assignment.Vehicle?.Registration,
            Status = assignment.Status, RequestedDate = assignment.RequestedDate, ConfirmedDate = assignment.ConfirmedDate,
            DriverStaffId = assignment.DriverStaffId,
            DriverName = assignment.DriverStaff != null ? assignment.DriverStaff.FirstName + " " + assignment.DriverStaff.LastName : null,
            SeatRequirement = assignment.SeatRequirement, WheelchairPositionRequirement = assignment.WheelchairPositionRequirement,
            PickupTravelNotes = assignment.PickupTravelNotes, Comments = assignment.Comments, HasOverlapConflict = hasConflict
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleAssignmentDto>>> Update(Guid id, [FromBody] UpdateVehicleAssignmentDto dto, CancellationToken ct)
    {
        var a = await _db.VehicleAssignments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<VehicleAssignmentDto>.Fail("Assignment not found"));

        a.VehicleId = dto.VehicleId; a.DriverStaffId = dto.DriverStaffId;
        a.SeatRequirement = dto.SeatRequirement; a.WheelchairPositionRequirement = dto.WheelchairPositionRequirement;
        a.PickupTravelNotes = dto.PickupTravelNotes; a.Comments = dto.Comments;
        a.Status = dto.Status; a.ConfirmedDate = dto.ConfirmedDate; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _db.Entry(a).Reference(x => x.Vehicle).LoadAsync(ct);
        if (a.DriverStaffId.HasValue) await _db.Entry(a).Reference(x => x.DriverStaff).LoadAsync(ct);
        return Ok(ApiResponse<VehicleAssignmentDto>.Ok(new VehicleAssignmentDto
        {
            Id = a.Id, TripInstanceId = a.TripInstanceId, VehicleId = a.VehicleId,
            VehicleName = a.Vehicle?.VehicleName, Registration = a.Vehicle?.Registration,
            Status = a.Status, RequestedDate = a.RequestedDate, ConfirmedDate = a.ConfirmedDate,
            DriverStaffId = a.DriverStaffId,
            DriverName = a.DriverStaff != null ? a.DriverStaff.FirstName + " " + a.DriverStaff.LastName : null,
            SeatRequirement = a.SeatRequirement, WheelchairPositionRequirement = a.WheelchairPositionRequirement,
            PickupTravelNotes = a.PickupTravelNotes, Comments = a.Comments, HasOverlapConflict = a.HasOverlapConflict
        }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var a = await _db.VehicleAssignments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<bool>.Fail("Assignment not found"));
        a.Status = VehicleAssignmentStatus.Cancelled; a.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/staff")]
public class StaffController : ControllerBase
{
    private readonly OdipDbContext _db;
    public StaffController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<StaffListDto>>>> GetAll(
        [FromQuery] bool? isActive, CancellationToken ct)
    {
        var query = _db.Staff.OrderBy(s => s.LastName).AsQueryable();
        if (isActive.HasValue) query = query.Where(s => s.IsActive == isActive.Value);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var items = await query
            .Select(s => new StaffListDto
            {
                Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
                FullName = s.FirstName + " " + s.LastName, Role = s.Role, Email = s.Email,
                Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
                IsFirstAidQualified = s.IsFirstAidQualified, IsMedicationCompetent = s.IsMedicationCompetent,
                IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
                IsActive = s.IsActive,
                FirstAidExpiryDate = s.FirstAidExpiryDate,
                DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
                ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
                MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
                Notes = s.Notes,
                HasExpiredQualifications =
                    (s.IsFirstAidQualified && s.FirstAidExpiryDate != null && s.FirstAidExpiryDate < today)
                    || (s.IsDriverEligible && s.DriverLicenceExpiryDate != null && s.DriverLicenceExpiryDate < today)
                    || (s.IsManualHandlingCompetent && s.ManualHandlingExpiryDate != null && s.ManualHandlingExpiryDate < today)
                    || (s.IsMedicationCompetent && s.MedicationCompetencyExpiryDate != null && s.MedicationCompetencyExpiryDate < today)
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffListDto>>.Ok(items));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var s = await _db.Staff.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<StaffDetailDto>.Fail("Staff not found"));

        return Ok(ApiResponse<StaffDetailDto>.Ok(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            FullName = s.FirstName + " " + s.LastName, Role = s.Role, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            HasExpiredQualifications = s.HasExpiredQualifications
        }));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> Create([FromBody] CreateStaffDto dto, CancellationToken ct)
    {
        var s = new Staff
        {
            Id = Guid.NewGuid(), FirstName = dto.FirstName, LastName = dto.LastName, Role = dto.Role,
            Email = dto.Email, Mobile = dto.Mobile, Region = dto.Region,
            IsDriverEligible = dto.IsDriverEligible, IsFirstAidQualified = dto.IsFirstAidQualified,
            IsMedicationCompetent = dto.IsMedicationCompetent, IsManualHandlingCompetent = dto.IsManualHandlingCompetent,
            IsOvernightEligible = dto.IsOvernightEligible, IsActive = dto.IsActive, Notes = dto.Notes,
            FirstAidExpiryDate = dto.FirstAidExpiryDate,
            DriverLicenceExpiryDate = dto.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = dto.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = dto.MedicationCompetencyExpiryDate
        };
        _db.Staff.Add(s);
        await _db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById), new { id = s.Id }, ApiResponse<StaffDetailDto>.Ok(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            FullName = s.FullName, Role = s.Role, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            HasExpiredQualifications = s.HasExpiredQualifications
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> Update(Guid id, [FromBody] UpdateStaffDto dto, CancellationToken ct)
    {
        var s = await _db.Staff.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<StaffDetailDto>.Fail("Staff not found"));

        s.FirstName = dto.FirstName; s.LastName = dto.LastName; s.Role = dto.Role;
        s.Email = dto.Email; s.Mobile = dto.Mobile; s.Region = dto.Region;
        s.IsDriverEligible = dto.IsDriverEligible; s.IsFirstAidQualified = dto.IsFirstAidQualified;
        s.IsMedicationCompetent = dto.IsMedicationCompetent; s.IsManualHandlingCompetent = dto.IsManualHandlingCompetent;
        s.IsOvernightEligible = dto.IsOvernightEligible; s.IsActive = dto.IsActive;
        s.Notes = dto.Notes;
        s.FirstAidExpiryDate = dto.FirstAidExpiryDate;
        s.DriverLicenceExpiryDate = dto.DriverLicenceExpiryDate;
        s.ManualHandlingExpiryDate = dto.ManualHandlingExpiryDate;
        s.MedicationCompetencyExpiryDate = dto.MedicationCompetencyExpiryDate;
        s.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<StaffDetailDto>.Ok(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            FullName = s.FullName, Role = s.Role, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            HasExpiredQualifications = s.HasExpiredQualifications
        }));
    }

    /// <summary>Archive (soft-delete) a staff member.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var s = await _db.Staff.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<bool>.Fail("Staff not found"));
        s.IsActive = false; s.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Staff member archived"));
    }

    [HttpGet("{id:guid}/availability")]
    public async Task<ActionResult<ApiResponse<List<StaffAvailabilityDto>>>> GetAvailability(Guid id, CancellationToken ct)
    {
        var items = await _db.StaffAvailabilities.Where(a => a.StaffId == id)
            .OrderBy(a => a.StartDateTime)
            .Select(a => new StaffAvailabilityDto
            {
                Id = a.Id, StaffId = a.StaffId, StartDateTime = a.StartDateTime,
                EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
                IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffAvailabilityDto>>.Ok(items));
    }

    [HttpGet("{id:guid}/assignments")]
    public async Task<ActionResult<ApiResponse<List<StaffAssignmentDto>>>> GetAssignments(Guid id, CancellationToken ct)
    {
        var items = await _db.StaffAssignments.Include(a => a.TripInstance)
            .Where(a => a.StaffId == id)
            .Select(a => new StaffAssignmentDto
            {
                Id = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance.TripName,
                StaffId = a.StaffId, AssignmentRole = a.AssignmentRole,
                AssignmentStart = a.AssignmentStart, AssignmentEnd = a.AssignmentEnd,
                Status = a.Status, IsDriver = a.IsDriver, SleepoverType = a.SleepoverType,
                HasConflict = a.HasConflict
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffAssignmentDto>>.Ok(items));
    }

    /// <summary>Get staff available for a date range.</summary>
    [HttpGet("available")]
    public async Task<ActionResult<ApiResponse<List<StaffListDto>>>> GetAvailable(
        [FromQuery] DateOnly startDate, [FromQuery] DateOnly endDate, CancellationToken ct)
    {
        var startDt = startDate.ToDateTime(TimeOnly.MinValue);
        var endDt = endDate.ToDateTime(TimeOnly.MaxValue);

        // Staff who don't have Unavailable/Leave during the range
        var unavailableStaffIds = await _db.StaffAvailabilities
            .Where(a => (a.AvailabilityType == AvailabilityType.Unavailable || a.AvailabilityType == AvailabilityType.Leave)
                && a.StartDateTime < endDt && a.EndDateTime > startDt)
            .Select(a => a.StaffId).Distinct().ToListAsync(ct);

        var items = await _db.Staff.Where(s => s.IsActive && !unavailableStaffIds.Contains(s.Id))
            .Select(s => new StaffListDto
            {
                Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
                FullName = s.FirstName + " " + s.LastName, Role = s.Role,
                IsDriverEligible = s.IsDriverEligible, IsFirstAidQualified = s.IsFirstAidQualified,
                IsMedicationCompetent = s.IsMedicationCompetent, IsManualHandlingCompetent = s.IsManualHandlingCompetent,
                IsOvernightEligible = s.IsOvernightEligible, IsActive = s.IsActive
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffListDto>>.Ok(items));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/staff-availability")]
public class StaffAvailabilityController : ControllerBase
{
    private readonly OdipDbContext _db;
    public StaffAvailabilityController(OdipDbContext db) => _db = db;

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAvailabilityDto>>> Create([FromBody] CreateStaffAvailabilityDto dto, CancellationToken ct)
    {
        var a = new StaffAvailability
        {
            Id = Guid.NewGuid(), StaffId = dto.StaffId, StartDateTime = dto.StartDateTime,
            EndDateTime = dto.EndDateTime, AvailabilityType = dto.AvailabilityType,
            IsRecurring = dto.IsRecurring, RecurrenceNotes = dto.RecurrenceNotes, Notes = dto.Notes
        };
        _db.StaffAvailabilities.Add(a);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<StaffAvailabilityDto>.Ok(new StaffAvailabilityDto
        {
            Id = a.Id, StaffId = a.StaffId, StartDateTime = a.StartDateTime,
            EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
            IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAvailabilityDto>>> Update(Guid id, [FromBody] UpdateStaffAvailabilityDto dto, CancellationToken ct)
    {
        var a = await _db.StaffAvailabilities.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<StaffAvailabilityDto>.Fail("Availability not found"));

        a.StartDateTime = dto.StartDateTime; a.EndDateTime = dto.EndDateTime;
        a.AvailabilityType = dto.AvailabilityType; a.IsRecurring = dto.IsRecurring;
        a.RecurrenceNotes = dto.RecurrenceNotes; a.Notes = dto.Notes; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<StaffAvailabilityDto>.Ok(new StaffAvailabilityDto
        {
            Id = a.Id, StaffId = a.StaffId, StartDateTime = a.StartDateTime,
            EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
            IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
        }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var a = await _db.StaffAvailabilities.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<bool>.Fail("Availability not found"));
        _db.StaffAvailabilities.Remove(a);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}

[ApiController]
[Authorize]
[Route("api/v1/staff-assignments")]
public class StaffAssignmentsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public StaffAssignmentsController(OdipDbContext db) => _db = db;

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Create([FromBody] CreateStaffAssignmentDto dto, CancellationToken ct)
    {
        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId, StaffId = dto.StaffId,
            AssignmentRole = dto.AssignmentRole, AssignmentStart = dto.AssignmentStart,
            AssignmentEnd = dto.AssignmentEnd, IsDriver = dto.IsDriver,
            SleepoverType = dto.SleepoverType, ShiftNotes = dto.ShiftNotes
        };

        // Check staff overlap conflict
        var hasConflict = await _db.StaffAssignments
            .AnyAsync(a => a.StaffId == dto.StaffId && a.Id != assignment.Id
                && a.Status != AssignmentStatus.Cancelled
                && a.AssignmentStart <= dto.AssignmentEnd && a.AssignmentEnd >= dto.AssignmentStart, ct);

        // Check staff availability conflict
        if (!hasConflict)
        {
            var startDt = dto.AssignmentStart.ToDateTime(TimeOnly.MinValue);
            var endDt = dto.AssignmentEnd.ToDateTime(TimeOnly.MaxValue);
            hasConflict = await _db.StaffAvailabilities
                .AnyAsync(sa => sa.StaffId == dto.StaffId
                    && (sa.AvailabilityType == AvailabilityType.Unavailable || sa.AvailabilityType == AvailabilityType.Leave)
                    && sa.StartDateTime < endDt && sa.EndDateTime > startDt, ct);
        }

        assignment.HasConflict = hasConflict;
        _db.StaffAssignments.Add(assignment);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(assignment).Reference(a => a.TripInstance).LoadAsync(ct);
        await _db.Entry(assignment).Reference(a => a.Staff).LoadAsync(ct);
        return Ok(ApiResponse<StaffAssignmentDto>.Ok(new StaffAssignmentDto
        {
            Id = assignment.Id, TripInstanceId = assignment.TripInstanceId, TripName = assignment.TripInstance?.TripName,
            StaffId = assignment.StaffId,
            StaffName = assignment.Staff != null ? assignment.Staff.FirstName + " " + assignment.Staff.LastName : null,
            AssignmentRole = assignment.AssignmentRole, AssignmentStart = assignment.AssignmentStart, AssignmentEnd = assignment.AssignmentEnd,
            Status = assignment.Status, IsDriver = assignment.IsDriver, SleepoverType = assignment.SleepoverType,
            ShiftNotes = assignment.ShiftNotes, HasConflict = hasConflict
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Update(Guid id, [FromBody] UpdateStaffAssignmentDto dto, CancellationToken ct)
    {
        var a = await _db.StaffAssignments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<StaffAssignmentDto>.Fail("Assignment not found"));

        a.StaffId = dto.StaffId; a.AssignmentRole = dto.AssignmentRole;
        a.AssignmentStart = dto.AssignmentStart; a.AssignmentEnd = dto.AssignmentEnd;
        a.IsDriver = dto.IsDriver; a.SleepoverType = dto.SleepoverType;
        a.ShiftNotes = dto.ShiftNotes; a.Status = dto.Status; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _db.Entry(a).Reference(x => x.TripInstance).LoadAsync(ct);
        await _db.Entry(a).Reference(x => x.Staff).LoadAsync(ct);
        return Ok(ApiResponse<StaffAssignmentDto>.Ok(new StaffAssignmentDto
        {
            Id = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance?.TripName,
            StaffId = a.StaffId, StaffName = a.Staff != null ? a.Staff.FirstName + " " + a.Staff.LastName : null,
            AssignmentRole = a.AssignmentRole, AssignmentStart = a.AssignmentStart, AssignmentEnd = a.AssignmentEnd,
            Status = a.Status, IsDriver = a.IsDriver, SleepoverType = a.SleepoverType,
            ShiftNotes = a.ShiftNotes, HasConflict = a.HasConflict
        }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var a = await _db.StaffAssignments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<bool>.Fail("Assignment not found"));
        a.Status = AssignmentStatus.Cancelled;
        a.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Assignment deleted"));
    }
}
