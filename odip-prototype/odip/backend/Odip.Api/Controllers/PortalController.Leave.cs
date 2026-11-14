using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

public partial class PortalController
{
    // ══════════════════════════════════════════════════════════════
    // LEAVE + RECURRING UNAVAILABILITY (staff self-service)
    // ══════════════════════════════════════════════════════════════

    /// <summary>The caller's own leave requests and recurring unavailability rules, every status — the staff member's submission history, not just pending ones.</summary>
    [HttpGet("leave")]
    public async Task<ActionResult<ApiResponse<PortalLeaveResponseDto>>> GetMyLeave(CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return Ok(ApiResponse<PortalLeaveResponseDto>.Ok(new PortalLeaveResponseDto()));

        var leave = await _db.LeaveRequests.Include(l => l.User)
            .Where(l => l.UserId == staffId.Value).OrderByDescending(l => l.RequestedAt).ToListAsync(ct);
        var unavailability = await _db.RecurringUnavailabilities.Include(r => r.User)
            .Where(r => r.UserId == staffId.Value).OrderByDescending(r => r.RequestedAt).ToListAsync(ct);

        return Ok(ApiResponse<PortalLeaveResponseDto>.Ok(new PortalLeaveResponseDto
        {
            Leave = leave.Select(ToLeaveDto).ToList(),
            Unavailability = unavailability.Select(ToUnavailabilityDto).ToList(),
        }));
    }

    /// <summary>Any supplied <see cref="CreateLeaveRequestDto.UserId"/> is ignored — always the caller's own id. Lands Pending — the initial state, not the on-behalf shortcut LeaveController's coordinator-side POST /leave uses.</summary>
    [HttpPost("leave")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CreateMyLeaveRequest([FromBody] CreateLeaveRequestDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Staff record not found."));

        // Minor #6: shares LeaveController's internal static validators (same assembly) instead of
        // duplicating the rules inline — keeps the message strings from drifting between the two
        // controllers' otherwise-identical validation.
        var validationError = LeaveController.ValidateLeaveDates(dto.StartDate, dto.EndDate);
        if (validationError != null) return BadRequest(ApiResponse<LeaveRequestDto>.Fail(validationError));

        if (await LeaveController.HasDuplicateLeaveAsync(_db, staffId.Value, dto.LeaveType, dto.StartDate, dto.EndDate, ct))
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("A request of this type already covers some of these dates."));

        var staffTenantId = await StaffTenantIdAsync(staffId.Value, ct);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = staffTenantId, UserId = staffId.Value, LeaveType = dto.LeaveType,
            StartDate = dto.StartDate, EndDate = dto.EndDate, Reason = dto.Reason,
            Status = LeaveStatus.Pending, RequestedByUserId = staffId.Value, RequestedAt = DateTime.UtcNow,
        };
        _db.LeaveRequests.Add(leave);

        // NotificationEventType.LeaveRequestSubmitted — recipients are the tenant's
        // Admin/Coordinator users (design spec §5). One RaiseAsync call per recipient so each
        // outbox row's payload carries that recipient's own email.
        var requesterName = await _db.Users.Where(u => u.Id == staffId.Value)
            .Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefaultAsync(ct) ?? "A staff member";
        var leaveRecipients = await _db.Users
            .Where(u => u.TenantId == staffTenantId && u.IsActive && (u.Role == UserRole.Admin || u.Role == UserRole.Coordinator))
            .ToListAsync(ct);
        foreach (var recipient in leaveRecipients)
        {
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.LeaveRequestSubmitted, "LeaveRequest", leave.Id,
                new[] { recipient.Id },
                new Odip.Infrastructure.Notifications.Templates.LeaveRequestSubmittedPayload(
                    recipient.Email, requesterName, dto.LeaveType.ToString(), dto.StartDate, dto.EndDate),
                ct);
        }

        await _db.SaveChangesAsync(ct);
        await _db.Entry(leave).Reference(l => l.User).LoadAsync(ct);
        // Design spec (docs/specs/2026-09-07-staff-leave-unavailability-design.md:171): POST /portal/leave is 201, not 200.
        return StatusCode(StatusCodes.Status201Created, ApiResponse<LeaveRequestDto>.Ok(ToLeaveDto(leave)));
    }

    /// <summary>Withdraw the caller's own leave request. 404 (never 403) if the id doesn't exist or belongs to someone else — same idiom as every other portal read/write.</summary>
    [HttpPost("leave/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CancelMyLeaveRequest(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));

        var leave = await _db.LeaveRequests.Include(l => l.User)
            .FirstOrDefaultAsync(l => l.Id == id && l.UserId == staffId.Value, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("Only pending requests can be withdrawn."));

        leave.Status = LeaveStatus.Cancelled;
        leave.DecidedByUserId = staffId.Value;
        leave.DecidedAt = DateTime.UtcNow;
        leave.UpdatedAt = DateTime.UtcNow;
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("Only pending requests can be withdrawn."));
        }
        return Ok(ApiResponse<LeaveRequestDto>.Ok(ToLeaveDto(leave)));
    }

    [HttpPost("unavailability")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CreateMyUnavailability(
        [FromBody] CreateRecurringUnavailabilityDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Staff record not found."));

        // Minor #6: shares LeaveController's internal static validator instead of duplicating it.
        var recurringValidationError = LeaveController.ValidateRecurringWindow(dto.StartTime, dto.EndTime, dto.EffectiveFrom, dto.EffectiveTo);
        if (recurringValidationError != null) return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail(recurringValidationError));

        var duplicate = await _db.RecurringUnavailabilities.AnyAsync(r =>
            r.UserId == staffId.Value && r.DayOfWeek == dto.DayOfWeek && r.StartTime == dto.StartTime
            && r.EndTime == dto.EndTime && r.EffectiveFrom == dto.EffectiveFrom && r.EffectiveTo == dto.EffectiveTo
            && r.Status != LeaveStatus.Cancelled && r.Status != LeaveStatus.Declined, ct);
        if (duplicate) return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("An identical request already exists."));

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = await StaffTenantIdAsync(staffId.Value, ct), UserId = staffId.Value, DayOfWeek = dto.DayOfWeek,
            StartTime = dto.StartTime, EndTime = dto.EndTime, EffectiveFrom = dto.EffectiveFrom,
            EffectiveTo = dto.EffectiveTo, Notes = dto.Notes,
            Status = LeaveStatus.Pending, RequestedByUserId = staffId.Value, RequestedAt = DateTime.UtcNow,
        };
        _db.RecurringUnavailabilities.Add(rule);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(rule).Reference(r => r.User).LoadAsync(ct);
        // Design spec (docs/specs/2026-09-07-staff-leave-unavailability-design.md:173): POST /portal/unavailability is 201, not 200.
        return StatusCode(StatusCodes.Status201Created, ApiResponse<RecurringUnavailabilityDto>.Ok(ToUnavailabilityDto(rule)));
    }

    [HttpPost("unavailability/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CancelMyUnavailability(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));

        var rule = await _db.RecurringUnavailabilities.Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Id == id && r.UserId == staffId.Value, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("Only pending requests can be withdrawn."));

        rule.Status = LeaveStatus.Cancelled;
        rule.DecidedByUserId = staffId.Value;
        rule.DecidedAt = DateTime.UtcNow;
        rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(ToUnavailabilityDto(rule)));
    }

    /// <summary>The staff user's own organisation: an unscoped SuperAdmin has no current tenant for the context to stamp a new row from.</summary>
    private Task<Guid> StaffTenantIdAsync(Guid staffId, CancellationToken ct) =>
        _db.Users.Where(u => u.Id == staffId).Select(u => u.TenantId).FirstAsync(ct);

    // These duplicate LeaveController's own ToDto overloads rather than sharing them — matches
    // the codebase's existing precedent of small per-controller mapping/validation helpers (e.g.
    // IsValidStaffRefAsync duplicated across StaffAvailabilityController/StaffAssignmentsController)
    // rather than introducing a shared service the spec doesn't call for.
    private static LeaveRequestDto ToLeaveDto(LeaveRequest l) => new()
    {
        Id = l.Id, UserId = l.UserId, UserFullName = l.User?.FullName ?? string.Empty, LeaveType = l.LeaveType,
        StartDate = l.StartDate, EndDate = l.EndDate, Status = l.Status, Reason = l.Reason,
        RequestedByUserId = l.RequestedByUserId, RequestedAt = l.RequestedAt,
        DecidedByUserId = l.DecidedByUserId, DecidedAt = l.DecidedAt, DecisionNote = l.DecisionNote,
        Source = l.Source, SentHours = l.SentHours, SentHoursDefaulted = l.SentHoursDefaulted,
    };

    private static RecurringUnavailabilityDto ToUnavailabilityDto(RecurringUnavailability r) => new()
    {
        Id = r.Id, UserId = r.UserId, UserFullName = r.User?.FullName ?? string.Empty, DayOfWeek = r.DayOfWeek,
        StartTime = r.StartTime, EndTime = r.EndTime, EffectiveFrom = r.EffectiveFrom, EffectiveTo = r.EffectiveTo,
        Notes = r.Notes, Status = r.Status, RequestedByUserId = r.RequestedByUserId, RequestedAt = r.RequestedAt,
        DecidedByUserId = r.DecidedByUserId, DecidedAt = r.DecidedAt, DecisionNote = r.DecisionNote,
    };

    private static PortalParticipantSummaryDto ToParticipantSummaryDto(Participant p) => new(
        p.Id, p.FullName, p.IsHighSupport, p.IsIntensiveSupport, p.HasRestrictivePracticeFlag,
        p.SupportRatio, p.OvernightSupport, p.MobilityAidWheelchair, p.MobilityAidWalker,
        p.MobilitySupportOptions, p.RequiresHiLoBed, p.RequiresHoist, p.RequiresShowerChair,
        p.RequiresCommode, p.RequiresStandingMachine, p.MobilityNotes, p.EquipmentRequirements,
        p.TransportRequirements, p.MedicalSummary, p.BehaviourRiskSummary);

    private static ParticipantRoutineDto ToRoutineDto(ParticipantRoutine r) => new()
    {
        Id = r.Id,
        ParticipantId = r.ParticipantId,
        Title = r.Title,
        Description = r.Description,
        Category = r.Category,
        Days = ParticipantRoutineDayMapper.ToDayList(r.Days),
        StartTime = r.StartTime,
        EndTime = r.EndTime,
        IsCritical = r.IsCritical,
        IsActive = r.IsActive,
        CreatedAt = r.CreatedAt,
        UpdatedAt = r.UpdatedAt,
    };

    private static ParticipantRiskEntryDto ToRiskEntryDto(ParticipantRiskEntry r) => new()
    {
        Id = r.Id,
        ParticipantId = r.ParticipantId,
        AtRiskParty = r.AtRiskParty,
        Description = r.Description,
        MitigationNotes = r.MitigationNotes,
        IsActive = r.IsActive,
        CreatedAt = r.CreatedAt,
        UpdatedAt = r.UpdatedAt,
    };

    private static PortalMedicationSummaryDto ToMedicationSummaryDto(ParticipantMedication m) => new(
        m.Id, m.Name, m.Strength, m.DoseDescription, m.Type, m.TimesOfDay, m.IsHighRisk, m.IsPsychotropic,
        m.IsChemicalRestraint, m.DrugSchedule, m.SupportLevel, m.PrnIndication);

    private static ShiftNoteDto ToShiftNoteDto(ShiftNote n, Guid? incidentId) => new(
        n.Id, n.ShiftId, n.AuthorUserId, n.AuthorName, n.Body, n.CreatedAt, n.UpdatedAt,
        ShiftNoteKeywordVocabulary.ToCategoryNames(n.FlaggedCategories), n.FlagsAcknowledgedAt, incidentId);

    /// <summary>
    /// Connection-map reverse link (Deliverable 2): for the given shift-note ids, the newest
    /// active IncidentReport whose ShiftNoteId points back at each one — ONE query for the whole
    /// batch (never per-row), same idiom as MedicationsController's administration-id lookup.
    /// </summary>
    private async Task<Dictionary<Guid, Guid>> GetIncidentIdsByShiftNoteIdsAsync(IReadOnlyCollection<Guid> shiftNoteIds, CancellationToken ct)
    {
        if (shiftNoteIds.Count == 0) return new Dictionary<Guid, Guid>();
        var rows = await _db.IncidentReports
            .Where(i => i.IsActive && i.ShiftNoteId != null && shiftNoteIds.Contains(i.ShiftNoteId.Value))
            .Select(i => new { NoteId = i.ShiftNoteId!.Value, i.Id, i.CreatedAt })
            .ToListAsync(ct);
        return rows
            .GroupBy(r => r.NoteId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).First().Id);
    }
}
