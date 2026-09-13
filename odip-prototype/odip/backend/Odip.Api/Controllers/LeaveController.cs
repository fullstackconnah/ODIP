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
    private readonly Odip.Application.Interfaces.INotificationRaiser _notificationRaiser;

    public LeaveController(OdipDbContext db, Odip.Application.Interfaces.INotificationRaiser? notificationRaiser = null)
    {
        _db = db;
        _notificationRaiser = notificationRaiser ?? new Odip.Infrastructure.Notifications.NotificationRaiser(db);
    }

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
        if (callerId is null) return Unauthorized(ApiResponse<LeaveRequestDto>.Fail("Caller identity could not be resolved."));
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = dto.UserId.Value, LeaveType = dto.LeaveType,
            StartDate = dto.StartDate, EndDate = dto.EndDate, Reason = dto.Reason,
            Status = LeaveStatus.Approved, RequestedByUserId = callerId.Value, RequestedAt = DateTime.UtcNow,
            DecidedByUserId = callerId.Value, DecidedAt = DateTime.UtcNow,
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

        var approveCallerId = ResolveCallerId();
        if (approveCallerId is null) return Unauthorized(ApiResponse<LeaveApprovalResultDto>.Fail("Caller identity could not be resolved."));

        leave.Status = LeaveStatus.Approved;
        leave.DecidedByUserId = approveCallerId.Value;
        leave.DecidedAt = DateTime.UtcNow;
        leave.UpdatedAt = DateTime.UtcNow;

        // NotificationEventType.LeaveRequestDecided — recipient is leave.UserId (the staff
        // member whose leave it is), not RequestedByUserId (the coordinator on an on-behalf
        // entry). Design spec §5.
        await RaiseLeaveDecidedAsync(leave, approved: true, ct);

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
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("This request has already been decided."));

        var declineCallerId = ResolveCallerId();
        if (declineCallerId is null) return Unauthorized(ApiResponse<LeaveRequestDto>.Fail("Caller identity could not be resolved."));

        leave.Status = LeaveStatus.Declined;
        leave.DecidedByUserId = declineCallerId.Value;
        leave.DecidedAt = DateTime.UtcNow;
        leave.UpdatedAt = DateTime.UtcNow;
        // Product ruling: a decline reason is optional (a coordinator may still record one), not
        // required — cancelling an already-Approved request has never demanded one either, and
        // refusing a still-Pending request shouldn't be held to a higher bar than reversing a
        // "yes". Persist null rather than "" when omitted, matching every other optional-note field.
        leave.DecisionNote = string.IsNullOrWhiteSpace(dto.DecisionNote) ? null : dto.DecisionNote.Trim();

        // NotificationEventType.LeaveRequestDecided — same recipient rule as approve above.
        await RaiseLeaveDecidedAsync(leave, approved: false, ct);

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(await LoadLeaveDtoAsync(leave.Id, ct)));
    }

    /// <summary>
    /// Coordinator edit: editable only while Pending or Approved (409 with the same
    /// AlreadyClosedMessage used by cancel on Declined/Cancelled). UserId, Status, RequestedBy*,
    /// DecidedBy* are unchanged. Overlaps are recomputed when the row is currently Approved (empty
    /// when Pending) — same overlap helper the approve path uses.
    /// </summary>
    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ApiResponse<LeaveApprovalResultDto>>> UpdateLeave(Guid id, [FromBody] UpdateLeaveRequestDto dto, CancellationToken ct)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveApprovalResultDto>.Fail("Leave request not found."));
        if (leave.Status == LeaveStatus.Declined || leave.Status == LeaveStatus.Cancelled)
            return Conflict(ApiResponse<LeaveApprovalResultDto>.Fail(AlreadyClosedMessage(leave.Status)));

        var validationError = ValidateLeaveDates(dto.StartDate, dto.EndDate);
        if (validationError != null) return BadRequest(ApiResponse<LeaveApprovalResultDto>.Fail(validationError));
        if (await HasDuplicateLeaveAsync(leave.UserId, dto.LeaveType, dto.StartDate, dto.EndDate, ct, excludeId: leave.Id))
            return Conflict(ApiResponse<LeaveApprovalResultDto>.Fail("An identical request already exists."));

        var updateCallerId = ResolveCallerId();
        if (updateCallerId is null) return Unauthorized(ApiResponse<LeaveApprovalResultDto>.Fail("Caller identity could not be resolved."));

        leave.LeaveType = dto.LeaveType;
        leave.StartDate = dto.StartDate;
        leave.EndDate = dto.EndDate;
        leave.Reason = dto.Reason;
        leave.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var overlaps = leave.Status == LeaveStatus.Approved
            ? await FindLeaveOverlapsAsync(leave.UserId, leave.StartDate, leave.EndDate, ct)
            : new List<RosterFindingDto>();

        return Ok(ApiResponse<LeaveApprovalResultDto>.Ok(new LeaveApprovalResultDto
        {
            Leave = await LoadLeaveDtoAsync(leave.Id, ct), Overlaps = overlaps,
        }));
    }

    /// <summary>Coordinator cancel: valid from Pending OR Approved (the matrix's two "Coordinator (cancel)" cells). See this task's ruling for why this differs from the portal cancel's error wording.</summary>
    [HttpPost("{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CancelLeave(Guid id, CancellationToken ct)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending && leave.Status != LeaveStatus.Approved)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail(AlreadyClosedMessage(leave.Status)));

        var cancelCallerId = ResolveCallerId();
        if (cancelCallerId is null) return Unauthorized(ApiResponse<LeaveRequestDto>.Fail("Caller identity could not be resolved."));

        leave.Status = LeaveStatus.Cancelled;
        leave.DecidedByUserId = cancelCallerId.Value;
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
        if (callerId is null) return Unauthorized(ApiResponse<RecurringUnavailabilityDto>.Fail("Caller identity could not be resolved."));
        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = dto.UserId.Value, DayOfWeek = dto.DayOfWeek,
            StartTime = dto.StartTime, EndTime = dto.EndTime, EffectiveFrom = dto.EffectiveFrom,
            EffectiveTo = dto.EffectiveTo, Notes = dto.Notes,
            Status = LeaveStatus.Approved, RequestedByUserId = callerId.Value, RequestedAt = DateTime.UtcNow,
            DecidedByUserId = callerId.Value, DecidedAt = DateTime.UtcNow,
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

        var approveRuleCallerId = ResolveCallerId();
        if (approveRuleCallerId is null) return Unauthorized(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail("Caller identity could not be resolved."));

        rule.Status = LeaveStatus.Approved;
        rule.DecidedByUserId = approveRuleCallerId.Value;
        rule.DecidedAt = DateTime.UtcNow;
        rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var overlaps = await FindRecurringOverlapsAsync(rule, ct);
        return Ok(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Ok(new RecurringUnavailabilityApprovalResultDto
        {
            Unavailability = await LoadUnavailabilityDtoAsync(rule.Id, ct), Overlaps = overlaps,
        }));
    }

    /// <summary>Coordinator edit: mirrors UpdateLeave above — editable only while Pending or Approved, UserId/Status/RequestedBy*/DecidedBy* unchanged.</summary>
    [HttpPut("unavailability/{id:guid}")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityApprovalResultDto>>> UpdateUnavailability(Guid id, [FromBody] UpdateRecurringUnavailabilityDto dto, CancellationToken ct)
    {
        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail("Unavailability request not found."));
        if (rule.Status == LeaveStatus.Declined || rule.Status == LeaveStatus.Cancelled)
            return Conflict(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail(AlreadyClosedMessage(rule.Status)));

        var validationError = ValidateRecurringWindow(dto.StartTime, dto.EndTime, dto.EffectiveFrom, dto.EffectiveTo);
        if (validationError != null) return BadRequest(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail(validationError));
        if (await HasDuplicateUnavailabilityAsync(rule.UserId, dto.DayOfWeek, dto.StartTime, dto.EndTime, dto.EffectiveFrom, dto.EffectiveTo, ct, excludeId: rule.Id))
            return Conflict(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail("An identical request already exists."));

        var updateRuleCallerId = ResolveCallerId();
        if (updateRuleCallerId is null) return Unauthorized(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Fail("Caller identity could not be resolved."));

        rule.DayOfWeek = dto.DayOfWeek;
        rule.StartTime = dto.StartTime;
        rule.EndTime = dto.EndTime;
        rule.EffectiveFrom = dto.EffectiveFrom;
        rule.EffectiveTo = dto.EffectiveTo;
        rule.Notes = dto.Notes;
        rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var overlaps = rule.Status == LeaveStatus.Approved
            ? await FindRecurringOverlapsAsync(rule, ct)
            : new List<RosterFindingDto>();

        return Ok(ApiResponse<RecurringUnavailabilityApprovalResultDto>.Ok(new RecurringUnavailabilityApprovalResultDto
        {
            Unavailability = await LoadUnavailabilityDtoAsync(rule.Id, ct), Overlaps = overlaps,
        }));
    }

    [HttpPost("unavailability/{id:guid}/decline")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> DeclineUnavailability(
        Guid id, [FromBody] LeaveDecisionDto dto, CancellationToken ct)
    {
        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("This request has already been decided."));

        var declineRuleCallerId = ResolveCallerId();
        if (declineRuleCallerId is null) return Unauthorized(ApiResponse<RecurringUnavailabilityDto>.Fail("Caller identity could not be resolved."));

        rule.Status = LeaveStatus.Declined;
        rule.DecidedByUserId = declineRuleCallerId.Value;
        rule.DecidedAt = DateTime.UtcNow;
        rule.UpdatedAt = DateTime.UtcNow;
        // Product ruling: mirrors DeclineLeave above — a decline reason is optional, not required.
        rule.DecisionNote = string.IsNullOrWhiteSpace(dto.DecisionNote) ? null : dto.DecisionNote.Trim();
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(await LoadUnavailabilityDtoAsync(rule.Id, ct)));
    }

    [HttpPost("unavailability/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CancelUnavailability(Guid id, CancellationToken ct)
    {
        var rule = await _db.RecurringUnavailabilities.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending && rule.Status != LeaveStatus.Approved)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail(AlreadyClosedMessage(rule.Status)));

        var cancelRuleCallerId = ResolveCallerId();
        if (cancelRuleCallerId is null) return Unauthorized(ApiResponse<RecurringUnavailabilityDto>.Fail("Caller identity could not be resolved."));

        rule.Status = LeaveStatus.Cancelled;
        rule.DecidedByUserId = cancelRuleCallerId.Value;
        rule.DecidedAt = DateTime.UtcNow;
        rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(await LoadUnavailabilityDtoAsync(rule.Id, ct)));
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    private Guid? ResolveCallerId() =>
        Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

    /// <summary>Shared by ApproveLeave/DeclineLeave — recipient is leave.UserId, never RequestedByUserId.</summary>
    private async Task RaiseLeaveDecidedAsync(LeaveRequest leave, bool approved, CancellationToken ct)
    {
        var owner = await _db.Users.FirstOrDefaultAsync(u => u.Id == leave.UserId, ct);
        if (owner is null) return;

        await _notificationRaiser.RaiseAsync(
            Odip.Domain.Notifications.NotificationEventType.LeaveRequestDecided, "LeaveRequest", leave.Id,
            new[] { owner.Id },
            new Odip.Infrastructure.Notifications.Templates.LeaveRequestDecidedPayload(
                owner.Email, leave.LeaveType.ToString(), leave.StartDate, leave.EndDate, approved, leave.DecisionNote),
            ct);
    }

    /// <summary>Status-specific wording for a coordinator cancel attempted on an already-closed row (A2 ruling — the generic "already been decided" is correct for approve/decline, where Pending is the only valid source state, but not for cancel, which can also be attempted on a Declined row).</summary>
    private static string AlreadyClosedMessage(LeaveStatus status) => status switch
    {
        LeaveStatus.Cancelled => "This request has already been cancelled.",
        LeaveStatus.Declined => "This request has already been declined.",
        _ => "This request has already been decided.",
    };

    internal static string? ValidateLeaveDates(DateOnly start, DateOnly end) =>
        end < start ? "End date must be on or after the start date." : null;

    internal static string? ValidateRecurringWindow(TimeOnly start, TimeOnly end, DateOnly effectiveFrom, DateOnly? effectiveTo)
    {
        if (start >= end) return "Start time must be before end time.";
        if (effectiveTo.HasValue && effectiveTo.Value < effectiveFrom) return "Effective-to must be on or after effective-from.";
        return null;
    }

    private Task<bool> HasDuplicateLeaveAsync(Guid userId, LeaveType leaveType, DateOnly start, DateOnly end, CancellationToken ct, Guid? excludeId = null) =>
        _db.LeaveRequests.AnyAsync(l =>
            l.UserId == userId && l.LeaveType == leaveType && l.StartDate == start && l.EndDate == end
            && l.Status != LeaveStatus.Cancelled && l.Status != LeaveStatus.Declined
            && (excludeId == null || l.Id != excludeId.Value), ct);

    private Task<bool> HasDuplicateUnavailabilityAsync(
        Guid userId, DayOfWeek dayOfWeek, TimeOnly start, TimeOnly end, DateOnly effectiveFrom, DateOnly? effectiveTo, CancellationToken ct, Guid? excludeId = null) =>
        _db.RecurringUnavailabilities.AnyAsync(r =>
            r.UserId == userId && r.DayOfWeek == dayOfWeek && r.StartTime == start && r.EndTime == end
            && r.EffectiveFrom == effectiveFrom && r.EffectiveTo == effectiveTo
            && r.Status != LeaveStatus.Cancelled && r.Status != LeaveStatus.Declined
            && (excludeId == null || r.Id != excludeId.Value), ct);

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
