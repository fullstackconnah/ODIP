using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;

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
        var items = await _db.VehicleAssignments.Include(a => a.TripInstance).Include(a => a.DriverUser)
            .Where(a => a.VehicleId == id)
            .Select(a => new VehicleAssignmentDto
            {
                Id = a.Id, TripInstanceId = a.TripInstanceId, VehicleId = a.VehicleId,
                Status = a.Status, DriverStaffId = a.DriverUserId,
                DriverName = a.DriverUser != null ? a.DriverUser.FirstName + " " + a.DriverUser.LastName : null,
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

    /// <summary>
    /// §4.4 same-tenant validation for the driver picker: null is always fine (no driver
    /// assigned yet), otherwise the id must resolve to an active User — same-tenant scoping comes
    /// for free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidDriverRefAsync(Guid? driverUserId, CancellationToken ct) =>
        driverUserId.HasValue
            ? _db.Users.AnyAsync(u => u.Id == driverUserId.Value && u.IsActive, ct)
            : Task.FromResult(true);

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleAssignmentDto>>> Create([FromBody] CreateVehicleAssignmentDto dto, CancellationToken ct)
    {
        var trip = await _db.TripInstances.FirstOrDefaultAsync(t => t.Id == dto.TripInstanceId, ct);
        if (trip == null) return NotFound(ApiResponse<VehicleAssignmentDto>.Fail("Trip not found"));

        if (!await IsValidDriverRefAsync(dto.DriverStaffId, ct))
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail("Driver not found."));

        var assignment = new VehicleAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId, VehicleId = dto.VehicleId,
            DriverUserId = dto.DriverStaffId, SeatRequirement = dto.SeatRequirement,
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
        if (assignment.DriverUserId.HasValue) await _db.Entry(assignment).Reference(a => a.DriverUser).LoadAsync(ct);
        return Ok(ApiResponse<VehicleAssignmentDto>.Ok(new VehicleAssignmentDto
        {
            Id = assignment.Id, TripInstanceId = assignment.TripInstanceId, VehicleId = assignment.VehicleId,
            VehicleName = assignment.Vehicle?.VehicleName, Registration = assignment.Vehicle?.Registration,
            Status = assignment.Status, RequestedDate = assignment.RequestedDate, ConfirmedDate = assignment.ConfirmedDate,
            DriverStaffId = assignment.DriverUserId,
            DriverName = assignment.DriverUser != null ? assignment.DriverUser.FirstName + " " + assignment.DriverUser.LastName : null,
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

        if (!await IsValidDriverRefAsync(dto.DriverStaffId, ct))
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail("Driver not found."));

        a.VehicleId = dto.VehicleId; a.DriverUserId = dto.DriverStaffId;
        a.SeatRequirement = dto.SeatRequirement; a.WheelchairPositionRequirement = dto.WheelchairPositionRequirement;
        a.PickupTravelNotes = dto.PickupTravelNotes; a.Comments = dto.Comments;
        a.Status = dto.Status; a.ConfirmedDate = dto.ConfirmedDate; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _db.Entry(a).Reference(x => x.Vehicle).LoadAsync(ct);
        if (a.DriverUserId.HasValue) await _db.Entry(a).Reference(x => x.DriverUser).LoadAsync(ct);
        return Ok(ApiResponse<VehicleAssignmentDto>.Ok(new VehicleAssignmentDto
        {
            Id = a.Id, TripInstanceId = a.TripInstanceId, VehicleId = a.VehicleId,
            VehicleName = a.Vehicle?.VehicleName, Registration = a.Vehicle?.Registration,
            Status = a.Status, RequestedDate = a.RequestedDate, ConfirmedDate = a.ConfirmedDate,
            DriverStaffId = a.DriverUserId,
            DriverName = a.DriverUser != null ? a.DriverUser.FirstName + " " + a.DriverUser.LastName : null,
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

/// <summary>
/// Staff CRUD, now backed by <see cref="User"/> post staff/user-unification — every staff member
/// IS a user account. Route name (<c>api/v1/staff</c>) is kept deliberately (design spec §2).
/// Listings (<see cref="GetAll"/>/<see cref="GetById"/>/<see cref="GetAvailable"/>) show ALL
/// active tenant users regardless of role, per design spec §4.2 — no role filter. Write endpoints
/// enforce the §4.1 guardrails: own-tenant only (free via <c>OdipDbContext</c>'s ambient
/// tenant query filter on every <c>_db.Users</c> read below — a non-SuperAdmin caller's queries
/// are already scoped to their own tenant, so a cross-tenant target id simply resolves to no row,
/// same as "not found"), cannot grant or edit a SuperAdmin account, and a Coordinator actor cannot
/// assign the Admin role (see <see cref="ValidateRoleGuardrails"/>).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/staff")]
public class StaffController : ControllerBase
{
    private readonly OdipDbContext _db;
    public StaffController(OdipDbContext db) => _db = db;

    /// <summary>
    /// §4.1 role-change guardrails. SuperAdmin actors are unrestricted. Anyone else: cannot touch
    /// (grant or edit) a SuperAdmin account, and cannot assign the Admin role unless they are
    /// themselves an Admin. <paramref name="existingRole"/> is null on create (there is no prior
    /// row to protect yet). Returns the rejection message, or null when the change is allowed.
    /// </summary>
    private string? ValidateRoleGuardrails(UserRole targetRole, UserRole? existingRole = null)
    {
        // User?.IsInRole(...) (not User.IsInRole(...)): ControllerBase.User is null when no
        // ControllerContext/HttpContext has been set (e.g. a unit test constructing this
        // controller directly with no simulated request) — defensive null-conditional, same idiom
        // MedicationsController/PortalController already use for the same reason. Treating an
        // absent context as "no elevated role" is the conservative default and never wrongly
        // allows a restricted write, since every real request IS authenticated ([Authorize]).
        bool IsInRole(string role) => User?.IsInRole(role) ?? false;

        if (IsInRole("SuperAdmin")) return null;
        if (existingRole == UserRole.SuperAdmin) return "Cannot edit a SuperAdmin account.";
        if (targetRole == UserRole.SuperAdmin) return "Cannot grant the SuperAdmin role.";
        if (targetRole == UserRole.Admin && !IsInRole("Admin")) return "Only an Admin can assign the Admin role.";
        return null;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<StaffListDto>>>> GetAll(
        [FromQuery] bool? isActive, CancellationToken ct)
    {
        var query = _db.Users.OrderBy(s => s.LastName).AsQueryable();
        if (isActive.HasValue) query = query.Where(s => s.IsActive == isActive.Value);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var items = await query
            .Select(s => new StaffListDto
            {
                Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
                FullName = s.FirstName + " " + s.LastName, Username = s.Username,
                Role = s.Role, Position = s.Position ?? Position.SupportWorker, Email = s.Email,
                Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
                IsFirstAidQualified = s.IsFirstAidQualified, IsMedicationCompetent = s.IsMedicationCompetent,
                IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
                IsActive = s.IsActive,
                FirstAidExpiryDate = s.FirstAidExpiryDate,
                DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
                ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
                MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
                WorkerScreeningNumber = s.WorkerScreeningNumber,
                WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
                Notes = s.Notes,
                HasExpiredQualifications =
                    (s.IsFirstAidQualified && s.FirstAidExpiryDate != null && s.FirstAidExpiryDate < today)
                    || (s.IsDriverEligible && s.DriverLicenceExpiryDate != null && s.DriverLicenceExpiryDate < today)
                    || (s.IsManualHandlingCompetent && s.ManualHandlingExpiryDate != null && s.ManualHandlingExpiryDate < today)
                    || (s.IsMedicationCompetent && s.MedicationCompetencyExpiryDate != null && s.MedicationCompetencyExpiryDate < today)
                    || (s.WorkerScreeningExpiryDate != null && s.WorkerScreeningExpiryDate < today)
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffListDto>>.Ok(items));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<StaffDetailDto>.Fail("Staff not found"));

        return Ok(ApiResponse<StaffDetailDto>.Ok(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            FullName = s.FirstName + " " + s.LastName, Username = s.Username,
            Role = s.Role, Position = s.Position ?? Position.SupportWorker, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = s.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
            HasExpiredQualifications = s.HasExpiredQualifications
        }));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> Create([FromBody] CreateStaffDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Email))
            return BadRequest(ApiResponse<StaffDetailDto>.Fail("Email is required."));

        var guardError = ValidateRoleGuardrails(dto.Role);
        if (guardError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(guardError));

        // Username/Email uniqueness is GLOBAL across tenants (design spec §2/§7) — IgnoreQueryFilters
        // so the check sees every tenant's users, not just the caller's own (matches AdminUsersController).
        var emailLower = dto.Email.Trim().ToLowerInvariant();
        var emailTaken = await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email.ToLower() == emailLower, ct);
        if (emailTaken) return Conflict(ApiResponse<StaffDetailDto>.Fail("A user with this email already exists."));

        // Collision-safe username handling: reuses the migration's own algorithm (Task 1's
        // StaffUserUnificationMapping.ResolveUsername) rather than duplicating a second,
        // divergent suffixing implementation here.
        var existingUsernamesList = await _db.Users.IgnoreQueryFilters()
            .Select(u => u.Username.ToLower()).ToListAsync(ct);
        var existingUsernames = existingUsernamesList.ToHashSet();
        var username = StaffUserUnificationMapping.ResolveUsername(dto.FirstName, dto.LastName, existingUsernames);

        var s = new User
        {
            Id = Guid.NewGuid(), FirstName = dto.FirstName, LastName = dto.LastName,
            Username = username, Email = dto.Email,
            Role = dto.Role, Position = dto.Position,
            Mobile = dto.Mobile, Region = dto.Region,
            IsDriverEligible = dto.IsDriverEligible, IsFirstAidQualified = dto.IsFirstAidQualified,
            IsMedicationCompetent = dto.IsMedicationCompetent, IsManualHandlingCompetent = dto.IsManualHandlingCompetent,
            IsOvernightEligible = dto.IsOvernightEligible, IsActive = dto.IsActive, Notes = dto.Notes,
            FirstAidExpiryDate = dto.FirstAidExpiryDate,
            DriverLicenceExpiryDate = dto.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = dto.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = dto.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = dto.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = dto.WorkerScreeningExpiryDate
        };
        _db.Users.Add(s);
        await _db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById), new { id = s.Id }, ApiResponse<StaffDetailDto>.Ok(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            FullName = s.FullName, Username = s.Username,
            Role = s.Role, Position = s.Position ?? Position.SupportWorker, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = s.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
            HasExpiredQualifications = s.HasExpiredQualifications
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> Update(Guid id, [FromBody] UpdateStaffDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Email))
            return BadRequest(ApiResponse<StaffDetailDto>.Fail("Email is required."));

        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<StaffDetailDto>.Fail("Staff not found"));

        var guardError = ValidateRoleGuardrails(dto.Role, existingRole: s.Role);
        if (guardError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(guardError));

        var emailLower = dto.Email.Trim().ToLowerInvariant();
        var emailTaken = await _db.Users.IgnoreQueryFilters()
            .AnyAsync(u => u.Id != id && u.Email.ToLower() == emailLower, ct);
        if (emailTaken) return Conflict(ApiResponse<StaffDetailDto>.Fail("A user with this email already exists."));

        s.FirstName = dto.FirstName; s.LastName = dto.LastName; s.Position = dto.Position; s.Role = dto.Role;
        s.Email = dto.Email; s.Mobile = dto.Mobile; s.Region = dto.Region;
        s.IsDriverEligible = dto.IsDriverEligible; s.IsFirstAidQualified = dto.IsFirstAidQualified;
        s.IsMedicationCompetent = dto.IsMedicationCompetent; s.IsManualHandlingCompetent = dto.IsManualHandlingCompetent;
        s.IsOvernightEligible = dto.IsOvernightEligible; s.IsActive = dto.IsActive;
        s.Notes = dto.Notes;
        s.FirstAidExpiryDate = dto.FirstAidExpiryDate;
        s.DriverLicenceExpiryDate = dto.DriverLicenceExpiryDate;
        s.ManualHandlingExpiryDate = dto.ManualHandlingExpiryDate;
        s.MedicationCompetencyExpiryDate = dto.MedicationCompetencyExpiryDate;
        s.WorkerScreeningNumber = dto.WorkerScreeningNumber;
        s.WorkerScreeningExpiryDate = dto.WorkerScreeningExpiryDate;
        s.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<StaffDetailDto>.Ok(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            FullName = s.FullName, Username = s.Username,
            Role = s.Role, Position = s.Position ?? Position.SupportWorker, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = s.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
            HasExpiredQualifications = s.HasExpiredQualifications
        }));
    }

    /// <summary>Archive (soft-delete) a staff member.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<bool>.Fail("Staff not found"));

        var guardError = ValidateRoleGuardrails(s.Role, existingRole: s.Role);
        if (guardError != null) return BadRequest(ApiResponse<bool>.Fail(guardError));

        s.IsActive = false; s.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Staff member archived"));
    }

    [HttpGet("{id:guid}/availability")]
    public async Task<ActionResult<ApiResponse<List<StaffAvailabilityDto>>>> GetAvailability(Guid id, CancellationToken ct)
    {
        var items = await _db.StaffAvailabilities.Where(a => a.UserId == id)
            .OrderBy(a => a.StartDateTime)
            .Select(a => new StaffAvailabilityDto
            {
                Id = a.Id, StaffId = a.UserId, StartDateTime = a.StartDateTime,
                EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
                IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffAvailabilityDto>>.Ok(items));
    }

    [HttpGet("{id:guid}/assignments")]
    public async Task<ActionResult<ApiResponse<List<StaffAssignmentDto>>>> GetAssignments(Guid id, CancellationToken ct)
    {
        var items = await _db.StaffAssignments.Include(a => a.TripInstance)
            .Where(a => a.UserId == id)
            .Select(a => new StaffAssignmentDto
            {
                Id = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance.TripName,
                StaffId = a.UserId, AssignmentRole = a.AssignmentRole,
                AssignmentStart = a.AssignmentStart, AssignmentEnd = a.AssignmentEnd,
                Status = a.Status, IsDriver = a.IsDriver, SleepoverType = a.SleepoverType,
                HasConflict = a.HasConflict,
                OverrideReason = a.OverrideReason, AcknowledgedFindingCodes = a.AcknowledgedFindingCodes
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
            .Select(a => a.UserId).Distinct().ToListAsync(ct);

        var items = await _db.Users.Where(s => s.IsActive && !unavailableStaffIds.Contains(s.Id))
            .Select(s => new StaffListDto
            {
                Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
                FullName = s.FirstName + " " + s.LastName, Username = s.Username,
                Role = s.Role, Position = s.Position ?? Position.SupportWorker,
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

    /// <summary>
    /// §4.4 same-tenant validation for the availability record's staff/user ref (required, not
    /// nullable, on this DTO): must resolve to an active User — same-tenant scoping comes for
    /// free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidStaffRefAsync(Guid userId, CancellationToken ct) =>
        _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct);

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAvailabilityDto>>> Create([FromBody] CreateStaffAvailabilityDto dto, CancellationToken ct)
    {
        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAvailabilityDto>.Fail("Staff member not found."));

        var a = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = dto.StaffId, StartDateTime = dto.StartDateTime,
            EndDateTime = dto.EndDateTime, AvailabilityType = dto.AvailabilityType,
            IsRecurring = dto.IsRecurring, RecurrenceNotes = dto.RecurrenceNotes, Notes = dto.Notes
        };
        _db.StaffAvailabilities.Add(a);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<StaffAvailabilityDto>.Ok(new StaffAvailabilityDto
        {
            Id = a.Id, StaffId = a.UserId, StartDateTime = a.StartDateTime,
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

        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAvailabilityDto>.Fail("Staff member not found."));

        a.StartDateTime = dto.StartDateTime; a.EndDateTime = dto.EndDateTime;
        a.AvailabilityType = dto.AvailabilityType; a.IsRecurring = dto.IsRecurring;
        a.RecurrenceNotes = dto.RecurrenceNotes; a.Notes = dto.Notes; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<StaffAvailabilityDto>.Ok(new StaffAvailabilityDto
        {
            Id = a.Id, StaffId = a.UserId, StartDateTime = a.StartDateTime,
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
    private readonly IStaffUnavailabilityQuery _unavailabilityQuery;
    private readonly RosterConflictService _conflictService = new();

    public StaffAssignmentsController(OdipDbContext db, IStaffUnavailabilityQuery unavailabilityQuery)
    {
        _db = db;
        _unavailabilityQuery = unavailabilityQuery;
    }

    /// <summary>
    /// §4.4 same-tenant validation for the trip staffing assignment's staff/user ref (required,
    /// not nullable, on this DTO): must resolve to an active User — same-tenant scoping comes for
    /// free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidStaffRefAsync(Guid userId, CancellationToken ct) =>
        _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct);

    /// <summary>
    /// Builds the RosterCheckContext for a candidate trip assignment and runs
    /// RosterConflictService.CheckStaffAssignment — the trip-side analogue of
    /// RosteringController.CheckAsync. Participant is left null: a trip assignment has no
    /// participant-scoped rules to evaluate. excludeAssignmentId is the assignment's own prior Id
    /// on an update (or Guid.Empty for a brand-new candidate / the dry-run check), so an
    /// assignment never conflicts with itself.
    /// </summary>
    private async Task<List<RosterFinding>> CheckAsync(
        Guid staffId, DateOnly assignmentStart, DateOnly assignmentEnd, Guid excludeAssignmentId, CancellationToken ct)
    {
        var staff = await _db.Users.FirstOrDefaultAsync(u => u.Id == staffId, ct);
        if (staff is null)
            return new List<RosterFinding>();

        var staffShiftsInWindow = await _db.Shifts
            .Where(s => s.UserId == staffId && s.ServiceDate >= assignmentStart && s.ServiceDate <= assignmentEnd)
            .ToListAsync(ct);

        var otherTripAssignments = await _db.StaffAssignments
            .Where(a => a.UserId == staffId && a.Id != excludeAssignmentId && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= assignmentEnd && a.AssignmentEnd >= assignmentStart)
            .ToListAsync(ct);

        var availability = await _unavailabilityQuery.GetWindowsAsync(new[] { staffId }, assignmentStart, assignmentEnd, ct);

        var ctx = new RosterCheckContext(staff, null, staffShiftsInWindow, Array.Empty<Shift>(),
            otherTripAssignments, availability, CompatibilityLevel.Allowed, RosterConflictService.DefaultWeeklyHoursThreshold);

        return _conflictService.CheckStaffAssignment(assignmentStart, assignmentEnd, excludeAssignmentId, ctx).ToList();
    }

    /// <summary>Dry-run findings for a candidate trip assignment. Never writes — mirrors POST /rostering/shifts/check.</summary>
    [HttpPost("check")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<RosterFindingDto>>>> Check([FromBody] CheckStaffAssignmentDto dto, CancellationToken ct)
    {
        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<List<RosterFindingDto>>.Fail("Staff member not found."));

        var findings = await CheckAsync(dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, dto.ExcludeAssignmentId ?? Guid.Empty, ct);
        return Ok(ApiResponse<List<RosterFindingDto>>.Ok(findings.Select(RosterGate.ToFindingDto).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Create([FromBody] CreateStaffAssignmentDto dto, CancellationToken ct)
    {
        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAssignmentDto>.Fail("Staff member not found."));

        var findings = await CheckAsync(dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, Guid.Empty, ct);
        var rejection = RosterGate.EvaluateFindings(findings, dto.OverrideReason, "trip assignment");
        if (rejection != null) return UnprocessableEntity(rejection);

        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId, UserId = dto.StaffId,
            AssignmentRole = dto.AssignmentRole, AssignmentStart = dto.AssignmentStart,
            AssignmentEnd = dto.AssignmentEnd, IsDriver = dto.IsDriver,
            SleepoverType = dto.SleepoverType, ShiftNotes = dto.ShiftNotes
        };

        var (overrideReason, codes) = RosterGate.ComputeOverride(findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
        assignment.OverrideReason = overrideReason;
        assignment.AcknowledgedFindingCodes = codes;
        assignment.HasConflict = overrideReason != null;

        _db.StaffAssignments.Add(assignment);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(assignment).Reference(a => a.TripInstance).LoadAsync(ct);
        await _db.Entry(assignment).Reference(a => a.User).LoadAsync(ct);
        return Ok(ApiResponse<StaffAssignmentDto>.Ok(new StaffAssignmentDto
        {
            Id = assignment.Id, TripInstanceId = assignment.TripInstanceId, TripName = assignment.TripInstance?.TripName,
            StaffId = assignment.UserId,
            StaffName = assignment.User != null ? assignment.User.FirstName + " " + assignment.User.LastName : null,
            AssignmentRole = assignment.AssignmentRole, AssignmentStart = assignment.AssignmentStart, AssignmentEnd = assignment.AssignmentEnd,
            Status = assignment.Status, IsDriver = assignment.IsDriver, SleepoverType = assignment.SleepoverType,
            ShiftNotes = assignment.ShiftNotes, HasConflict = assignment.HasConflict,
            OverrideReason = assignment.OverrideReason, AcknowledgedFindingCodes = assignment.AcknowledgedFindingCodes
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Update(Guid id, [FromBody] UpdateStaffAssignmentDto dto, CancellationToken ct)
    {
        var a = await _db.StaffAssignments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<StaffAssignmentDto>.Fail("Assignment not found"));

        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAssignmentDto>.Fail("Staff member not found."));

        var findings = await CheckAsync(dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, a.Id, ct);
        var rejection = RosterGate.EvaluateFindings(findings, dto.OverrideReason, "trip assignment");
        if (rejection != null) return UnprocessableEntity(rejection);

        a.UserId = dto.StaffId; a.AssignmentRole = dto.AssignmentRole;
        a.AssignmentStart = dto.AssignmentStart; a.AssignmentEnd = dto.AssignmentEnd;
        a.IsDriver = dto.IsDriver; a.SleepoverType = dto.SleepoverType;
        a.ShiftNotes = dto.ShiftNotes; a.Status = dto.Status; a.UpdatedAt = DateTime.UtcNow;

        var (overrideReason, codes) = RosterGate.ComputeOverride(findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
        a.OverrideReason = overrideReason;
        a.AcknowledgedFindingCodes = codes;
        a.HasConflict = overrideReason != null;

        await _db.SaveChangesAsync(ct);
        await _db.Entry(a).Reference(x => x.TripInstance).LoadAsync(ct);
        await _db.Entry(a).Reference(x => x.User).LoadAsync(ct);
        return Ok(ApiResponse<StaffAssignmentDto>.Ok(new StaffAssignmentDto
        {
            Id = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance?.TripName,
            StaffId = a.UserId, StaffName = a.User != null ? a.User.FirstName + " " + a.User.LastName : null,
            AssignmentRole = a.AssignmentRole, AssignmentStart = a.AssignmentStart, AssignmentEnd = a.AssignmentEnd,
            Status = a.Status, IsDriver = a.IsDriver, SleepoverType = a.SleepoverType,
            ShiftNotes = a.ShiftNotes, HasConflict = a.HasConflict,
            OverrideReason = a.OverrideReason, AcknowledgedFindingCodes = a.AcknowledgedFindingCodes
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
