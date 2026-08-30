using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// The staff member portal ("My Shifts") — a self-service read surface scoped to the caller's
/// own linked <see cref="Staff"/> record via <see cref="User.StaffId"/>. <see cref="User.StaffId"/>
/// is nullable and nothing populates it at login, so every action here resolves it explicitly
/// and returns a "not linked" payload/404 rather than ever 500ing on a null value.
///
/// Access rule: a caller can read ONLY their own shifts (matched on <c>Shift.StaffId</c>) and
/// only the participant/medication/routine data attached to those shifts — a shift id
/// belonging to another staff member 404s exactly the same as one that doesn't exist at all,
/// so this surface can never be used to enumerate other staff's roster ids. Coordinator/admin
/// routes (<see cref="RosteringController"/>, <see cref="MedicationsController"/>,
/// <see cref="ParticipantRoutinesController"/>) are unaffected — this controller only reads,
/// via purpose-built portal DTOs, never the coordinator-scoped ones.
///
/// Respects the SuperAdmin "view as" switching mechanism: <see cref="ICurrentTenant.ViewAsUserId"/>
/// (set from the X-View-As-User header, only once a SuperAdmin has also scoped to a tenant via
/// X-View-As-Tenant — see <see cref="Odip.Infrastructure.Services.CurrentTenant"/>) takes
/// priority over the caller's own JWT subject claim, so previewing a specific user's portal
/// shows THAT user's shifts, not the SuperAdmin's own (who typically has no linked Staff record
/// at all).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/portal")]
public class PortalController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _currentTenant;

    public PortalController(OdipDbContext db, ICurrentTenant currentTenant)
    {
        _db = db;
        _currentTenant = currentTenant;
    }

    /// <summary>
    /// The caller's own upcoming shifts (and, if cheap, trip staffing assignments) in
    /// [from, to]. Defaults to a 14-day window starting today when omitted. Always 200s —
    /// an unlinked account gets <see cref="PortalShiftsResponseDto.IsLinked"/> false and empty
    /// lists rather than an error, so the frontend can render guidance instead of a broken page.
    /// </summary>
    [HttpGet("my-shifts")]
    public async Task<ActionResult<ApiResponse<PortalShiftsResponseDto>>> GetMyShifts(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
        {
            return Ok(ApiResponse<PortalShiftsResponseDto>.Ok(
                new PortalShiftsResponseDto(false, null, new List<PortalShiftSummaryDto>(), new List<PortalTripAssignmentSummaryDto>())));
        }

        var start = from ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var end = to ?? start.AddDays(13);

        var shifts = await _db.Shifts
            .Include(s => s.Participant)
            .Where(s => s.StaffId == staffId.Value && s.ServiceDate >= start && s.ServiceDate <= end)
            .OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime)
            .ToListAsync(ct);
        var shiftDtos = shifts.Select(ToSummaryDto).ToList();

        // Trip staffing is optional per the brief — included here since it's a single cheap
        // query against the already-resolved staffId, scoped the same way the shifts are.
        var tripAssignments = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.StaffId == staffId.Value && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= end && a.AssignmentEnd >= start)
            .OrderBy(a => a.AssignmentStart)
            .ToListAsync(ct);
        var tripDtos = tripAssignments.Select(a => new PortalTripAssignmentSummaryDto(
            a.Id, a.TripInstanceId, a.TripInstance.TripCode, a.TripInstance.TripName,
            a.AssignmentStart, a.AssignmentEnd, a.IsDriver, a.Status)).ToList();

        return Ok(ApiResponse<PortalShiftsResponseDto>.Ok(
            new PortalShiftsResponseDto(true, staffId, shiftDtos, tripDtos)));
    }

    /// <summary>
    /// Full detail for one of the caller's own shifts: the shift, a participant summary, that
    /// participant's active routines, and an active-medications summary. Not linked, shift not
    /// found, and shift-belongs-to-someone-else all 404 identically — see class remarks on why
    /// this never distinguishes "doesn't exist" from "not yours".
    /// </summary>
    [HttpGet("shifts/{id:guid}")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> GetShiftDetail(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        var shift = await _db.Shifts
            .Include(s => s.Participant)
            .FirstOrDefaultAsync(s => s.Id == id && s.StaffId == staffId.Value, ct);
        if (shift?.Participant is null)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        var participant = shift.Participant;

        var routines = await _db.ParticipantRoutines
            .Where(r => r.ParticipantId == participant.Id && r.IsActive)
            .OrderByDescending(r => r.IsCritical).ThenBy(r => r.DayOfWeek).ThenBy(r => r.StartTime)
            .ToListAsync(ct);

        var medications = await _db.ParticipantMedications
            .Where(m => m.ParticipantId == participant.Id && m.Status == MedicationStatus.Active)
            .OrderBy(m => m.Name)
            .ToListAsync(ct);

        var dto = new PortalShiftDetailDto(
            shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.DurationHours,
            shift.Ratio, shift.NightType, shift.Status, shift.Notes,
            ToParticipantSummaryDto(participant),
            routines.Select(ToRoutineDto).ToList(),
            medications.Select(ToMedicationSummaryDto).ToList());

        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(dto));
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// Resolves the caller's linked Staff id. <see cref="ICurrentTenant.ViewAsUserId"/> takes
    /// priority over the JWT's own subject claim (see class remarks). Null covers every "not
    /// linked" case uniformly: no resolvable user id on the token, the user row not found (or
    /// tenant-filtered out), or a resolved user whose <see cref="User.StaffId"/> is null.
    /// </summary>
    private async Task<Guid?> ResolveCurrentStaffIdAsync(CancellationToken ct)
    {
        var userId = _currentTenant.ViewAsUserId;
        if (userId is null)
        {
            var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!Guid.TryParse(claim, out var parsed)) return null;
            userId = parsed;
        }

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        return user?.StaffId;
    }

    private static PortalShiftSummaryDto ToSummaryDto(Shift s) => new(
        s.Id, s.ParticipantId, s.Participant?.FullName ?? string.Empty, s.ServiceDate, s.StartTime, s.EndTime,
        s.EndsNextDay, s.DurationHours, s.Ratio, s.NightType, s.Status, s.Notes);

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
        DayOfWeek = r.DayOfWeek,
        StartTime = r.StartTime,
        EndTime = r.EndTime,
        IsCritical = r.IsCritical,
        IsActive = r.IsActive,
        CreatedAt = r.CreatedAt,
        UpdatedAt = r.UpdatedAt,
    };

    private static PortalMedicationSummaryDto ToMedicationSummaryDto(ParticipantMedication m) => new(
        m.Id, m.Name, m.Strength, m.DoseDescription, m.Type, m.TimesOfDay, m.IsHighRisk, m.IsPsychotropic,
        m.IsChemicalRestraint, m.DrugSchedule, m.SupportLevel, m.PrnIndication);
}
