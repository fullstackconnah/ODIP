using Microsoft.AspNetCore.Authorization;
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
/// Rostering API (M4 pass 1): the week roster board, shift CRUD, weekly shift-pattern
/// generation, and the staff-participant compatibility matrix. Gated to
/// <c>SuperAdmin,Admin,Coordinator</c> on every action including reads — deliberately
/// STRICTER than <see cref="ScheduleController"/>'s plain <c>[Authorize]</c> (that
/// controller's posture is a separate, pre-existing issue and out of scope here; do not
/// "harmonise" the two). Rostering is coordinator work: the board exposes participant
/// support needs and staff credential/compliance status, and the frontend already excludes
/// rostering from a SupportWorker's visible pages (<c>SUPPORT_WORKER_PAGES</c>) — that
/// nav-level exclusion is not access control on its own, so the API must enforce the same
/// restriction itself rather than relying on the UI to hide it. Every write that touches a
/// shift runs <see cref="RosterConflictService.Check"/> before saving; see
/// <see cref="EvaluateFindings"/> for the Blocking/Warning/override gate.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/rostering")]
public class RosteringController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly RosterConflictService _conflictService = new();
    private readonly ShiftPatternExpander _expander = new();

    /// <summary>Availability types that render as a leave/unavailable bar on the board (matches <see cref="RosterConflictService"/>'s own STAFF_UNAVAILABLE set).</summary>
    private static readonly AvailabilityType[] LeaveTypes =
        { AvailabilityType.Unavailable, AvailabilityType.Leave, AvailabilityType.Training };

    public RosteringController(OdipDbContext db) => _db = db;

    // ══════════════════════════════════════════════════════════════
    // BOARD
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// The whole week in one payload, discriminated on <paramref name="groupBy"/>
    /// (case-insensitive, defaults to <c>participant</c>; an unrecognised value 400s):
    /// participant mode returns one row per ACTIVE participant (shifts including unfilled
    /// ones, trip bars, scheduled hours, days without cover); staff mode returns the pass-1
    /// shape — one row per active staff member plus the unfilled-shift lane. Every finding
    /// across the week flattens into <see cref="RosterBoardDto.Exceptions"/> either way.
    /// Defaults to the current week when <paramref name="weekStart"/> is omitted; any date
    /// supplied is normalised to that week's Monday.
    /// </summary>
    [HttpGet("board")]
    public async Task<ActionResult<ApiResponse<RosterBoardDto>>> GetBoard(
        [FromQuery] DateOnly? weekStart, [FromQuery] string? groupBy, CancellationToken ct)
    {
        if (!TryParseGroupBy(groupBy, out var groupByValue))
        {
            return BadRequest(ApiResponse<RosterBoardDto>.Fail(
                $"Unrecognised groupBy value '{groupBy}'. Expected 'participant' or 'staff'."));
        }

        var start = WeekStart(weekStart ?? DateOnly.FromDateTime(DateTime.UtcNow));
        var end = start.AddDays(6);
        var days = Enumerable.Range(0, 7).Select(i => start.AddDays(i)).ToList();

        // ── Bulk-load everything the week needs once, then compute findings in memory
        // for every shift — avoids one roster-check query set per shift (N+1). ──
        var weekShifts = await _db.Shifts
            .Where(s => s.ServiceDate >= start && s.ServiceDate <= end)
            .ToListAsync(ct);

        var activeStaff = await _db.Staff
            .Where(s => s.IsActive)
            .OrderBy(s => s.LastName).ThenBy(s => s.FirstName)
            .ToListAsync(ct);
        var staffIds = activeStaff.Select(s => s.Id).ToList();
        var staffById = activeStaff.ToDictionary(s => s.Id);

        var weekTripAssignments = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => staffIds.Contains(a.StaffId) && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= end && a.AssignmentEnd >= start)
            .ToListAsync(ct);

        var startDt = start.ToDateTime(TimeOnly.MinValue);
        var endDt = end.ToDateTime(TimeOnly.MaxValue);
        var weekAvailability = await _db.StaffAvailabilities
            .Where(a => staffIds.Contains(a.StaffId) && a.StartDateTime < endDt && a.EndDateTime > startDt)
            .ToListAsync(ct);

        // ── Every ACTIVE participant, not just ones with shifts this week — an empty week
        // is itself the coverage gap the participant-mode board exists to surface. Shifts
        // referencing a participant outside that active set (edge case) still need a name
        // for their ShiftDto/exception, so top up with whichever ids weekShifts references
        // that the active set didn't already cover — still just two queries total. ──
        var activeParticipants = await _db.Participants
            .Where(p => p.IsActive)
            .OrderBy(p => p.LastName).ThenBy(p => p.FirstName)
            .ToListAsync(ct);
        var participantById = activeParticipants.ToDictionary(p => p.Id);
        var shiftParticipantIds = weekShifts.Select(s => s.ParticipantId).Distinct().ToList();
        var missingParticipantIds = shiftParticipantIds.Where(id => !participantById.ContainsKey(id)).ToList();
        if (missingParticipantIds.Count > 0)
        {
            var extraParticipants = await _db.Participants
                .Where(p => missingParticipantIds.Contains(p.Id))
                .ToListAsync(ct);
            foreach (var extra in extraParticipants) participantById[extra.Id] = extra;
        }
        var allParticipantIds = participantById.Keys.ToList();

        var compatByPair = await _db.StaffParticipantCompatibilities
            .Where(c => staffIds.Contains(c.StaffId) && allParticipantIds.Contains(c.ParticipantId))
            .ToDictionaryAsync(c => (c.StaffId, c.ParticipantId), c => c.Level, ct);

        List<RosterFinding> FindingsFor(Shift shift)
        {
            if (shift.StaffId is null || !staffById.TryGetValue(shift.StaffId.Value, out var staff))
                return new List<RosterFinding>();
            if (!participantById.TryGetValue(shift.ParticipantId, out var participant))
                return new List<RosterFinding>();

            var staffShiftsInWeek = weekShifts.Where(s => s.StaffId == shift.StaffId && s.Id != shift.Id).ToList();
            var participantShiftsOnDate = weekShifts
                .Where(s => s.ParticipantId == shift.ParticipantId && s.ServiceDate == shift.ServiceDate && s.Id != shift.Id)
                .ToList();
            var tripAssignments = weekTripAssignments.Where(a => a.StaffId == shift.StaffId).ToList();
            var availability = weekAvailability.Where(a => a.StaffId == shift.StaffId).ToList();
            var compatibility = compatByPair.TryGetValue((shift.StaffId.Value, shift.ParticipantId), out var level)
                ? level : CompatibilityLevel.Allowed;

            var ctx = new RosterCheckContext(staff, participant, staffShiftsInWeek, participantShiftsOnDate,
                tripAssignments, availability, compatibility, RosterConflictService.DefaultWeeklyHoursThreshold);
            return _conflictService.Check(shift, ctx).ToList();
        }

        ShiftDto ToShiftDto(Shift shift, List<RosterFinding> findings)
        {
            participantById.TryGetValue(shift.ParticipantId, out var participant);
            Staff? staff = shift.StaffId.HasValue ? staffById.GetValueOrDefault(shift.StaffId.Value) : null;
            return new ShiftDto
            {
                Id = shift.Id, ParticipantId = shift.ParticipantId, ParticipantName = participant?.FullName ?? string.Empty,
                StaffId = shift.StaffId, StaffName = staff?.FullName,
                ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
                DurationHours = shift.DurationHours, Ratio = shift.Ratio, NightType = shift.NightType, Status = shift.Status,
                ShiftPatternId = shift.ShiftPatternId, Notes = shift.Notes, OverrideReason = shift.OverrideReason,
                Findings = findings.Select(ToFindingDto).ToList()
            };
        }

        // ── Findings are computed once per shift regardless of groupBy — "exceptions" is
        // the same flattened list either way, and both row-building branches below reuse
        // the same dictionary rather than re-running RosterConflictService.Check. ──
        var findingsByShiftId = weekShifts.ToDictionary(s => s.Id, FindingsFor);

        var exceptions = new List<RosterExceptionDto>();
        foreach (var shift in weekShifts)
        {
            participantById.TryGetValue(shift.ParticipantId, out var p);
            foreach (var finding in findingsByShiftId[shift.Id])
            {
                exceptions.Add(new RosterExceptionDto
                {
                    ShiftId = shift.Id, ParticipantName = p?.FullName ?? string.Empty,
                    ServiceDate = shift.ServiceDate, Finding = ToFindingDto(finding)
                });
            }
        }

        RosterBoardDto board;

        if (groupByValue == RosterBoardGroupBy.Participant)
        {
            // Trips overlapping the week, for every participant with a row — an away-on-trip
            // week must read as covered, not as a gap. StartDate is filtered in SQL; EndDate
            // is a computed property (TripInstance.StartDate + DurationDays - 1) that EF
            // can't translate, so the EndDate half of the overlap test runs in memory on the
            // already-materialised list.
            var weekBookings = await _db.ParticipantBookings
                .Include(b => b.TripInstance)
                .Where(b => allParticipantIds.Contains(b.ParticipantId)
                            && b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending
                            && b.TripInstance.StartDate <= end)
                .ToListAsync(ct);
            var weekTripBars = weekBookings.Where(b => b.TripInstance.EndDate >= start).ToList();

            TripBarDto ToParticipantTripBar(ParticipantBooking b) => new()
            {
                TripInstanceId = b.TripInstanceId, TripCode = b.TripInstance.TripCode, TripName = b.TripInstance.TripName,
                StartDate = b.TripInstance.StartDate, EndDate = b.TripInstance.EndDate, IsDriver = false
            };

            var participantRows = new List<RosterParticipantRowDto>();
            foreach (var participant in activeParticipants)
            {
                var participantShifts = weekShifts.Where(s => s.ParticipantId == participant.Id).ToList();
                var shiftDtos = participantShifts.Select(s => ToShiftDto(s, findingsByShiftId[s.Id])).ToList();
                var myTripBars = weekBookings.Where(b => b.ParticipantId == participant.Id).Select(ToParticipantTripBar).ToList();
                var scheduledHours = participantShifts.Where(s => s.Status != ShiftStatus.Cancelled).Sum(s => s.DurationHours);
                var daysWithoutCover = days.Count(d =>
                    !participantShifts.Any(s => s.ServiceDate == d) &&
                    !myTripBars.Any(tb => tb.StartDate <= d && d <= tb.EndDate));

                participantRows.Add(new RosterParticipantRowDto
                {
                    ParticipantId = participant.Id, FullName = participant.FullName,
                    SupportRatio = participant.SupportRatio, OvernightSupport = participant.OvernightSupport,
                    HasRestrictivePractice = participant.HasRestrictivePracticeFlag,
                    Shifts = shiftDtos, TripBars = myTripBars,
                    ScheduledHours = scheduledHours, DaysWithoutCover = daysWithoutCover
                });
            }

            board = new RosterBoardDto
            {
                WeekStart = start, Days = days, GroupBy = RosterBoardGroupBy.Participant,
                ParticipantRows = participantRows, Exceptions = exceptions
            };
        }
        else
        {
            var rows = new List<RosterStaffRowDto>();

            foreach (var staff in activeStaff)
            {
                var staffShifts = weekShifts.Where(s => s.StaffId == staff.Id).ToList();
                var shiftDtos = staffShifts.Select(s => ToShiftDto(s, findingsByShiftId[s.Id])).ToList();

                var (complianceLevel, complianceNotes) = ComputeCompliance(staff, start);
                var rosteredHours = staffShifts.Where(s => s.Status != ShiftStatus.Cancelled).Sum(s => s.DurationHours);

                var myTripBars = weekTripAssignments.Where(a => a.StaffId == staff.Id).Select(a => new TripBarDto
                {
                    TripInstanceId = a.TripInstanceId, TripCode = a.TripInstance.TripCode, TripName = a.TripInstance.TripName,
                    StartDate = a.AssignmentStart, EndDate = a.AssignmentEnd, IsDriver = a.IsDriver
                }).ToList();

                var myLeave = weekAvailability
                    .Where(a => a.StaffId == staff.Id && LeaveTypes.Contains(a.AvailabilityType))
                    .Select(a => new LeaveBarDto
                    {
                        StartDate = DateOnly.FromDateTime(a.StartDateTime), EndDate = DateOnly.FromDateTime(a.EndDateTime),
                        AvailabilityType = a.AvailabilityType, Notes = a.Notes
                    }).ToList();

                rows.Add(new RosterStaffRowDto
                {
                    StaffId = staff.Id, FullName = staff.FullName, Role = staff.Role,
                    Compliance = complianceLevel, ComplianceNotes = complianceNotes,
                    RosteredHours = rosteredHours, TargetHours = RosterConflictService.DefaultWeeklyHoursThreshold,
                    Shifts = shiftDtos, TripBars = myTripBars, Leave = myLeave
                });
            }

            var unfilled = weekShifts
                .Where(s => s.StaffId is null)
                .Select(s => ToShiftDto(s, findingsByShiftId[s.Id]))
                .ToList();

            board = new RosterBoardDto
            {
                WeekStart = start, Days = days, GroupBy = RosterBoardGroupBy.Staff,
                StaffRows = rows, Unfilled = unfilled, Exceptions = exceptions
            };
        }

        return Ok(ApiResponse<RosterBoardDto>.Ok(board));
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFTS
    // ══════════════════════════════════════════════════════════════

    /// <summary>Dry-run findings for a candidate shift. Never writes — the same check every gated write runs, exposed for live validation as the coordinator edits.</summary>
    [HttpPost("shifts/check")]
    public async Task<ActionResult<ApiResponse<List<RosterFindingDto>>>> CheckShift(
        [FromBody] CheckShiftDto dto, CancellationToken ct)
    {
        var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
        if (refError != null) return BadRequest(ApiResponse<List<RosterFindingDto>>.Fail(refError));

        var candidate = new Shift
        {
            Id = dto.Id ?? Guid.Empty, ParticipantId = dto.ParticipantId, StaffId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType
        };

        var findings = await CheckAsync(candidate, dto.Id, ct);
        return Ok(ApiResponse<List<RosterFindingDto>>.Ok(findings.Select(ToFindingDto).ToList()));
    }

    /// <summary>Create a shift. Runs the roster check before saving — see <see cref="EvaluateFindings"/>.</summary>
    [HttpPost("shifts")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> CreateShift(
        [FromBody] CreateShiftDto dto, CancellationToken ct)
    {
        var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
        if (refError != null) return BadRequest(ApiResponse<ShiftDto>.Fail(refError));

        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = dto.ParticipantId, StaffId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType, ShiftPatternId = dto.ShiftPatternId, Notes = dto.Notes,
            Status = ShiftStatus.Draft
        };

        var findings = await CheckAsync(shift, null, ct);
        var rejection = EvaluateFindings(findings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        ApplyOverride(shift, findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);

        _db.Shifts.Add(shift);
        await _db.SaveChangesAsync(ct);

        // No GET /shifts/{id} route exists in the spec's API table (the board and shift-list
        // reads all go through GET /board) — an Ok response is the correct shape here rather
        // than CreatedAtAction pointing at a nonexistent action.
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    /// <summary>Update a shift. Re-runs the roster check against the edited candidate (excluding the shift's own prior row) before saving.</summary>
    [HttpPut("shifts/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> UpdateShift(
        Guid id, [FromBody] UpdateShiftDto dto, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));

        var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
        if (refError != null) return BadRequest(ApiResponse<ShiftDto>.Fail(refError));

        var candidate = new Shift
        {
            Id = shift.Id, ParticipantId = dto.ParticipantId, StaffId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType
        };

        var findings = await CheckAsync(candidate, shift.Id, ct);
        var rejection = EvaluateFindings(findings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        shift.ParticipantId = dto.ParticipantId; shift.StaffId = dto.StaffId;
        shift.ServiceDate = dto.ServiceDate; shift.StartTime = dto.StartTime; shift.EndTime = dto.EndTime;
        shift.EndsNextDay = dto.EndsNextDay; shift.Ratio = dto.Ratio; shift.NightType = dto.NightType;
        shift.ShiftPatternId = dto.ShiftPatternId; shift.Notes = dto.Notes; shift.Status = dto.Status;
        shift.UpdatedAt = DateTime.UtcNow;
        ApplyOverride(shift, findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    /// <summary>Delete a shift outright. Not roster-checked — removing a shift can never itself create a conflict.</summary>
    [HttpDelete("shifts/{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteShift(Guid id, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<bool>.Fail("Shift not found."));

        _db.Shifts.Remove(shift);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>Set or clear a shift's staff member. Clearing (StaffId null) always succeeds — an unfilled shift skips every staff-dependent rule.</summary>
    [HttpPost("shifts/{id:guid}/assign")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> AssignShift(
        Guid id, [FromBody] AssignShiftDto dto, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));

        if (dto.StaffId.HasValue && !await _db.Staff.AnyAsync(s => s.Id == dto.StaffId.Value, ct))
            return BadRequest(ApiResponse<ShiftDto>.Fail("Staff member not found."));

        var candidate = new Shift
        {
            Id = shift.Id, ParticipantId = shift.ParticipantId, StaffId = dto.StaffId,
            ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime,
            EndsNextDay = shift.EndsNextDay, Ratio = shift.Ratio, NightType = shift.NightType
        };

        var findings = await CheckAsync(candidate, shift.Id, ct);
        var rejection = EvaluateFindings(findings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        shift.StaffId = dto.StaffId;
        shift.UpdatedAt = DateTime.UtcNow;
        ApplyOverride(shift, findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFT PATTERNS
    // ══════════════════════════════════════════════════════════════

    /// <summary>List patterns, optionally filtered by participant.</summary>
    [HttpGet("patterns")]
    public async Task<ActionResult<ApiResponse<List<ShiftPatternDto>>>> GetPatterns(
        [FromQuery] Guid? participantId, CancellationToken ct)
    {
        var query = _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultStaff).AsQueryable();
        if (participantId.HasValue) query = query.Where(p => p.ParticipantId == participantId.Value);

        var patterns = await query.OrderBy(p => p.DayOfWeek).ThenBy(p => p.StartTime).ToListAsync(ct);
        return Ok(ApiResponse<List<ShiftPatternDto>>.Ok(patterns.Select(ToPatternDto).ToList()));
    }

    /// <summary>Get a single pattern.</summary>
    [HttpGet("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> GetPatternById(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultStaff)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));

        return Ok(ApiResponse<ShiftPatternDto>.Ok(ToPatternDto(pattern)));
    }

    /// <summary>Create a weekly-recurring shift pattern. Not roster-checked — generation checks its own candidates via <c>POST /shifts/check</c> if the frontend chooses to.</summary>
    [HttpPost("patterns")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> CreatePattern(
        [FromBody] CreateShiftPatternDto dto, CancellationToken ct)
    {
        if (!await _db.Participants.AnyAsync(p => p.Id == dto.ParticipantId, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Participant not found."));
        if (dto.DefaultStaffId.HasValue && !await _db.Staff.AnyAsync(s => s.Id == dto.DefaultStaffId.Value, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Staff member not found."));

        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), ParticipantId = dto.ParticipantId, DefaultStaffId = dto.DefaultStaffId,
            DayOfWeek = dto.DayOfWeek, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType, EffectiveFrom = dto.EffectiveFrom, EffectiveTo = dto.EffectiveTo,
            IsActive = dto.IsActive, Notes = dto.Notes
        };
        _db.ShiftPatterns.Add(pattern);
        await _db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetPatternById), new { id = pattern.Id },
            ApiResponse<ShiftPatternDto>.Ok(await LoadPatternDtoAsync(pattern.Id, ct)));
    }

    /// <summary>Update a pattern's definition. Does not touch shifts already generated from it.</summary>
    [HttpPut("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> UpdatePattern(
        Guid id, [FromBody] UpdateShiftPatternDto dto, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));

        if (!await _db.Participants.AnyAsync(p => p.Id == dto.ParticipantId, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Participant not found."));
        if (dto.DefaultStaffId.HasValue && !await _db.Staff.AnyAsync(s => s.Id == dto.DefaultStaffId.Value, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Staff member not found."));

        pattern.ParticipantId = dto.ParticipantId; pattern.DefaultStaffId = dto.DefaultStaffId;
        pattern.DayOfWeek = dto.DayOfWeek; pattern.StartTime = dto.StartTime; pattern.EndTime = dto.EndTime;
        pattern.EndsNextDay = dto.EndsNextDay; pattern.Ratio = dto.Ratio; pattern.NightType = dto.NightType;
        pattern.EffectiveFrom = dto.EffectiveFrom; pattern.EffectiveTo = dto.EffectiveTo; pattern.IsActive = dto.IsActive;
        pattern.Notes = dto.Notes;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftPatternDto>.Ok(await LoadPatternDtoAsync(pattern.Id, ct)));
    }

    /// <summary>Delete a pattern. Shifts already generated from it are left in place (provenance only, no cascade).</summary>
    [HttpDelete("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> DeletePattern(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<bool>.Fail("Pattern not found."));

        _db.ShiftPatterns.Remove(pattern);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>
    /// Materialise a pattern into concrete Draft shifts across [from, to] via
    /// <see cref="ShiftPatternExpander.Occurrences"/>. Idempotent: any date in range that
    /// already carries a shift with this pattern's Id is skipped rather than duplicated, so
    /// running the same range twice in a row creates nothing the second time.
    /// </summary>
    [HttpPost("patterns/{id:guid}/generate")]
    public async Task<ActionResult<ApiResponse<GeneratePatternResultDto>>> GeneratePattern(
        Guid id, [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<GeneratePatternResultDto>.Fail("Pattern not found."));

        var occurrences = _expander.Occurrences(pattern, from, to);
        if (occurrences.Count == 0)
            return Ok(ApiResponse<GeneratePatternResultDto>.Ok(new GeneratePatternResultDto { Created = 0, Skipped = 0 }));

        var existingDates = await _db.Shifts
            .Where(s => s.ShiftPatternId == pattern.Id && occurrences.Contains(s.ServiceDate))
            .Select(s => s.ServiceDate)
            .ToListAsync(ct);
        var existingSet = existingDates.ToHashSet();

        int created = 0, skipped = 0;
        foreach (var date in occurrences)
        {
            if (existingSet.Contains(date)) { skipped++; continue; }

            _db.Shifts.Add(new Shift
            {
                Id = Guid.NewGuid(), ParticipantId = pattern.ParticipantId, StaffId = pattern.DefaultStaffId,
                ServiceDate = date, StartTime = pattern.StartTime, EndTime = pattern.EndTime, EndsNextDay = pattern.EndsNextDay,
                Ratio = pattern.Ratio, NightType = pattern.NightType, Status = ShiftStatus.Draft, ShiftPatternId = pattern.Id
            });
            created++;
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<GeneratePatternResultDto>.Ok(new GeneratePatternResultDto { Created = created, Skipped = skipped }));
    }

    // ══════════════════════════════════════════════════════════════
    // COMPATIBILITY MATRIX
    // ══════════════════════════════════════════════════════════════

    /// <summary>List compatibility rows, optionally filtered by participant. Absence of a row for a pair means Allowed — this only returns rows that actually exist.</summary>
    [HttpGet("compatibility")]
    public async Task<ActionResult<ApiResponse<List<CompatibilityRowDto>>>> GetCompatibility(
        [FromQuery] Guid? participantId, CancellationToken ct)
    {
        var query = _db.StaffParticipantCompatibilities.Include(c => c.Staff).Include(c => c.Participant).AsQueryable();
        if (participantId.HasValue) query = query.Where(c => c.ParticipantId == participantId.Value);

        var rows = await query.ToListAsync(ct);
        return Ok(ApiResponse<List<CompatibilityRowDto>>.Ok(rows.Select(ToCompatibilityDto).ToList()));
    }

    /// <summary>Upsert one compatibility cell (StaffId, ParticipantId).</summary>
    [HttpPut("compatibility")]
    public async Task<ActionResult<ApiResponse<CompatibilityRowDto>>> UpsertCompatibility(
        [FromBody] UpsertCompatibilityDto dto, CancellationToken ct)
    {
        if (!await _db.Staff.AnyAsync(s => s.Id == dto.StaffId, ct))
            return BadRequest(ApiResponse<CompatibilityRowDto>.Fail("Staff member not found."));
        if (!await _db.Participants.AnyAsync(p => p.Id == dto.ParticipantId, ct))
            return BadRequest(ApiResponse<CompatibilityRowDto>.Fail("Participant not found."));

        var row = await _db.StaffParticipantCompatibilities
            .FirstOrDefaultAsync(c => c.StaffId == dto.StaffId && c.ParticipantId == dto.ParticipantId, ct);

        if (row == null)
        {
            row = new StaffParticipantCompatibility { Id = Guid.NewGuid(), StaffId = dto.StaffId, ParticipantId = dto.ParticipantId };
            _db.StaffParticipantCompatibilities.Add(row);
        }

        row.Level = dto.Level;
        row.Reason = dto.Reason;
        row.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        var loaded = await _db.StaffParticipantCompatibilities
            .Include(c => c.Staff).Include(c => c.Participant)
            .FirstAsync(c => c.Id == row.Id, ct);
        return Ok(ApiResponse<CompatibilityRowDto>.Ok(ToCompatibilityDto(loaded)));
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    /// <summary>Monday of the week containing <paramref name="date"/>.</summary>
    private static DateOnly WeekStart(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

    /// <summary>
    /// Parses the board's <c>groupBy</c> query param case-insensitively. Missing/empty
    /// defaults to <see cref="RosterBoardGroupBy.Participant"/>; anything other than
    /// "participant" or "staff" fails so the caller can 400 rather than silently defaulting.
    /// </summary>
    private static bool TryParseGroupBy(string? raw, out RosterBoardGroupBy result)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            result = RosterBoardGroupBy.Participant;
            return true;
        }

        if (string.Equals(raw, "participant", StringComparison.OrdinalIgnoreCase))
        {
            result = RosterBoardGroupBy.Participant;
            return true;
        }

        if (string.Equals(raw, "staff", StringComparison.OrdinalIgnoreCase))
        {
            result = RosterBoardGroupBy.Staff;
            return true;
        }

        result = default;
        return false;
    }

    private static RosterFindingDto ToFindingDto(RosterFinding f) => new() { Code = f.Code, Severity = f.Severity, Message = f.Message };

    private static ShiftPatternDto ToPatternDto(ShiftPattern p) => new()
    {
        Id = p.Id, ParticipantId = p.ParticipantId, ParticipantName = p.Participant?.FullName ?? string.Empty,
        DefaultStaffId = p.DefaultStaffId, DefaultStaffName = p.DefaultStaff?.FullName,
        DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay,
        Ratio = p.Ratio, NightType = p.NightType, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo,
        IsActive = p.IsActive, Notes = p.Notes
    };

    private static CompatibilityRowDto ToCompatibilityDto(StaffParticipantCompatibility c) => new()
    {
        Id = c.Id, StaffId = c.StaffId, StaffName = c.Staff?.FullName ?? string.Empty,
        ParticipantId = c.ParticipantId, ParticipantName = c.Participant?.FullName ?? string.Empty,
        Level = c.Level, Reason = c.Reason, UpdatedAt = c.UpdatedAt
    };

    private async Task<ShiftPatternDto> LoadPatternDtoAsync(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultStaff)
            .FirstAsync(p => p.Id == id, ct);
        return ToPatternDto(pattern);
    }

    private async Task<ShiftDto> ToShiftDtoAsync(Shift shift, List<RosterFinding> findings, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == shift.ParticipantId, ct);
        var staff = shift.StaffId.HasValue
            ? await _db.Staff.FirstOrDefaultAsync(s => s.Id == shift.StaffId.Value, ct)
            : null;

        return new ShiftDto
        {
            Id = shift.Id, ParticipantId = shift.ParticipantId, ParticipantName = participant?.FullName ?? string.Empty,
            StaffId = shift.StaffId, StaffName = staff?.FullName,
            ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
            DurationHours = shift.DurationHours, Ratio = shift.Ratio, NightType = shift.NightType, Status = shift.Status,
            ShiftPatternId = shift.ShiftPatternId, Notes = shift.Notes, OverrideReason = shift.OverrideReason,
            Findings = findings.Select(ToFindingDto).ToList()
        };
    }

    /// <summary>Participant must exist; staff, when supplied, must exist. Returns a user-facing error string, or null when both refs are valid.</summary>
    private async Task<string?> ValidateRefsAsync(Guid participantId, Guid? staffId, CancellationToken ct)
    {
        if (!await _db.Participants.AnyAsync(p => p.Id == participantId, ct))
            return "Participant not found.";
        if (staffId.HasValue && !await _db.Staff.AnyAsync(s => s.Id == staffId.Value, ct))
            return "Staff member not found.";
        return null;
    }

    /// <summary>
    /// Builds the <see cref="RosterCheckContext"/> for <paramref name="candidate"/> and runs
    /// <see cref="RosterConflictService.Check"/>. Unfilled shifts (<see cref="Shift.StaffId"/>
    /// null) skip every staff-dependent rule entirely, per the M4 design brief, rather than
    /// attempting to load a staff member that doesn't exist. <paramref name="excludeId"/> is
    /// the shift's own prior Id on an update/assign (falls back to <paramref name="candidate"/>'s
    /// own Id), so a shift never conflicts with itself.
    /// </summary>
    private async Task<List<RosterFinding>> CheckAsync(Shift candidate, Guid? excludeId, CancellationToken ct)
    {
        if (candidate.StaffId is null)
            return new List<RosterFinding>();

        var staff = await _db.Staff.FirstOrDefaultAsync(s => s.Id == candidate.StaffId.Value, ct);
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == candidate.ParticipantId, ct);
        if (staff is null || participant is null)
            return new List<RosterFinding>();

        var weekStart = WeekStart(candidate.ServiceDate);
        var weekEnd = weekStart.AddDays(6);
        var excludeShiftId = excludeId ?? candidate.Id;

        var staffShiftsInWeek = await _db.Shifts
            .Where(s => s.StaffId == candidate.StaffId.Value && s.ServiceDate >= weekStart && s.ServiceDate <= weekEnd
                        && s.Id != excludeShiftId)
            .ToListAsync(ct);

        var participantShiftsOnDate = await _db.Shifts
            .Where(s => s.ParticipantId == candidate.ParticipantId && s.ServiceDate == candidate.ServiceDate
                        && s.Id != excludeShiftId)
            .ToListAsync(ct);

        var tripAssignments = await _db.StaffAssignments
            .Where(a => a.StaffId == candidate.StaffId.Value && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= candidate.ServiceDate && a.AssignmentEnd >= candidate.ServiceDate)
            .ToListAsync(ct);

        var dayStart = candidate.ServiceDate.ToDateTime(TimeOnly.MinValue);
        var dayEnd = (candidate.EndsNextDay ? candidate.ServiceDate.AddDays(1) : candidate.ServiceDate).ToDateTime(TimeOnly.MaxValue);
        var availability = await _db.StaffAvailabilities
            .Where(a => a.StaffId == candidate.StaffId.Value && a.StartDateTime < dayEnd && a.EndDateTime > dayStart)
            .ToListAsync(ct);

        var compatibility = await _db.StaffParticipantCompatibilities
            .Where(c => c.StaffId == candidate.StaffId.Value && c.ParticipantId == candidate.ParticipantId)
            .Select(c => (CompatibilityLevel?)c.Level)
            .FirstOrDefaultAsync(ct) ?? CompatibilityLevel.Allowed;

        var ctx = new RosterCheckContext(staff, participant, staffShiftsInWeek, participantShiftsOnDate,
            tripAssignments, availability, compatibility, RosterConflictService.DefaultWeeklyHoursThreshold);

        return _conflictService.Check(candidate, ctx).ToList();
    }

    /// <summary>
    /// The Blocking/Warning/override gate every roster write runs through:
    /// any Blocking finding rejects the write regardless of <paramref name="overrideReason"/>;
    /// Warning findings without a reason reject; Warning findings with a non-empty reason (or
    /// no findings at all) pass through and let the caller save. Returns the 422 response body
    /// to return, or null when the write may proceed. Built via <see cref="ApiResponse{T}.Fail(T, List{string}, string?)"/>
    /// so a rejected write carries the SAME envelope shape as a success — findings in
    /// <c>data</c>, not a separate errors-only slot — matching what the frontend already reads.
    /// </summary>
    private ApiResponse<List<RosterFindingDto>>? EvaluateFindings(List<RosterFinding> findings, string? overrideReason)
    {
        if (findings.Count == 0) return null;

        var findingDtos = findings.Select(ToFindingDto).ToList();
        var errors = findings.Select(f => f.Message).ToList();

        if (findings.Any(f => f.Severity == RosterFindingSeverity.Blocking))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, "One or more blocking findings prevent this shift from being saved.");
        }

        if (string.IsNullOrWhiteSpace(overrideReason))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, "This shift has warnings that must be acknowledged with an override reason before it can be saved.");
        }

        return null;
    }

    /// <summary>Persists (or clears) the override fields to match the outcome <see cref="EvaluateFindings"/> already approved.</summary>
    private static void ApplyOverride(Shift shift, List<RosterFinding> findings, string? overrideReason, List<string>? acknowledgedCodes)
    {
        if (findings.Count == 0)
        {
            shift.OverrideReason = null;
            shift.AcknowledgedFindingCodes = null;
            return;
        }

        shift.OverrideReason = overrideReason;
        var codes = acknowledgedCodes is { Count: > 0 } ? acknowledgedCodes : findings.Select(f => f.Code).Distinct();
        shift.AcknowledgedFindingCodes = string.Join(",", codes);
    }

    /// <summary>Staff-level compliance for the board row, evaluated once at the week's Monday — independent of any specific shift's findings.</summary>
    private static (RosterComplianceLevel Level, List<string> Notes) ComputeCompliance(Staff staff, DateOnly weekStart)
    {
        // Blocked only for a screening that has genuinely lapsed — a verified regulatory
        // prohibition. A screening that simply hasn't been recorded yet is a records gap, not
        // a verdict on the worker, and only downgrades to Warning below (mirrors WSC_EXPIRED
        // vs WSC_MISSING in RosterConflictService).
        if (staff.WorkerScreeningExpiryDate is { } expiry && expiry < weekStart)
        {
            return (RosterComplianceLevel.Blocked, new List<string>
            {
                $"{staff.FullName}'s worker screening expired {expiry:d MMM yyyy}."
            });
        }

        var notes = new List<string>();
        if (staff.WorkerScreeningExpiryDate is null)
            notes.Add($"{staff.FullName} has no worker screening recorded — confirm it before the shift.");
        if (staff.IsFirstAidQualified && staff.FirstAidExpiryDate is { } firstAid && firstAid < weekStart)
            notes.Add($"{staff.FullName}'s first aid certificate expired {firstAid:d MMM yyyy}.");
        if (staff.IsDriverEligible && staff.DriverLicenceExpiryDate is { } licence && licence < weekStart)
            notes.Add($"{staff.FullName}'s driver licence expired {licence:d MMM yyyy}.");
        if (staff.IsManualHandlingCompetent && staff.ManualHandlingExpiryDate is { } manualHandling && manualHandling < weekStart)
            notes.Add($"{staff.FullName}'s manual handling competency expired {manualHandling:d MMM yyyy}.");
        if (staff.IsMedicationCompetent && staff.MedicationCompetencyExpiryDate is { } medication && medication < weekStart)
            notes.Add($"{staff.FullName}'s medication competency expired {medication:d MMM yyyy}.");

        return notes.Count > 0 ? (RosterComplianceLevel.Warning, notes) : (RosterComplianceLevel.Ok, notes);
    }
}
