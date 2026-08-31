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
/// own account, resolved via <see cref="ResolveCurrentStaffIdAsync"/> (post staff/user
/// unification this is simply the caller's own <see cref="User.Id"/>).
///
/// Access rule: a caller can read ONLY their own shifts (matched on <c>Shift.UserId</c>) and
/// only the participant/medication/routine data attached to those shifts — a shift id
/// belonging to another staff member 404s exactly the same as one that doesn't exist at all,
/// so this surface can never be used to enumerate other staff's roster ids. Coordinator/admin
/// routes (<see cref="RosteringController"/>, <see cref="MedicationsController"/>,
/// <see cref="ParticipantRoutinesController"/>) are unaffected — reads here always go via
/// purpose-built portal DTOs, never the coordinator-scoped ones. The one write surface is witness
/// approve/decline (<see cref="ApproveWitnessRequest"/>/<see cref="DeclineWitnessRequest"/>), and
/// the same "only your own, 404 otherwise" scoping applies — matched on
/// <c>MedicationAdministration.WitnessUserId</c> instead of <c>Shift.UserId</c>. These POSTs
/// still go through <c>ReadOnlyMiddleware</c> like every other write in the app — there is no
/// portal-specific exemption from the ReadOnly role's 403.
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
    /// [from, to]. Defaults to a 14-day window starting today when omitted. Always 200s — when
    /// the caller's identity can't be resolved to a User row at all (should not normally happen
    /// for an authenticated request), this simply returns empty lists rather than an error; there
    /// is no separate "not linked" state any more; every User IS its own staff identity.
    /// </summary>
    [HttpGet("my-shifts")]
    public async Task<ActionResult<ApiResponse<PortalShiftsResponseDto>>> GetMyShifts(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
        {
            return Ok(ApiResponse<PortalShiftsResponseDto>.Ok(
                new PortalShiftsResponseDto(new List<PortalShiftSummaryDto>(), new List<PortalTripAssignmentSummaryDto>())));
        }

        var start = from ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var end = to ?? start.AddDays(13);

        // INTAKE-08: a draft participant can't have a real shift going forward (Rostering's
        // ValidateRefsAsync gates that at creation) — this filter is defence in depth for the
        // edge case of a participant later flipped back to draft mid-edit while an old shift
        // still references them, so the portal never shows it.
        var shifts = await _db.Shifts
            .Include(s => s.Participant)
            .Where(s => s.UserId == staffId.Value && s.ServiceDate >= start && s.ServiceDate <= end
                        && !s.Participant!.IsDraft)
            .OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime)
            .ToListAsync(ct);
        var shiftDtos = shifts.Select(ToSummaryDto).ToList();

        // Trip staffing is optional per the brief — included here since it's a single cheap
        // query against the already-resolved staffId, scoped the same way the shifts are.
        var tripAssignments = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.UserId == staffId.Value && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= end && a.AssignmentEnd >= start)
            .OrderBy(a => a.AssignmentStart)
            .ToListAsync(ct);
        var tripDtos = tripAssignments.Select(a => new PortalTripAssignmentSummaryDto(
            a.Id, a.TripInstanceId, a.TripInstance.TripCode, a.TripInstance.TripName,
            a.AssignmentStart, a.AssignmentEnd, a.IsDriver, a.Status)).ToList();

        return Ok(ApiResponse<PortalShiftsResponseDto>.Ok(
            new PortalShiftsResponseDto(shiftDtos, tripDtos)));
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
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        // INTAKE-08: same defence-in-depth draft exclusion as GetMyShifts above — treat it
        // identically to "no participant at all" rather than surfacing a draft's detail.
        if (shift?.Participant is null || shift.Participant.IsDraft)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        var participant = shift.Participant;

        var routines = await _db.ParticipantRoutines
            .Where(r => r.ParticipantId == participant.Id && r.IsActive)
            .OrderByDescending(r => r.IsCritical).ThenBy(r => r.DayOfWeek).ThenBy(r => r.StartTime)
            .ToListAsync(ct);

        // INTAKE-09: active risk entries only — same active-only scoping as routines/medications
        // above; a retired risk entry is no longer shift-relevant.
        var riskEntries = await _db.ParticipantRiskEntries
            .Where(r => r.ParticipantId == participant.Id && r.IsActive)
            .OrderBy(r => r.AtRiskParty).ThenByDescending(r => r.CreatedAt)
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
            riskEntries.Select(ToRiskEntryDto).ToList(),
            medications.Select(ToMedicationSummaryDto).ToList());

        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(dto));
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFT NOTES (NOTES-01)
    // ══════════════════════════════════════════════════════════════
    //
    // Committed by owner instruction despite the backlog doc's "potential feature" label. There
    // is no shift-completion transition in this domain for the assigned worker to hang note
    // creation off — ShiftStatus.Completed exists as an enum value but nothing anywhere in
    // RosteringController or this controller ever sets it, so a note attaches to the shift
    // directly rather than gating on a completion event the product doesn't actually have.

    /// <summary>
    /// Notes on one of the caller's own shifts, newest first. Same 404-indistinguishable
    /// ownership scoping as <see cref="GetShiftDetail"/> — not linked, shift not found, and
    /// shift-belongs-to-someone-else all 404 identically.
    /// </summary>
    [HttpGet("shifts/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<List<ShiftNoteDto>>>> GetShiftNotes(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<List<ShiftNoteDto>>.Fail("Shift not found."));

        var ownsShift = await _db.Shifts.AnyAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (!ownsShift)
            return NotFound(ApiResponse<List<ShiftNoteDto>>.Fail("Shift not found."));

        var notes = await _db.ShiftNotes
            .Where(n => n.ShiftId == id)
            .OrderByDescending(n => n.CreatedAt)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<ShiftNoteDto>>.Ok(notes.Select(ToShiftNoteDto).ToList()));
    }

    /// <summary>Creates a note on one of the caller's own shifts. Same ownership scoping as <see cref="GetShiftNotes"/>.</summary>
    [HttpPost("shifts/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> CreateShiftNote(
        Guid id, [FromBody] CreateShiftNoteDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Shift not found."));

        var owns = await _db.Shifts.AnyAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (!owns)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Shift not found."));

        var note = new ShiftNote
        {
            Id = Guid.NewGuid(),
            ShiftId = id,
            AuthorUserId = staffId.Value,
            AuthorName = GetCallerName(),
            Body = dto.Body.Trim(),
        };
        // NOTES-02: scan at save time — client-advisory + server-recorded, never blocking.
        note.FlaggedCategories = ShiftNoteKeywordScanner.Scan(note.Body);
        _db.ShiftNotes.Add(note);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note)));
    }

    /// <summary>
    /// Author-only edit of one of the caller's own shift notes — no delete anywhere (compliance-
    /// adjacent record). Not linked, note not found, and note authored by someone else all 404
    /// identically, per the class's ownership convention.
    /// </summary>
    [HttpPut("notes/{noteId:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> UpdateShiftNote(
        Guid noteId, [FromBody] UpdateShiftNoteDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var note = await _db.ShiftNotes.FirstOrDefaultAsync(n => n.Id == noteId && n.AuthorUserId == staffId.Value, ct);
        if (note is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var newBody = dto.Body.Trim();
        // NOTES-02: re-scan on every edit. If the flagged-category set actually changes, clear
        // any prior dismissal — see ShiftNote.FlagsAcknowledgedAt remarks on why a stale dismissal
        // must not silently suppress the prompt for newly-introduced flagged content.
        var newFlags = ShiftNoteKeywordScanner.Scan(newBody);
        if (newFlags != note.FlaggedCategories)
            note.FlagsAcknowledgedAt = null;

        note.Body = newBody;
        note.FlaggedCategories = newFlags;
        note.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note)));
    }

    /// <summary>
    /// NOTES-02: dismisses the "consider filing an incident report?" prompt for one of the
    /// caller's own flagged notes. Persisted server-side (see <see cref="ShiftNote.FlagsAcknowledgedAt"/>
    /// remarks) rather than client-only, so the dismissal survives across devices/sessions. Same
    /// author-only, 404-indistinguishable ownership scoping as <see cref="UpdateShiftNote"/>.
    /// Idempotent — acknowledging an already-acknowledged (or never-flagged) note simply
    /// re-stamps the timestamp rather than erroring.
    /// </summary>
    [HttpPost("notes/{noteId:guid}/acknowledge-flags")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> AcknowledgeShiftNoteFlags(Guid noteId, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var note = await _db.ShiftNotes.FirstOrDefaultAsync(n => n.Id == noteId && n.AuthorUserId == staffId.Value, ct);
        if (note is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        note.FlagsAcknowledgedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note)));
    }

    // ══════════════════════════════════════════════════════════════
    // WITNESS APPROVALS
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// The caller's own pending witness requests — administrations where they were selected as
    /// the staff witness and haven't yet approved/declined. Always 200s; an unlinked account gets
    /// an empty list, matching <see cref="GetMyShifts"/>'s never-500 convention.
    /// </summary>
    [HttpGet("witness-requests")]
    public async Task<ActionResult<ApiResponse<List<PortalWitnessRequestDto>>>> GetWitnessRequests(CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return Ok(ApiResponse<List<PortalWitnessRequestDto>>.Ok(new List<PortalWitnessRequestDto>()));

        var requests = await _db.MedicationAdministrations
            .Include(a => a.Participant)
            .Include(a => a.ParticipantMedication)
            .Where(a => a.WitnessUserId == staffId.Value && a.WitnessStatus == WitnessStatus.Pending)
            .OrderBy(a => a.CreatedAt)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<PortalWitnessRequestDto>>.Ok(requests.Select(ToWitnessRequestDto).ToList()));
    }

    /// <summary>
    /// Approves or declines one of the caller's own pending witness requests. Only the named
    /// witness (matched on their own resolved StaffId, exactly like <see cref="GetShiftDetail"/>
    /// scopes shifts) may act on it — not linked, request not found, and request belongs to
    /// someone else all 404 identically for the same reason documented on the class.
    /// </summary>
    [HttpPost("witness-requests/{id:guid}/approve")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> ApproveWitnessRequest(Guid id, CancellationToken ct) =>
        RespondToWitnessRequestAsync(id, WitnessStatus.Approved, ct);

    [HttpPost("witness-requests/{id:guid}/decline")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> DeclineWitnessRequest(Guid id, CancellationToken ct) =>
        RespondToWitnessRequestAsync(id, WitnessStatus.Declined, ct);

    private async Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> RespondToWitnessRequestAsync(
        Guid id, WitnessStatus response, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        var admin = await _db.MedicationAdministrations
            .Include(a => a.Participant)
            .Include(a => a.ParticipantMedication)
            .FirstOrDefaultAsync(a => a.Id == id && a.WitnessUserId == staffId.Value, ct);
        if (admin == null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        if (admin.WitnessStatus != WitnessStatus.Pending)
            return BadRequest(ApiResponse<PortalWitnessRequestDto>.Fail("This witness request has already been responded to."));

        admin.WitnessStatus = response;
        admin.WitnessRespondedAt = DateTime.UtcNow;
        admin.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<PortalWitnessRequestDto>.Ok(ToWitnessRequestDto(admin)));
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// Resolves the caller's own user id — post staff/user unification this IS the caller's
    /// linked "staff" identity, there being no separate Staff record any more.
    /// <see cref="ICurrentTenant.ViewAsUserId"/> takes priority over the JWT's own subject claim
    /// (see class remarks). Null covers every "no resolvable identity" case uniformly: no
    /// resolvable user id on the token, or the user row not found (or tenant-filtered out).
    /// </summary>
    private async Task<Guid?> ResolveCurrentStaffIdAsync(CancellationToken ct)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        Guid? ownUserId = Guid.TryParse(claim, out var parsed) ? parsed : null;
        var userId = _currentTenant.ViewAsUserId ?? ownUserId;
        if (userId is null) return null;

        var exists = await _db.Users.AnyAsync(u => u.Id == userId.Value, ct);
        return exists ? userId : null;
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

    private static ShiftNoteDto ToShiftNoteDto(ShiftNote n) => new(
        n.Id, n.ShiftId, n.AuthorUserId, n.AuthorName, n.Body, n.CreatedAt, n.UpdatedAt,
        ShiftNoteKeywordVocabulary.ToCategoryNames(n.FlaggedCategories), n.FlagsAcknowledgedAt);

    /// <summary>Same "fullName claim, fall back to the Name claim" idiom as ParticipantNotesController.GetCreatedByName.</summary>
    private string GetCallerName() =>
        User?.FindFirst("fullName")?.Value
        ?? User?.FindFirst(ClaimTypes.Name)?.Value
        ?? "Unknown";

    private static PortalWitnessRequestDto ToWitnessRequestDto(MedicationAdministration a) => new(
        a.Id, a.ParticipantId, a.Participant?.FullName ?? string.Empty,
        a.ParticipantMedicationId, a.ParticipantMedication?.Name ?? string.Empty, a.ParticipantMedication?.Strength,
        a.ParticipantMedication?.DoseDescription ?? string.Empty, a.DoseGiven, a.RecordedByName, a.AdministeredAt,
        a.AdministeredAtTimeZone, a.WitnessStatus, a.WitnessRespondedAt, a.CreatedAt);
}
