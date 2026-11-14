using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

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

    /// <summary>VehicleAssignment has no organisation column or query filter: an assignment is the caller's only if its trip is (TripInstances is tenant-filtered).</summary>
    private IQueryable<VehicleAssignment> TenantAssignments() =>
        _db.VehicleAssignments.Where(a => _db.TripInstances.Any(t => t.Id == a.TripInstanceId));

    /// <summary>
    /// §4.4 same-tenant validation for the driver picker: null is always fine (no driver
    /// assigned yet), otherwise the id must resolve to an active User — same-tenant scoping comes
    /// for free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private const string ArchivedVehicleMessage = "This vehicle is archived. Choose another vehicle.";

    // An unscoped SuperAdmin sees every organisation, so the driver and the vehicle must also belong to the trip's own organisation.
    private Task<bool> IsValidDriverRefAsync(Guid? driverUserId, Guid tripTenantId, CancellationToken ct) =>
        driverUserId.HasValue
            ? _db.Users.AnyAsync(u => u.Id == driverUserId.Value && u.IsActive && u.TenantId == tripTenantId, ct)
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
        Guid vehicleId, Guid tripInstanceId, Guid excludeAssignmentId, CancellationToken ct, Guid? driverUserId = null)
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

        var findings = _conflictService.CheckVehicleAssignment(tripStart, tripEnd, excludeAssignmentId, ctx).ToList();

        // A null expiry on an eligible driver is not a finding, as in the staff list flag.
        var driver = driverUserId.HasValue ? await _db.Users.FirstOrDefaultAsync(u => u.Id == driverUserId.Value, ct) : null;
        if (driver != null)
        {
            if (!driver.IsDriverEligible)
                findings.Add(new RosterFinding(RosterConflictService.VehicleDriverLicence, RosterFindingSeverity.Warning,
                    $"{driver.FullName} isn't marked as an eligible driver.", RequiresReason: true));
            else if (driver.DriverLicenceExpiryDate is { } expiry && expiry < tripStart)
                findings.Add(new RosterFinding(RosterConflictService.VehicleDriverLicence, RosterFindingSeverity.Warning,
                    $"{driver.FullName}'s driver licence expires before this trip.", RequiresReason: true));
        }
        return findings;
    }

    /// <summary>Dry-run findings for a candidate vehicle assignment. Never writes — mirrors POST /staff-assignments/check.</summary>
    [HttpPost("check")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<RosterFindingDto>>>> Check([FromBody] CheckVehicleAssignmentDto dto, CancellationToken ct)
    {
        // As Create: an unscoped SuperAdmin sees every organisation, so the vehicle must belong to the trip's own. A trip that is not found has no organisation to match (the check then has nothing to check against).
        var tripTenantId = await _db.TripInstances.Where(t => t.Id == dto.TripInstanceId).Select(t => (Guid?)t.TenantId).FirstOrDefaultAsync(ct);
        if (!await _db.Vehicles.AnyAsync(v => v.Id == dto.VehicleId && (tripTenantId == null || v.TenantId == tripTenantId), ct))
            return BadRequest(ApiResponse<List<RosterFindingDto>>.Fail("Vehicle not found."));

        var findings = await CheckAsync(dto.VehicleId, dto.TripInstanceId, dto.ExcludeAssignmentId ?? Guid.Empty, ct);
        return Ok(ApiResponse<List<RosterFindingDto>>.Ok(findings.Select(RosterGate.ToFindingDto).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleAssignmentDto>>> Create([FromBody] CreateVehicleAssignmentDto dto, CancellationToken ct)
    {
        var trip = await _db.TripInstances.FirstOrDefaultAsync(t => t.Id == dto.TripInstanceId, ct);
        if (trip == null) return NotFound(ApiResponse<VehicleAssignmentDto>.Fail("Trip not found"));

        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.Id == dto.VehicleId, ct);
        if (vehicle == null || vehicle.TenantId != trip.TenantId)
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail("Vehicle not found."));
        if (!vehicle.IsActive)
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail(ArchivedVehicleMessage));
        if (!await IsValidDriverRefAsync(dto.DriverStaffId, trip.TenantId, ct))
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail("Driver not found."));

        var findings = await CheckAsync(dto.VehicleId, dto.TripInstanceId, Guid.Empty, ct, dto.DriverStaffId);
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
            DriverName = assignment.DriverUser != null ? (assignment.DriverUser.FirstName + " " + assignment.DriverUser.LastName).Trim() : null,
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
        var a = await TenantAssignments().Include(x => x.TripInstance).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<VehicleAssignmentDto>.Fail("Assignment not found"));

        var tripTenantId = a.TripInstance.TenantId;
        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.Id == dto.VehicleId, ct);
        if (vehicle == null || vehicle.TenantId != tripTenantId)
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail("Vehicle not found."));
        // Only a switch to an archived vehicle is refused: an assignment of a since-archived one can still be edited or cancelled.
        if (!vehicle.IsActive && vehicle.Id != a.VehicleId)
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail(ArchivedVehicleMessage));
        if (!await IsValidDriverRefAsync(dto.DriverStaffId, tripTenantId, ct))
            return BadRequest(ApiResponse<VehicleAssignmentDto>.Fail("Driver not found."));

        // Cancelling via PUT mirrors StaffAssignmentsController.Update: a Cancelled row is excluded
        // from every conflict query (see the otherAssignments filter in CheckAsync), so demanding an
        // override reason to cancel is a trap. Skip the gate entirely and leave OverrideReason/
        // AcknowledgedFindingCodes/HasConflict/HasOverlapConflict untouched.
        var isCancelling = dto.Status == VehicleAssignmentStatus.Cancelled;

        if (!isCancelling)
        {
            var findings = await CheckAsync(dto.VehicleId, a.TripInstanceId, a.Id, ct, dto.DriverStaffId);
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
            DriverName = a.DriverUser != null ? (a.DriverUser.FirstName + " " + a.DriverUser.LastName).Trim() : null,
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
        var a = await TenantAssignments().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<bool>.Fail("Assignment not found"));
        a.Status = VehicleAssignmentStatus.Cancelled; a.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
