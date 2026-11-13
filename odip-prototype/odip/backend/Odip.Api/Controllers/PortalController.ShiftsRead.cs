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
        // shortcut: one org zone for the whole list, so a shift at a place in another zone is listed in the org zone; batch a ForShiftsAsync if that bites.
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        if (staffId is null)
        {
            return Ok(ApiResponse<PortalShiftsResponseDto>.Ok(
                new PortalShiftsResponseDto(new List<PortalShiftSummaryDto>(), new List<PortalTripAssignmentSummaryDto>(), provider.Id)));
        }

        var start = from ?? ProviderLocalTime.TodayIn(NowUtc, provider.Zone);
        var end = to ?? start.AddDays(13);
        // INTAKE-08: a draft whose services have not begun ("Begin services") can't have a real shift going forward (Rostering's
        // ValidateRefsAsync gates that at creation) — this filter is defence in depth for the
        // edge case of a participant later flipped back to draft mid-edit while an old shift
        // still references them, so the portal never shows it.
        // L1 (2026-10-16): a Draft is invisible to its worker until it is published.
        var shifts = await _db.Shifts
            .Include(s => s.Participant)
            .Where(Shift.VisibleToWorker)
            .Where(s => s.UserId == staffId.Value && s.ServiceDate >= start && s.ServiceDate <= end && s.Participant != null)
            .OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime)
            .ToListAsync(ct);
        // Finish later: a shift still waiting on its worker's details stays in the list whatever its date, until the details are in or it is approved or returned.
        var outOfWindow = await _db.Shifts
            .Include(s => s.Participant)
            .Where(Shift.VisibleToWorker)
            .Where(s => s.UserId == staffId.Value && s.Status == ShiftStatus.PendingReview && (s.ServiceDate < start || s.ServiceDate > end) && s.Participant != null
                && _db.ShiftCompletions.Any(c => c.ShiftId == s.Id && c.IsActive && c.DetailsRequired))
            .ToListAsync(ct);
        var pendingShiftIds = shifts.Concat(outOfWindow).Where(s => s.Status == ShiftStatus.PendingReview).Select(s => s.Id).ToList();
        var completionByShift = await _db.ShiftCompletions.AsNoTracking()
            .Where(c => pendingShiftIds.Contains(c.ShiftId) && c.IsActive).Select(c => new { c.ShiftId, c.Id }).ToDictionaryAsync(c => c.ShiftId, c => c.Id, ct);
        var missingByCompletion = await ShiftCompletionMapper.MissingDetailsAsync(_db, completionByShift.Values.ToList(), ct);
        IReadOnlyList<string> MissingFor(Shift s) => completionByShift.TryGetValue(s.Id, out var cid) ? missingByCompletion[cid] : Array.Empty<string>();
        var shiftDtos = shifts.Concat(outOfWindow.Where(s => MissingFor(s).Count > 0))
            .Where(s => Participant.ServicesBegun(s.Participant!))
            .OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime)
            .Select(s => ToSummaryDto(s, MissingFor(s), provider.Zone)).ToList();

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
            a.AssignmentStart, a.AssignmentEnd, a.IsDriver, a.Status,
            NullIfBlank(a.TripInstance.Destination), NullIfBlank(a.AssignmentRole))).ToList();

        // H55-1: while group activities are off a worker is not offered an activity whose Start would answer 409.
        var activityDtos = _currentTenant.TenantId is { } tenantId && await GroupActivitiesController.FlagOnAsync(_db, tenantId, ct)
            ? await PortalActivityShifts.ListAsync(_db, staffId.Value, start, end, ProviderLocalTime.TodayIn(NowUtc, provider.Zone), ct)
            : new List<PortalActivityShiftDto>();
        return Ok(ApiResponse<PortalShiftsResponseDto>.Ok(
            new PortalShiftsResponseDto(shiftDtos, tripDtos, provider.Id, activityDtos)));
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
        var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
        if (error is not null) return error;

        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift!, ct)));
    }

    /// <summary>
    /// Shared shift-detail builder for GetShiftDetail/StartShift/FinishShift (shift-completion
    /// design spec §2) — all three need the same participant/routines/risk/medications/
    /// completion shape. Assumes shift.Participant is already loaded (every caller Includes it
    /// and null-checks first).
    /// </summary>
    private async Task<PortalShiftDetailDto> BuildShiftDetailDtoAsync(Shift shift, CancellationToken ct)
    {
        var participant = shift.Participant!;

        var routines = await _db.ParticipantRoutines
            .Where(r => r.ParticipantId == participant.Id && r.IsActive)
            .OrderByDescending(r => r.IsCritical).ThenBy(r => r.Days).ThenBy(r => r.StartTime)
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

        var activeCompletion = await _db.ShiftCompletions
            .Where(c => c.ShiftId == shift.Id && c.IsActive)
            .FirstOrDefaultAsync(ct);
        var completionDto = activeCompletion is null ? null : await ToShiftCompletionDtoAsync(activeCompletion, shift.ReturnCount, ct);
        var breakDtos = completionDto?.Breaks ?? Array.Empty<ShiftBreakDto>();

        // NEED-TO-KNOW BY SHIFT STATUS AND TIME: the handover, the emergency contacts and the address are for a worker who is doing the shift (InProgress) or
        // is about to (Published, from 48 hours before its rostered start). A worker whose shift is PendingReview, Completed, Cancelled or Draft - or a
        // Published shift further out than that - keeps seeing the shift itself but not the participant's phone numbers, address or the latest handover
        // through it. Withheld = explicit null, with the reason.
        var provider = await ProviderTimeZoneResolver.ForShiftAsync(_db, shift, ct);
        var sensitiveWithheldReason = SensitiveInfoWithheld(shift, provider);
        var showSensitive = sensitiveWithheldReason is null;

        // Handover baton pass (D4): the latest handover from a PREVIOUS shift for this participant, with the caller's
        // own read state, and the last 3 holders. The caller is the shift's own worker (ownership was established).
        var handoverView = showSensitive
            ? await _handover.GetAsync(shift, shift.UserId!.Value, ct)
            : new HandoverView(null, Array.Empty<PortalHandoverTrailEntryDto>());

        // Need-to-know package data: the provider's zone, the critical care facts, emergency contacts, doses due in the
        // rostered window (overdue in provider-local time), routines matched to the window, and whether the caller may
        // record doses (Medication Competency).
        var providerToday = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(NowUtc, provider.Zone));
        var contacts = showSensitive ? await _package.GetEmergencyContactsAsync(participant.Id, providerToday, ct) : null;
        var doses = await _package.GetDosesAsync(shift, provider, includePrn: true, ct);
        var shiftRoutines = ShiftPackageService.MatchRoutines(shift, routines, await _package.GetRoutineChecksAsync(activeCompletion?.Id, ct));

        // The End checklist: what would stop Finish right now (only meaningful while the shift is in progress). Derived from the dose
        // slots already fetched above, so the detail never queries them twice. In ENFORCE mode a worker without a current Medication
        // Competency cannot record a dose, so no dose blocks them; in WARN mode (the default) they can record (flagged), so doses block
        // them like anyone (see ShiftPackageService). A dose whose time has not arrived yet never blocks either.
        var access = await _recorder.CheckRecordingAccessAsync(shift.UserId, shift.TenantId, ct);
        var finishBlockers = shift.Status == ShiftStatus.InProgress
            ? ShiftPackageService.BuildFinishBlockers(
                doses.Slots, breakRunning: breakDtos.Any(b => b.IsRunning), access.CanRecord, NowUtc, provider.Zone)
            : new List<PortalFinishBlockerDto>();

        // Return context (critique P2) — "return archives the completion and GET /portal/shifts/{id}
        // returns only the active one, so the resubmitting worker sees ReturnCount and nothing about
        // why". Most recent Returned row's reason, independent of the current active completion.
        var lastReturnReason = await _db.ShiftCompletions
            .Where(c => c.ShiftId == shift.Id && !c.IsActive && c.ReviewOutcome == ReviewOutcome.Returned)
            .OrderByDescending(c => c.ReviewedAt)
            .Select(c => c.ReturnReason)
            .FirstOrDefaultAsync(ct);

        // The organisation switch only: the portal knows no agreement block. No settings row is the policy default (on).
        var travelAsked = PlanPricingPolicy.From(await _db.PlanPricingSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == shift.TenantId, ct)).ClaimProviderTravel;

        // The tenant is named on the query: a SuperAdmin context has no filter. A hidden place still shows, so a past shift keeps its place.
        var serviceLocation = shift.ServiceLocationId is { } placeId
            ? await _db.ServiceLocations.AsNoTracking().Where(l => l.Id == placeId && l.TenantId == shift.TenantId).Select(l => new PortalServiceLocationDto(l.Name, l.Address)).FirstOrDefaultAsync(ct)
            : null;

        return new PortalShiftDetailDto(
            shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, ProviderLocalTime.RosteredHours(shift, provider.Zone),
            shift.Ratio, shift.NightType, shift.Status, shift.Notes,
            ToParticipantSummaryDto(participant),
            routines.Select(ToRoutineDto).ToList(),
            riskEntries.Select(ToRiskEntryDto).ToList(),
            medications.Select(ToMedicationSummaryDto).ToList(),
            completionDto,
            shift.ReturnCount,
            lastReturnReason,
            breakDtos,
            handoverView.Latest,
            handoverView.Trail,
            finishBlockers,
            provider.Id,
            showSensitive ? ShiftPackageService.BuildAtAGlance(participant) : ShiftPackageService.BuildAtAGlance(participant) with { Address = null },
            contacts,
            doses.Slots,
            doses.Prn,
            shiftRoutines,
            access.CanRecord,
            access.Reason,
            access.Code,
            sensitiveWithheldReason,
            travelAsked,
            completionDto?.MissingDetails ?? Array.Empty<string>(),
            serviceLocation);
    }

    /// <summary>Why the participant's handover, emergency contacts and address are not shown for this shift right now (plain language), or null when they are:
    /// the shift's status and, for a Published shift, how far off its rostered start is (<see cref="ShiftPackageService.SensitiveInfoWithheldReason"/>).</summary>
    private string? SensitiveInfoWithheld(Shift shift, ProviderTimeZone provider)
    {
        var (rosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, provider.Id);
        return ShiftPackageService.SensitiveInfoWithheldReason(shift.Status, rosteredStartUtc, NowUtc, provider.Zone);
    }

    /// <summary>Maps a ShiftCompletion to its DTO — thin wrapper so this and RosteringController's
    /// identical mapping need to stay in one place; see <see cref="ShiftCompletionMapper"/>.</summary>
    private Task<ShiftCompletionDto> ToShiftCompletionDtoAsync(ShiftCompletion c, int shiftReturnCount, CancellationToken ct) =>
        ShiftCompletionMapper.ToDtoAsync(_db, c, shiftReturnCount, ct, nowUtc: NowUtc);

    /// <summary>
    /// Resolves one of the caller's own shifts (Participant included, draft-excluded — same rule
    /// as every portal shift read), or the 404 ActionResult to short-circuit with. Extracted
    /// (critique P3) from the identical block previously duplicated across GetShiftDetail/
    /// StartShift/FinishShift.
    /// </summary>
    private async Task<(Shift? Shift, ActionResult<ApiResponse<PortalShiftDetailDto>>? Error)> ResolveOwnedShiftAsync(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return (null, NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found.")));

        var shift = await _db.Shifts
            .Include(s => s.Participant)
            // L1 (2026-10-16): a Draft is invisible to its worker until it is published, on every path, and answers as "not yours" does.
            .Where(Shift.VisibleToWorker)
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (shift?.Participant is null || !Participant.ServicesBegun(shift.Participant))
            return (null, NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found.")));

        return (shift, null);
    }

    private static string? NullIfBlank(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static PortalShiftSummaryDto ToSummaryDto(Shift s, IReadOnlyList<string> missingDetails, TimeZoneInfo zone) => new(
        s.Id, s.ParticipantId, s.Participant?.FullName ?? string.Empty, s.ServiceDate, s.StartTime, s.EndTime,
        s.EndsNextDay, ProviderLocalTime.RosteredHours(s, zone), s.Ratio, s.NightType, s.Status, s.Notes, s.ReturnCount, s.Location, missingDetails);
}
