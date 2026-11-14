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

    /// <summary>StaffAssignment has no organisation column or query filter: an assignment is the caller's only if its trip is (TripInstances is tenant-filtered).</summary>
    private IQueryable<StaffAssignment> TenantAssignments() =>
        _db.StaffAssignments.Where(a => _db.TripInstances.Any(t => t.Id == a.TripInstanceId));

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
            otherTripAssignments, availability, CompatibilityLevel.Allowed,
            RosterAvailability.WeeklyHoursFor(await RosterAvailability.WeeklyHoursAsync(_db, new[] { staff.TenantId }, ct), staff.TenantId));

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

    /// <summary>
    /// 409 when the same person already holds a non-cancelled assignment on this trip whose period overlaps
    /// [start, end] (same inclusive overlap test as CheckAsync). excludeAssignmentId is the row's own Id on update.
    /// Not an override-able finding: a second row for the same person and dates only inflates the trip's staffing count.
    /// shortcut: no DB constraint (separate date ranges for one person are legal), so two truly simultaneous requests can still both pass; add a serializable check if this is seen on live.
    /// </summary>
    private async Task<ConflictObjectResult?> DuplicateOnTripAsync(
        Guid tripId, Guid staffId, DateOnly start, DateOnly end, Guid excludeAssignmentId, CancellationToken ct)
    {
        var duplicate = await _db.StaffAssignments
            .AnyAsync(a => a.TripInstanceId == tripId && a.UserId == staffId && a.Id != excludeAssignmentId
                           && a.Status != AssignmentStatus.Cancelled && a.AssignmentStart <= end && a.AssignmentEnd >= start, ct);
        if (!duplicate) return null;
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == staffId, ct);
        var name = user != null ? (user.FirstName + " " + user.LastName).Trim() : "";
        return Conflict(ApiResponse<StaffAssignmentDto>.Fail($"{(name.Length > 0 ? name : "This staff member")} is already on this trip for these dates."));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAssignmentDto>>> Create([FromBody] CreateStaffAssignmentDto dto, CancellationToken ct)
    {
        if (!await _db.TripInstances.AnyAsync(t => t.Id == dto.TripInstanceId, ct))
            return NotFound(ApiResponse<StaffAssignmentDto>.Fail("Trip not found"));
        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAssignmentDto>.Fail("Staff member not found."));

        var duplicate = await DuplicateOnTripAsync(dto.TripInstanceId, dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, Guid.Empty, ct);
        if (duplicate != null) return duplicate;

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
            StaffName = assignment.User != null ? (assignment.User.FirstName + " " + assignment.User.LastName).Trim() : null,
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
        var a = await TenantAssignments().FirstOrDefaultAsync(x => x.Id == id, ct);
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
            var duplicate = await DuplicateOnTripAsync(a.TripInstanceId, dto.StaffId, dto.AssignmentStart, dto.AssignmentEnd, a.Id, ct);
            if (duplicate != null) return duplicate;

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
            StaffId = a.UserId, StaffName = a.User != null ? (a.User.FirstName + " " + a.User.LastName).Trim() : null,
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
        var a = await TenantAssignments().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<bool>.Fail("Assignment not found"));
        a.Status = AssignmentStatus.Cancelled;
        a.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Assignment deleted"));
    }
}
