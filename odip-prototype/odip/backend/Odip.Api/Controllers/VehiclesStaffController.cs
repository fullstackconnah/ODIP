using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

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
                HasOverlapConflict = a.HasOverlapConflict, HasConflict = a.HasConflict,
                OverrideReason = a.OverrideReason, AcknowledgedFindingCodes = a.AcknowledgedFindingCodes
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
    private readonly RosterConflictService _conflictService = new();
    private readonly TimeProvider _clock;
    public VehicleAssignmentsController(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>
    /// §4.4 same-tenant validation for the driver picker: null is always fine (no driver
    /// assigned yet), otherwise the id must resolve to an active User — same-tenant scoping comes
    /// for free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidDriverRefAsync(Guid? driverUserId, CancellationToken ct) =>
        driverUserId.HasValue
            ? _db.Users.AnyAsync(u => u.Id == driverUserId.Value && u.IsActive, ct)
            : Task.FromResult(true);

    /// <summary>
    /// Builds the VehicleCheckContext for a candidate VehicleAssignment and runs
    /// RosterConflictService.CheckVehicleAssignment — the vehicle-side analogue of
    /// StaffAssignmentsController.CheckAsync. excludeAssignmentId is the assignment's own prior Id
    /// on an update (or Guid.Empty for a brand-new candidate / the dry-run check), so an
    /// assignment never conflicts with itself. Returns an empty list (nothing to check against) if
    /// the vehicle or trip can't be resolved — the caller's own NotFound checks handle that case.
    /// </summary>
    private async Task<List<RosterFinding>> CheckAsync(
        Guid vehicleId, Guid tripInstanceId, Guid excludeAssignmentId, CancellationToken ct)
    {
        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.Id == vehicleId, ct);
        var trip = await _db.TripInstances.FirstOrDefaultAsync(t => t.Id == tripInstanceId, ct);
        if (vehicle is null || trip is null)
            return new List<RosterFinding>();

        var tripStart = trip.StartDate;
        var tripEnd = trip.StartDate.AddDays(trip.DurationDays - 1);

        var otherAssignments = await _db.VehicleAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.VehicleId == vehicleId && a.Id != excludeAssignmentId
                && a.Status != VehicleAssignmentStatus.Cancelled && a.Status != VehicleAssignmentStatus.Unavailable)
            .Select(a => new VehicleAssignmentWindow(a.Id, a.TripInstance.StartDate, a.TripInstance.StartDate.AddDays(a.TripInstance.DurationDays - 1)))
            .ToListAsync(ct);

        var participantCount = await _db.ParticipantBookings
            .CountAsync(b => b.TripInstanceId == tripInstanceId && b.BookingStatus == BookingStatus.Confirmed, ct);
        var wheelchairCount = await _db.ParticipantBookings
            .CountAsync(b => b.TripInstanceId == tripInstanceId && b.BookingStatus == BookingStatus.Confirmed && b.WheelchairRequired, ct);

        var ctx = new VehicleCheckContext(vehicle, otherAssignments, participantCount, wheelchairCount);

        return _conflictService.CheckVehicleAssignment(tripStart, tripEnd, excludeAssignmentId, ctx).ToList();
    }

    /// <summary>Dry-run findings for a candidate vehicle assignment. Never writes — mirrors POST /staff-assignments/check.</summary>
    [HttpPost("check")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<RosterFindingDto>>>> Check([FromBody] CheckVehicleAssignmentDto dto, CancellationToken ct)
    {
        var findings = await CheckAsync(dto.VehicleId, dto.TripInstanceId, dto.ExcludeAssignmentId ?? Guid.Empty, ct);
        return Ok(ApiResponse<List<RosterFindingDto>>.Ok(findings.Select(RosterGate.ToFindingDto).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleAssignmentDto>>> Create([FromBody] CreateVehicleAssignmentDto dto, CancellationToken ct)
    {
        var trip = await _db.TripInstances.FirstOrDefaultAsync(t => t.Id == dto.TripInstanceId, ct);
        if (trip == null) return NotFound(ApiResponse<VehicleAssignmentDto>.Fail("Trip not found"));

        if (!await IsValidDriverRefAsync(dto.DriverStaffId, ct))
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail("Driver not found."));

        var findings = await CheckAsync(dto.VehicleId, dto.TripInstanceId, Guid.Empty, ct);
        var rejection = RosterGate.EvaluateFindings(findings, dto.OverrideReason, "vehicle assignment");
        if (rejection != null) return UnprocessableEntity(rejection);

        var assignment = new VehicleAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = dto.TripInstanceId, VehicleId = dto.VehicleId,
            DriverUserId = dto.DriverStaffId, SeatRequirement = dto.SeatRequirement,
            WheelchairPositionRequirement = dto.WheelchairPositionRequirement,
            PickupTravelNotes = dto.PickupTravelNotes, Comments = dto.Comments,
            RequestedDate = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct)
        };

        var (overrideReason, codes) = RosterGate.ComputeOverride(findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
        assignment.OverrideReason = overrideReason;
        assignment.AcknowledgedFindingCodes = codes;
        assignment.HasConflict = overrideReason != null;
        // VEHICLE_DOUBLE_BOOKED is Blocking, so EvaluateFindings above already rejected the write
        // if it fired — this can only ever be false on a row that actually gets saved. Derived
        // from the same findings the gate ran, not a second, independently-computed overlap query.
        assignment.HasOverlapConflict = findings.Any(f => f.Code == RosterConflictService.VehicleDoubleBooked);

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
            PickupTravelNotes = assignment.PickupTravelNotes, Comments = assignment.Comments,
            HasOverlapConflict = assignment.HasOverlapConflict, HasConflict = assignment.HasConflict,
            OverrideReason = assignment.OverrideReason, AcknowledgedFindingCodes = assignment.AcknowledgedFindingCodes
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

        // Cancelling via PUT mirrors StaffAssignmentsController.Update: a Cancelled row is excluded
        // from every conflict query (see the otherAssignments filter in CheckAsync), so demanding an
        // override reason to cancel is a trap. Skip the gate entirely and leave OverrideReason/
        // AcknowledgedFindingCodes/HasConflict/HasOverlapConflict untouched.
        var isCancelling = dto.Status == VehicleAssignmentStatus.Cancelled;

        if (!isCancelling)
        {
            var findings = await CheckAsync(dto.VehicleId, a.TripInstanceId, a.Id, ct);
            var rejection = RosterGate.EvaluateFindings(findings, dto.OverrideReason, "vehicle assignment");
            if (rejection != null) return UnprocessableEntity(rejection);

            var (overrideReason, codes) = RosterGate.ComputeOverride(findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
            a.OverrideReason = overrideReason;
            a.AcknowledgedFindingCodes = codes;
            a.HasConflict = overrideReason != null;
            a.HasOverlapConflict = findings.Any(f => f.Code == RosterConflictService.VehicleDoubleBooked);
        }

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
            PickupTravelNotes = a.PickupTravelNotes, Comments = a.Comments,
            HasOverlapConflict = a.HasOverlapConflict, HasConflict = a.HasConflict,
            OverrideReason = a.OverrideReason, AcknowledgedFindingCodes = a.AcknowledgedFindingCodes
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
    private readonly IStaffAvailabilityItemsQuery _availabilityItemsQuery;
    private readonly Microsoft.Extensions.Configuration.IConfiguration? _config;
    // The request's clock: a test fixes it. Every calendar rule uses the PROVIDER's date from it (ProviderTimeZoneResolver.TodayAsync), never the UTC date.
    private readonly TimeProvider _clock;
    private readonly IFirebaseUserService _firebaseUserService;
    private readonly ILogger<StaffController>? _logger;
    // The tenant this request writes to (the caller's own, or the one a SuperAdmin is viewing as). Null when there is none: a SuperAdmin
    // with no tenant selected, and a test that does not care.
    private readonly ICurrentTenant? _currentTenant;

    private const string OtherOrganisationMessage = "That address belongs to another organisation on ODIP.";

    /// <summary>
    /// Global uniqueness of an address makes a squat permanent (the first tenant to type an address owns it, and an archived row keeps it), so a
    /// caller who is not a SuperAdmin may not give staff an address at ANOTHER tenant's own email domain: it would block that tenant from ever adding
    /// the person, and send the person into this tenant's workspace. Returns the refusal, or null. It is a refusal, not a question: it cannot be
    /// confirmed away. The match is on the whole domain, so a subdomain is only unusual (AddressConfirmation), not another organisation's. A shared
    /// provider (gmail.com) is nobody's own, even if a tenant was given it as its domain, so it is never another organisation's either.
    /// </summary>
    private async Task<string?> OtherOrganisationAddressErrorAsync(string normalisedEmail, Guid? ownTenantId, CancellationToken ct)
    {
        if (User?.IsInRole("SuperAdmin") ?? false) return null;
        var at = normalisedEmail.LastIndexOf('@');
        if (at < 0) return null;

        var domain = normalisedEmail[(at + 1)..];
        if (CommonEmailProviders.Covers(domain)) return null;
        var own = ownTenantId ?? Guid.Empty;
        // Tenants are written with their domain tidied (EmailIdentity.NormaliseDomain), but a row from before that rule may hold " Acme.com" or "@acme.com"
        // and must keep protecting its tenant, so the stored side is tidied the same way here. There are few tenants, so they are compared in memory
        // rather than by an expression the database has to translate.
        var otherDomains = await _db.Tenants.Where(t => t.Id != own).Select(t => t.EmailDomain).ToListAsync(ct);
        var belongsToAnother = otherDomains.Any(other => EmailIdentity.NormaliseDomain(other) == domain);
        return belongsToAnother ? OtherOrganisationMessage : null;
    }

    /// <summary>The email domain of a tenant, or null when none is given or it cannot be found. Tenants have no query filter, so any tenant is readable.</summary>
    private async Task<string?> TenantEmailDomainAsync(Guid? tenantId, CancellationToken ct) =>
        tenantId is null ? null : await _db.Tenants.Where(t => t.Id == tenantId).Select(t => t.EmailDomain).FirstOrDefaultAsync(ct);

    // IFirebaseUserService is intentionally NOT registered in Program.cs — see AdminUsersController: ActivatorUtilities falls back to the
    // parameter's default, so production needs no DI change while a unit test injects a mock.
    public StaffController(
        OdipDbContext db, IStaffAvailabilityItemsQuery? availabilityItemsQuery = null,
        Microsoft.Extensions.Configuration.IConfiguration? config = null, TimeProvider? clock = null,
        IFirebaseUserService? firebaseUserService = null, ILogger<StaffController>? logger = null, ICurrentTenant? currentTenant = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
        _availabilityItemsQuery = availabilityItemsQuery ?? new StaffAvailabilityItemsQuery(db);
        _config = config;
        _firebaseUserService = firebaseUserService ?? new FirebaseUserService();
        _logger = logger;
        _currentTenant = currentTenant;
    }

    /// <summary>Same default as RosteringController's own VarianceReviewMinutes — kept independent
    /// rather than shared so the two controllers can't accidentally couple on a private property.</summary>
    private int VarianceReviewMinutes => _config?.GetValue<int>("Rostering:VarianceReviewMinutes", 15) ?? 15;

    private static StaffDetailDto ToStaffDetailDto(User s, DateOnly today) => new()
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
        HasExpiredQualifications = s.HasExpiredQualificationsOn(today)
    };

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

    /// <summary>
    /// An address on <c>Auth:SuperAdminDomain</c> signs in as SuperAdmin whatever the user's Role (AuthController.Exchange), so only a
    /// SuperAdmin may enter one. Returns the refusal, or null when <paramref name="normalisedEmail"/> is allowed for this caller.
    /// </summary>
    private string? ReservedDomainError(string normalisedEmail)
    {
        if (User?.IsInRole("SuperAdmin") ?? false) return null;
        var domain = SuperAdminDomain.From(_config);
        return SuperAdminDomain.Covers(normalisedEmail, domain) ? SuperAdminDomain.ReservedMessage(domain) : null;
    }

    /// <summary>
    /// A row that already holds an address on <c>Auth:SuperAdminDomain</c> is a SuperAdmin session whatever its Role, whenever it is active
    /// (AuthController.Exchange). Archiving a row only sets IsActive = false and never touches Firebase, so a tenant caller who could bring one
    /// back to life, or change its role, would hand a platform session to whoever still owns that mailbox. Returns the refusal, or null: for a
    /// SuperAdmin, for a row not on that domain, and for any change that only takes capability away or touches other fields (the carve-out in
    /// <see cref="Update"/> that keeps legacy rows editable).
    /// </summary>
    private string? ReservedRowChangeError(User row, bool becomesActive, UserRole newRole)
    {
        if (User?.IsInRole("SuperAdmin") ?? false) return null;
        var domain = SuperAdminDomain.From(_config);
        if (!SuperAdminDomain.Covers(EmailIdentity.Normalise(row.Email), domain)) return null;
        var reactivating = !row.IsActive && becomesActive;
        var changingRole = newRole != row.Role;
        return reactivating || changingRole ? SuperAdminDomain.ReservedRowMessage(domain) : null;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<StaffListDto>>>> GetAll(
        [FromQuery] bool? isActive, CancellationToken ct)
    {
        var query = _db.Users.OrderBy(s => s.LastName).AsQueryable();
        if (isActive.HasValue) query = query.Where(s => s.IsActive == isActive.Value);

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
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

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
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
            HasExpiredQualifications = s.HasExpiredQualificationsOn(today)
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
        var emailLower = EmailIdentity.Normalise(dto.Email);
        var reservedError = ReservedDomainError(emailLower);
        if (reservedError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(reservedError));

        var otherOrganisationError = await OtherOrganisationAddressErrorAsync(emailLower, _currentTenant?.TenantId, ct);
        if (otherOrganisationError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(otherOrganisationError));

        var emailTaken = await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email.ToLower() == emailLower, ct);
        if (emailTaken) return Conflict(ApiResponse<StaffDetailDto>.Fail("A user with this email already exists."));

        // Any address can sign in, so one at neither the tenant's own domain nor a common provider (a typo, another organisation's) is a live
        // login for whoever owns it: ask for a confirmation first (see AddressConfirmation).
        var tenantDomain = await TenantEmailDomainAsync(_currentTenant?.TenantId, ct);
        if (tenantDomain is not null && !dto.AddressConfirmed && AddressConfirmation.Needed(emailLower, tenantDomain))
            return BadRequest(ApiResponse<StaffDetailDto>.Fail(AddressConfirmation.Message(emailLower, tenantDomain), AddressConfirmation.Code));

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
            Username = username, Email = emailLower,
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
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
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
            HasExpiredQualifications = s.HasExpiredQualificationsOn(today)
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

        // A row already on the SuperAdmin domain may not be brought back to life, or have its role changed, by a tenant caller.
        var reservedRowError = ReservedRowChangeError(s, becomesActive: dto.IsActive, newRole: dto.Role);
        if (reservedRowError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(reservedRowError));

        var emailLower = EmailIdentity.Normalise(dto.Email);
        var addressChanged = emailLower != EmailIdentity.Normalise(s.Email);
        // Only when the address is being CHANGED: an edit to some other field of a row that already holds such an address (the role guardrail
        // above is what keeps a tenant caller off SuperAdmin accounts) must not start failing because of the address.
        if (addressChanged)
        {
            // Once a row has signed in its address is a working identity: re-pointing it at another mailbox lets that mailbox's owner ask for the
            // set-password link and sign in AS this person, with the row's role, history and attribution, and locks the person out. Before the first
            // sign-in it is only a typo to fix, so that stays open to everyone who may edit staff.
            if (s.LastLoginAt is not null && !((User?.IsInRole("Admin") ?? false) || (User?.IsInRole("SuperAdmin") ?? false)))
                return StatusCode(StatusCodes.Status403Forbidden,
                    ApiResponse<StaffDetailDto>.Fail("Only an Admin can change the address of someone who has already signed in."));

            var reservedError = ReservedDomainError(emailLower);
            if (reservedError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(reservedError));

            var otherOrganisationError = await OtherOrganisationAddressErrorAsync(emailLower, s.TenantId, ct);
            if (otherOrganisationError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(otherOrganisationError));
        }

        var emailTaken = await _db.Users.IgnoreQueryFilters()
            .AnyAsync(u => u.Id != id && u.Email.ToLower() == emailLower, ct);
        if (emailTaken) return Conflict(ApiResponse<StaffDetailDto>.Fail("A user with this email already exists."));

        // A NEW address at neither the tenant's own domain nor a common provider needs a confirmation (see AddressConfirmation). An address the
        // row already holds never does, so legacy rows stay editable.
        if (addressChanged && !dto.AddressConfirmed)
        {
            var rowTenantDomain = await TenantEmailDomainAsync(s.TenantId, ct);
            if (rowTenantDomain is not null && AddressConfirmation.Needed(emailLower, rowTenantDomain))
                return BadRequest(ApiResponse<StaffDetailDto>.Fail(AddressConfirmation.Message(emailLower, rowTenantDomain), AddressConfirmation.Code));
        }

        s.FirstName = dto.FirstName; s.LastName = dto.LastName; s.Position = dto.Position; s.Role = dto.Role;
        s.Email = emailLower; s.Mobile = dto.Mobile; s.Region = dto.Region;
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
        // The address is the whole of this person's sign-in, so a change leaves a trace: who changed whose, never the addresses themselves.
        if (addressChanged)
            _logger?.LogInformation("The sign-in address of staff member {TargetUserId} was changed by {ActorUserId}", s.Id, User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown");
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
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
            HasExpiredQualifications = s.HasExpiredQualificationsOn(today)
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

    /// <summary>
    /// Makes sure this staff member has a Firebase sign-in account (creating a verified, passwordless one when there is none) and says
    /// which, so the browser can then send the set-password email and word it truthfully. Create writes only the user row, so a staff
    /// member added here has had no account until this runs. An account that already exists is left exactly as it is. Tenant-scoped like
    /// every other staff write: a row in another tenant is simply not found.
    /// </summary>
    [HttpPost("{id:guid}/sign-in-account")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<SignInAccountDto>>> EnsureSignInAccount(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<SignInAccountDto>.Fail("Staff not found"));

        // The same §4.1 guardrail as every other staff write: only a SuperAdmin touches a SuperAdmin account.
        if (s.Role == UserRole.SuperAdmin && !(User?.IsInRole("SuperAdmin") ?? false))
            return BadRequest(ApiResponse<SignInAccountDto>.Fail("Cannot edit a SuperAdmin account."));

        if (!s.IsActive)
            return BadRequest(ApiResponse<SignInAccountDto>.Fail("This staff member is inactive, so they cannot be given a sign-in account."));

        if (string.IsNullOrWhiteSpace(s.Email))
            return BadRequest(ApiResponse<SignInAccountDto>.Fail("This staff member has no email address."));

        var email = EmailIdentity.Normalise(s.Email);

        // An address the app invented for a row that had none (see PlaceholderEmail) can never receive the link, so no account is made for it.
        if (PlaceholderEmail.Covers(email))
            return BadRequest(ApiResponse<SignInAccountDto>.Fail(PlaceholderEmail.Message(s.FullName)));

        var reservedError = ReservedDomainError(email);
        if (reservedError != null) return BadRequest(ApiResponse<SignInAccountDto>.Fail(reservedError));

        try
        {
            var result = await _firebaseUserService.EnsureSignInAccountAsync(email, s.FullName, ct);
            var account = result == SignInAccountResult.Created ? FirebaseAccountStatus.Created : FirebaseAccountStatus.Existing;
            // No audit record exists yet (the email itself goes from the browser to Firebase), so this line is the only trace of who asked for it.
            _logger?.LogInformation("Sign-in account for user {TargetUserId} was {Account}, as asked by {ActorUserId}", s.Id, account, User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown");
            return Ok(ApiResponse<SignInAccountDto>.Ok(new SignInAccountDto(account)));
        }
        catch (Exception ex) when (FirebaseFailures.IsInvalidEmail(ex))
        {
            // Firebase refused the address itself (a legacy row with a typo). Retrying cannot fix that and correcting the address can, so it is the
            // admin's to act on (400), not a fault on our side (502).
            _logger?.LogWarning("Firebase refused the address of staff member {UserId} as invalid", s.Id);
            return BadRequest(ApiResponse<SignInAccountDto>.Fail("That doesn't look like a valid email address. Correct it first."));
        }
        catch (Exception ex)
        {
            // Deliberately broad, as in AdminUsersController.Create: an unusable service account is not a FirebaseAuthException, and the
            // same call with no Firebase app configured fails the same way, so it is the same 502. The line says where to turn rather than
            // promising a retry will help: an unusable service account stays unusable.
            _logger?.LogError(ex, "Failed to ensure a Firebase sign-in account for {Email}", email);
            return StatusCode(StatusCodes.Status502BadGateway,
                ApiResponse<SignInAccountDto>.Fail("Unable to set up the staff member's sign-in account. If it keeps happening, ask whoever runs the Firebase project."));
        }
    }

    /// <summary>
    /// Connection map item 12 — the staff hub's single data source: the staff record plus five
    /// pre-joined collections, each built from exactly one query (no per-row queries). 404s if
    /// <paramref name="id"/> isn't in the caller's tenant — same as GetById, for free from
    /// _db.Users' ambient tenant query filter.
    /// </summary>
    [HttpGet("{id:guid}/overview")]
    public async Task<ActionResult<ApiResponse<StaffOverviewDto>>> GetOverview(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<StaffOverviewDto>.Fail("Staff not found"));

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var staffIds = new List<Guid> { id };

        // Availability: shared with ScheduleController.GetScheduleOverview via
        // IStaffAvailabilityItemsQuery (pure move, connection map item 12).
        var availabilityByStaff = await _availabilityItemsQuery.GetAsync(staffIds, today, today.AddDays(90), ct);
        var availability = availabilityByStaff[id].ToList();

        var upcomingShiftStatuses = new[] { ShiftStatus.Published, ShiftStatus.InProgress, ShiftStatus.PendingReview };
        var upcomingShiftsWindowEnd = today.AddDays(14);
        var upcomingShifts = await _db.Shifts
            .Where(sh => sh.UserId == id && sh.ServiceDate >= today && sh.ServiceDate <= upcomingShiftsWindowEnd
                         && upcomingShiftStatuses.Contains(sh.Status))
            .OrderBy(sh => sh.ServiceDate).ThenBy(sh => sh.StartTime)
            .Select(sh => new StaffOverviewUpcomingShiftDto
            {
                ShiftId = sh.Id, ServiceDate = sh.ServiceDate, StartTime = sh.StartTime, EndTime = sh.EndTime,
                EndsNextDay = sh.EndsNextDay, ParticipantId = sh.ParticipantId,
                ParticipantName = sh.Participant != null ? sh.Participant.FullName : string.Empty,
                Status = sh.Status
            })
            .ToListAsync(ct);

        // "trips ending today or later" — same Cancelled exclusion RosteringController.GetBoard
        // and ScheduleController use for the same StaffAssignments table.
        var upcomingTripAssignments = await _db.StaffAssignments
            .Where(a => a.UserId == id && a.Status != AssignmentStatus.Cancelled && a.AssignmentEnd >= today)
            .OrderBy(a => a.AssignmentStart)
            .Select(a => new StaffOverviewTripAssignmentDto
            {
                AssignmentId = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance.TripName,
                StartDate = a.AssignmentStart, EndDate = a.AssignmentEnd
            })
            .ToListAsync(ct);

        // Newest 10 active incidents where this staff member is the INVOLVED user, not the
        // reporter — same projection shape as IncidentsController.GetAll.
        var recentIncidents = await _db.IncidentReports
            .Where(i => i.InvolvedUserId == id && i.IsActive)
            .OrderByDescending(i => i.IncidentDateTime)
            .Take(10)
            .Select(IncidentProjections.ToListDto(DateTime.UtcNow))
            .ToListAsync(ct);

        // Last 10 completions this staff member SUBMITTED (Shift.UserId at Start/manual-Finish
        // time — see ShiftCompletion.SubmittedByUserId), newest first. The shift/completion
        // projection itself is ShiftCompletionMapper.BuildQueueItemsAsync — the same one
        // RosteringController.GetCompletions uses for the coordinator's review queue — so this
        // reuses that timezone-aware variance calc rather than duplicating it; the "newest 10"
        // selection and ordering happen here since BuildQueueItemsAsync doesn't sort.
        var recentCompletionShiftIds = await _db.ShiftCompletions
            .Where(c => c.SubmittedByUserId == id && c.IsActive)
            .OrderByDescending(c => c.SubmittedAt ?? c.StartedAt)
            .Take(10)
            .Select(c => c.ShiftId)
            .ToListAsync(ct);
        var recentCompletionRank = recentCompletionShiftIds
            .Select((shiftId, index) => (shiftId, index))
            .ToDictionary(x => x.shiftId, x => x.index);
        var recentCompletionsQuery = _db.Shifts.Where(sh => recentCompletionShiftIds.Contains(sh.Id));
        var recentCompletions = (await Odip.Api.Rostering.ShiftCompletionMapper.BuildQueueItemsAsync(
                _db, recentCompletionsQuery, VarianceReviewMinutes, ct))
            .OrderBy(c => recentCompletionRank.GetValueOrDefault(c.ShiftId, int.MaxValue))
            .ToList();

        return Ok(ApiResponse<StaffOverviewDto>.Ok(new StaffOverviewDto
        {
            Staff = ToStaffDetailDto(s, today),
            Availability = availability,
            UpcomingShifts = upcomingShifts,
            UpcomingTripAssignments = upcomingTripAssignments,
            RecentIncidents = recentIncidents,
            RecentCompletions = recentCompletions
        }));
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

    [HttpGet]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<StaffAvailabilityDto>>>> GetAll(
        [FromQuery] Guid? userId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        // StaffAvailability is not a tenant-scoped entity (no ITenantEntity, no HasQueryFilter),
        // so scope rows to the caller's tenant by joining through the filtered Users set —
        // same-tenant scoping comes for free from _db.Users' ambient OdipDbContext query filter.
        // StaffAvailability is not a tenant-scoped entity (no ITenantEntity, no HasQueryFilter),
        // so scope rows to the caller's tenant by joining through the filtered Users set —
        // same-tenant scoping comes for free from _db.Users' ambient OdipDbContext query filter.
        var query = _db.StaffAvailabilities.Where(a => _db.Users.Any(u => u.Id == a.UserId)).AsQueryable();
        if (userId.HasValue) query = query.Where(a => a.UserId == userId.Value);
        if (from.HasValue) query = query.Where(a => a.EndDateTime >= from.Value.ToDateTime(TimeOnly.MinValue));
        if (to.HasValue) query = query.Where(a => a.StartDateTime <= to.Value.ToDateTime(TimeOnly.MaxValue));

        var items = await query
            .OrderByDescending(a => a.StartDateTime)
            .Select(a => new StaffAvailabilityDto
            {
                Id = a.Id, StaffId = a.UserId, StartDateTime = a.StartDateTime,
                EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
                IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffAvailabilityDto>>.Ok(items));
    }

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

        // Pad one day before assignmentStart so an overnight/sleepover shift that starts the evening
        // before the trip and ends after midnight (EndsNextDay = true) is still fetched — the domain
        // overlap math in RosterConflictService.CheckStaffAssignment already discards a day-before
        // shift that does not actually cross midnight into the window.
        var staffShiftsInWindow = await _db.Shifts
            .Where(s => s.UserId == staffId && s.ServiceDate >= assignmentStart.AddDays(-1) && s.ServiceDate <= assignmentEnd)
            .ToListAsync(ct);

        var otherTripAssignments = await _db.StaffAssignments
            .Where(a => a.UserId == staffId && a.Id != excludeAssignmentId && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= assignmentEnd && a.AssignmentEnd >= assignmentStart)
            .ToListAsync(ct);

        var availability = await _unavailabilityQuery.GetWindowsAsync(new[] { staffId }, assignmentStart, assignmentEnd, ct);

        // No PublicHolidays load here (connection-map item 8): RosterConflictService.CheckStaffAssignment
        // never reads ctx.PublicHolidays — trips already price holidays in claims and span multiple
        // days, so they don't get a PUBLIC_HOLIDAY finding — so loading them for a trip assignment
        // check would be a pure-waste DB round trip. Leaving the parameter unset defaults it to null.
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

        // Cancelling via PUT mirrors Delete: a Cancelled row is excluded from every conflict query
        // (see the otherTripAssignments filter in CheckAsync), so demanding an override reason to
        // cancel is a trap. Skip the gate entirely and leave OverrideReason/AcknowledgedFindingCodes/
        // HasConflict untouched.
        var isCancelling = dto.Status == AssignmentStatus.Cancelled;

        if (!isCancelling)
        {
            var findings = await CheckAsync(dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, a.Id, ct);
            var rejection = RosterGate.EvaluateFindings(findings, dto.OverrideReason, "trip assignment");
            if (rejection != null) return UnprocessableEntity(rejection);

            var (overrideReason, codes) = RosterGate.ComputeOverride(findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
            a.OverrideReason = overrideReason;
            a.AcknowledgedFindingCodes = codes;
            a.HasConflict = overrideReason != null;
        }

        a.UserId = dto.StaffId; a.AssignmentRole = dto.AssignmentRole;
        a.AssignmentStart = dto.AssignmentStart; a.AssignmentEnd = dto.AssignmentEnd;
        a.IsDriver = dto.IsDriver; a.SleepoverType = dto.SleepoverType;
        a.ShiftNotes = dto.ShiftNotes; a.Status = dto.Status; a.UpdatedAt = DateTime.UtcNow;

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
