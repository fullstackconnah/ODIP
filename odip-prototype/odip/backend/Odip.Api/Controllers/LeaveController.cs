using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Coordinator surface for staff leave and recurring unavailability: list, on-behalf entry
/// (lands Approved directly), and the approve/decline/cancel lifecycle. Gated to the same
/// tier as RosteringController — SuperAdmin/Admin/Coordinator — since this is coordinator work
/// with the same access-control shape (see that controller's own remarks on why the whole
/// controller, not just writes, is gated). Staff self-service lives on PortalController instead.
/// See docs/specs/2026-09-07-staff-leave-unavailability-design.md §2.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/leave")]
public class LeaveController : ControllerBase
{
    private readonly OdipDbContext _db;
    public LeaveController(OdipDbContext db) => _db = db;

    // ══════════════════════════════════════════════════════════════
    // LEAVE
    // ══════════════════════════════════════════════════════════════

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<LeaveRequestDto>>>> GetLeave(
        [FromQuery] LeaveStatus? status, [FromQuery] Guid? userId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var query = _db.LeaveRequests.Include(l => l.User).AsQueryable();
        if (status.HasValue) query = query.Where(l => l.Status == status.Value);
        if (userId.HasValue) query = query.Where(l => l.UserId == userId.Value);
        if (from.HasValue) query = query.Where(l => l.EndDate >= from.Value);
        if (to.HasValue) query = query.Where(l => l.StartDate <= to.Value);

        var rows = await query.OrderByDescending(l => l.RequestedAt).ToListAsync(ct);
        return Ok(ApiResponse<List<LeaveRequestDto>>.Ok(rows.Select(ToDto).ToList()));
    }

    /// <summary>On-behalf entry: lands Approved directly, with the coordinator recorded as both requester and decider — the initial state per the spec's state-transition matrix, not a transition.</summary>
    [HttpPost]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CreateLeave([FromBody] CreateLeaveRequestDto dto, CancellationToken ct)
    {
        if (dto.UserId is null)
            return BadRequest(ApiResponse<LeaveRequestDto>.Fail("A staff member is required."));
        var validationError = ValidateLeaveDates(dto.StartDate, dto.EndDate);
        if (validationError != null) return BadRequest(ApiResponse<LeaveRequestDto>.Fail(validationError));
        if (!await _db.Users.AnyAsync(u => u.Id == dto.UserId.Value && u.IsActive, ct))
            return BadRequest(ApiResponse<LeaveRequestDto>.Fail("Staff member not found."));
        if (await HasDuplicateLeaveAsync(dto.UserId.Value, dto.LeaveType, dto.StartDate, dto.EndDate, ct))
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("An identical request already exists."));

        var callerId = ResolveCallerId();
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = dto.UserId.Value, LeaveType = dto.LeaveType,
            StartDate = dto.StartDate, EndDate = dto.EndDate, Reason = dto.Reason,
            Status = LeaveStatus.Approved, RequestedByUserId = callerId, RequestedAt = DateTime.UtcNow,
            DecidedByUserId = callerId, DecidedAt = DateTime.UtcNow,
        };
        _db.LeaveRequests.Add(leave);
        await _db.SaveChangesAsync(ct);
        // Design spec (docs/specs/2026-09-07-staff-leave-unavailability-design.md:184): POST /leave is 201, not 200 — no GetById route exists, so no CreatedAtAction.
        return StatusCode(StatusCodes.Status201Created, ApiResponse<LeaveRequestDto>.Ok(await LoadLeaveDtoAsync(leave.Id, ct)));
    }

    [HttpPost("{id:guid}/approve")]
    public async Task<ActionResult<ApiResponse<LeaveApprovalResultDto>>> ApproveLeave(Guid id, CancellationToken ct)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveApprovalResultDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<LeaveApprovalResultDto>.Fail("This request has already been decided."));

        leave.Status = LeaveStatus.Approved;
        leave.DecidedByUserId = ResolveCallerId();
        leave.DecidedAt = DateTime.UtcNow;
        leave.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var overlaps = await FindLeaveOverlapsAsync(leave.UserId, leave.StartDate, leave.EndDate, ct);
        return Ok(ApiResponse<LeaveApprovalResultDto>.Ok(new LeaveApprovalResultDto
        {
            Leave = await LoadLeaveDtoAsync(leave.Id, ct), Overlaps = overlaps,
        }));
    }

    [HttpPost("{id:guid}/decline")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> DeclineLeave(Guid id, [FromBody] LeaveDecisionDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.DecisionNote))
            return BadRequest(ApiResponse<LeaveRequestDto>.Fail("A decline reason is required."));

        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("This request has already been decided."));

        leave.Status = LeaveStatus.Declined;
        leave.DecidedByUserId = ResolveCallerId();
        leave.DecidedAt = DateTime.UtcNow;
        leave.UpdatedAt = DateTime.UtcNow;
        leave.DecisionNote = dto.DecisionNote.Trim();
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(await LoadLeaveDtoAsync(leave.Id, ct)));
    }

    /// <summary>Coordinator cancel: valid from Pending OR Approved (the matrix's two "Coordinator (cancel)" cells). See this task's ruling for why this differs from the portal cancel's error wording.</summary>
    [HttpPost("{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CancelLeave(Guid id, CancellationToken ct)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending && leave.Status != LeaveStatus.Approved)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("This request has already been decided."));

        leave.Status = LeaveStatus.Cancelled;
        leave.DecidedByUserId = ResolveCallerId();
        leave.DecidedAt = DateTime.UtcNow;
        leave.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(await LoadLeaveDtoAsync(leave.Id, ct)));
    }

    // ══════════════════════════════════════════════════════════════
    // RECURRING UNAVAILABILITY (mirrors LEAVE above, same shape)
    // ══════════════════════════════════════════════════════════════

    [HttpGet("unavailability")]
    public async Task<ActionResult<ApiResponse<List<RecurringUnavailabilityDto>>>> GetUnavailability(
        [FromQuery] LeaveStatus? status, [FromQuery] Guid? userId, CancellationToken ct)
    {
        var query = _db.RecurringUnavailabilities.Include(r => r.User).AsQueryable();
        if (status.HasValue) query = query.Where(r => r.Status == status.Value);
        if (userId.HasValue) query = query.Where(r => r.UserId == userId.Value);

        var rows = await query.OrderByDescending(r => r.RequestedAt).ToListAsync(ct);
        return Ok(ApiResponse<List<RecurringUnavailabilityDto>>.Ok(rows.Select(ToDto).ToList()));
    }

    [HttpPost("unavailability")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CreateUnavailability(
        [FromBody] CreateRecurringUnavailabilityDto dto, CancellationToken ct)
    {
        if (dto.UserId is null)
            return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail("A staff member is required."));
        var validationError = ValidateRecurringWindow(dto.StartTime, dto.EndTime, dto.EffectiveFrom, dto.EffectiveTo);
        if (validationError != null) return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail(validationError));
        if (!await _db.Users.AnyAsync(u => u.Id == dto.UserId.Value && u.IsActive, ct))
            return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail("Staff member not found."));
        if (await HasDuplicateUnavailabilityAsync(dto.UserId.Value, dto.DayOfWeek, dto.StartTime, dto.EndTime, dto.EffectiveFrom, dto.EffectiveTo, ct))
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("An identical request already exists."));

        var callerId = ResolveCallerId();
        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = dto.UserId.Value, DayOfWeek = dto.DayOfWeek,
            StartTime = dto.StartTime, EndTime = dto.EndTime, EffectiveFrom = dto.EffectiveFrom,
            EffectiveTo = dto.EffectiveTo, Notes = dto.Notes,
            Status = LeaveStatus.Approved, RequestedByUserId = callerId, RequestedAt = DateTime.UtcNow,
            DecidedByUserId = callerId, DecidedAt = DateTime.UtcNow,
        };
        _db.RecurringUnavailabilities.Add(rule);
        await _db.SaveChangesAsync(ct);
        // Design spec (docs/specs/2026-09-07-staff-leave-unavailability-design.md:184): POST /leave/unavailability is 201, not 200 — no GetById route exists, so no CreatedAtAction.
        return StatusCode(StatusCodes.Status201Created, ApiResponse<RecurringUnavailabilityDto>.Ok(await LoadUnavailabilityDtoAsync(rule.Id, ct)));
    }

    [HttpPost("unavailability/{id:guid}/approve")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityApprovalResultDto>>> ApproveUnavailability(Guid id, CancellationToken ct)
    {
        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail("This request has already been decided."));

        rule.Status = LeaveStatus.Approved;
        rule.DecidedByUserId = ResolveCallerId();
        rule.DecidedAt = DateTime.UtcNow;
        rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var overlaps = await FindRecurringOverlapsAsync(rule, ct);
        return Ok(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Ok(new RecurringUnavailabilityApprovalResultDto
        {
            Unavailability = await LoadUnavailabilityDtoAsync(rule.Id, ct), Overlaps = overlaps,
        }));
    }

    [HttpPost("unavailability/{id:guid}/decline")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> DeclineUnavailability(
        Guid id, [FromBody] LeaveDecisionDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.DecisionNote))
            return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail("A decline reason is required."));

        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("This request has already been decided."));

        rule.Status = LeaveStatus.Declined;
        rule.DecidedByUserId = ResolveCallerId();
        rule.DecidedAt = DateTime.UtcNow;
        rule.UpdatedAt = DateTime.UtcNow;
        rule.DecisionNote = dto.DecisionNote.Trim();
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(await LoadUnavailabilityDtoAsync(rule.Id, ct)));
    }

    [HttpPost("unavailability/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CancelUnavailability(Guid id, CancellationToken ct)
    {
        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending && rule.Status != LeaveStatus.Approved)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("This request has already been decided."));

        rule.Status = LeaveStatus.Cancelled;
        rule.DecidedByUserId = ResolveCallerId();
        rule.DecidedAt = DateTime.UtcNow;
        rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(await LoadUnavailabilityDtoAsync(rule.Id, ct)));
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    private Guid ResolveCallerId() =>
        Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : Guid.Empty;

    internal static string? ValidateLeaveDates(DateOnly start, DateOnly end) =>
        end < start ? "End date must be on or after the start date." : null;

    internal static string? ValidateRecurringWindow(TimeOnly start, TimeOnly end, DateOnly effectiveFrom, DateOnly? effectiveTo)
    {
        if (start >= end) return "Start time must be before end time.";
        if (effectiveTo.HasValue && effectiveTo.Value < effectiveFrom) return "Effective-to must be on or after effective-from.";
        return null;
    }

    private Task<bool> HasDuplicateLeaveAsync(Guid userId, LeaveType leaveType, DateOnly start, DateOnly end, CancellationToken ct) =>
        _db.LeaveRequests.AnyAsync(l =>
            l.UserId == userId && l.LeaveType == leaveType && l.StartDate == start && l.EndDate == end
            && l.Status != LeaveStatus.Cancelled, ct);

    private Task<bool> HasDuplicateUnavailabilityAsync(
        Guid userId, DayOfWeek dayOfWeek, TimeOnly start, TimeOnly end, DateOnly effectiveFrom, DateOnly? effectiveTo, CancellationToken ct) =>
        _db.RecurringUnavailabilities.AnyAsync(r =>
            r.UserId == userId && r.DayOfWeek == dayOfWeek && r.StartTime == start && r.EndTime == end
            && r.EffectiveFrom == effectiveFrom && r.EffectiveTo == effectiveTo
            && r.Status != LeaveStatus.Cancelled, ct);

    /// <summary>Overlapping Published shifts / Confirmed trip assignments for the just-approved leave window — informational only, approval is never blocked by this. See spec §3 "Reverse direction."</summary>
    private async Task<List<RosterFindingDto>> FindLeaveOverlapsAsync(Guid userId, DateOnly startDate, DateOnly endDate, CancellationToken ct)
    {
        var overlaps = new List<RosterFindingDto>();

        var shifts = await _db.Shifts
            .Where(s => s.UserId == userId && s.Status == ShiftStatus.Published
                        && s.ServiceDate >= startDate && s.ServiceDate <= endDate)
            .ToListAsync(ct);
        overlaps.AddRange(shifts.Select(s => new RosterFindingDto
        {
            Code = "SHIFT_OVERLAP", Severity = RosterFindingSeverity.Warning,
            Message = $"A published shift on {s.ServiceDate:d MMM yyyy} overlaps this leave.",
        }));

        var trips = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.UserId == userId && a.Status == AssignmentStatus.Confirmed
                        && a.AssignmentStart <= endDate && a.AssignmentEnd >= startDate)
            .ToListAsync(ct);
        overlaps.AddRange(trips.Select(a => new RosterFindingDto
        {
            Code = "TRIP_OVERLAP", Severity = RosterFindingSeverity.Warning,
            Message = $"A confirmed trip assignment ({a.TripInstance?.TripName}) overlaps this leave.",
        }));

        return overlaps;
    }

    /// <summary>
    /// Same idea as <see cref="FindLeaveOverlapsAsync"/> for a recurring rule: expands the rule
    /// over a bounded look-ahead (today..EffectiveTo, or today+84 days/12 weeks when open-ended —
    /// see this task's file-structure note; the spec does not bound this and an unbounded
    /// expansion is not safe for an indefinite rule) and checks each occurrence's date/time
    /// against Published shifts and Confirmed trip assignments.
    /// </summary>
    private async Task<List<RosterFindingDto>> FindRecurringOverlapsAsync(RecurringUnavailability rule, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var horizonStart = today > rule.EffectiveFrom ? today : rule.EffectiveFrom;
        var horizonEnd = rule.EffectiveTo ?? today.AddDays(84);
        var occurrences = new RecurringUnavailabilityExpander().Occurrences(rule, horizonStart, horizonEnd).ToHashSet();
        if (occurrences.Count == 0) return new List<RosterFindingDto>();

        var overlaps = new List<RosterFindingDto>();

        var shifts = await _db.Shifts
            .Where(s => s.UserId == rule.UserId && s.Status == ShiftStatus.Published
                        && s.ServiceDate >= horizonStart && s.ServiceDate <= horizonEnd
                        // s.EndsNextDay: EndTime is a next-day time-of-day, so the plain comparison
                        // below is meaningless for it — always include overnight shifts instead.
                        && (s.EndsNextDay || (s.StartTime < rule.EndTime && rule.StartTime < s.EndTime)))
            .ToListAsync(ct);
        overlaps.AddRange(shifts.Where(s => occurrences.Contains(s.ServiceDate)).Select(s => new RosterFindingDto
        {
            Code = "SHIFT_OVERLAP", Severity = RosterFindingSeverity.Warning,
            Message = $"A published shift on {s.ServiceDate:d MMM yyyy} overlaps this recurring window.",
        }));

        var trips = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.UserId == rule.UserId && a.Status == AssignmentStatus.Confirmed
                        && a.AssignmentStart <= horizonEnd && a.AssignmentEnd >= horizonStart)
            .ToListAsync(ct);
        overlaps.AddRange(trips
            .Where(a => Enumerable.Range(0, a.AssignmentEnd.DayNumber - a.AssignmentStart.DayNumber + 1)
                .Select(offset => a.AssignmentStart.AddDays(offset))
                .Any(occurrences.Contains))
            .Select(a => new RosterFindingDto
            {
                Code = "TRIP_OVERLAP", Severity = RosterFindingSeverity.Warning,
                Message = $"A confirmed trip assignment ({a.TripInstance?.TripName}) overlaps this recurring window.",
            }));

        return overlaps;
    }

    private static LeaveRequestDto ToDto(LeaveRequest l) => new()
    {
        Id = l.Id, UserId = l.UserId, UserFullName = l.User?.FullName ?? string.Empty, LeaveType = l.LeaveType,
        StartDate = l.StartDate, EndDate = l.EndDate, Status = l.Status, Reason = l.Reason,
        RequestedByUserId = l.RequestedByUserId, RequestedAt = l.RequestedAt,
        DecidedByUserId = l.DecidedByUserId, DecidedAt = l.DecidedAt, DecisionNote = l.DecisionNote,
    };

    private static RecurringUnavailabilityDto ToDto(RecurringUnavailability r) => new()
    {
        Id = r.Id, UserId = r.UserId, UserFullName = r.User?.FullName ?? string.Empty, DayOfWeek = r.DayOfWeek,
        StartTime = r.StartTime, EndTime = r.EndTime, EffectiveFrom = r.EffectiveFrom, EffectiveTo = r.EffectiveTo,
        Notes = r.Notes, Status = r.Status, RequestedByUserId = r.RequestedByUserId, RequestedAt = r.RequestedAt,
        DecidedByUserId = r.DecidedByUserId, DecidedAt = r.DecidedAt, DecisionNote = r.DecisionNote,
    };

    private async Task<LeaveRequestDto> LoadLeaveDtoAsync(Guid id, CancellationToken ct) =>
        ToDto(await _db.LeaveRequests.Include(l => l.User).FirstAsync(l => l.Id == id, ct));

    private async Task<RecurringUnavailabilityDto> LoadUnavailabilityDtoAsync(Guid id, CancellationToken ct) =>
        ToDto(await _db.RecurringUnavailabilities.Include(r => r.User).FirstAsync(r => r.Id == id, ct));
}
