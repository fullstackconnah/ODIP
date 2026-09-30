using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>Doses for a shift: the scheduled slots in its window plus the "as needed" medications.</summary>
public sealed record ShiftDoses(IReadOnlyList<PortalDoseSlotDto> Slots, IReadOnlyList<PortalPrnDto> Prn);

/// <summary>
/// The shift package's read model. Builds the pieces the portal shift detail and the coordinator's completion review
/// share - the critical care facts (need-to-know), emergency contacts, doses due in the window, routines matched to the
/// window, the End checklist - so the two surfaces cannot disagree.
///
/// The End checklist (BRIEF section 3) is ENFORCED by the server, not merely shown: every dose that has come due in the shift's
/// ROSTERED window needs an outcome (given, refused, withheld, or "not given this shift" with a reason, recorded as a Missed
/// administration), and a running break must be ended. The portal DTO carries the same list as <c>finishBlockers</c> so the
/// client can render the checklist before it ever calls Finish.
///
/// Two rules keep that checklist satisfiable - an unsatisfiable checklist locks the worker out of Finish and strands the
/// completion before review:
///  - a dose blocks only once its time has ARRIVED (a 15:00 dose does not block a 13:00 early finish - recording it "not given"
///    would be permanent, because a slot takes one record, and would stop the next worker giving it);
///  - a dose blocks only a worker who CAN record it (Medication Competency): recording is gated, so a worker without a current
///    credential could never clear it. Their unrecorded doses show to the coordinator as "nothing recorded" in the completion review.
/// Every medication support level blocks alike, matching the existing MAR (which has never filtered by it).
/// </summary>
public sealed class ShiftPackageService
{
    private readonly OdipDbContext _db;
    private readonly MedicationSlotService _slots;

    public ShiftPackageService(OdipDbContext db, MedicationSlotService? slots = null)
    {
        _db = db;
        _slots = slots ?? new MedicationSlotService(db);
    }

    // ═════════════════════════ End checklist ═════════════════════════

    /// <summary>
    /// The blockers that stop <paramref name="shift"/> being finished now, in checklist order (running break first, then
    /// doses by scheduled time). <paramref name="completion"/> is the active completion (null means none, so no break can be running).
    /// <paramref name="canRecordDoses"/> is whether the worker holds a current Medication Competency - when false no dose blocks, because
    /// they could never clear it. Empty means Finish may proceed.
    /// </summary>
    public async Task<List<PortalFinishBlockerDto>> GetFinishBlockersAsync(
        Shift shift, ShiftCompletion? completion, bool canRecordDoses, CancellationToken ct)
    {
        var breakRunning = completion is not null
            && await _db.ShiftBreaks.AnyAsync(b => b.ShiftCompletionId == completion.Id && b.EndedAt == null, ct);

        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var doses = canRecordDoses
            ? await GetDosesAsync(shift, provider, includePrn: false, ct)
            : new ShiftDoses(Array.Empty<PortalDoseSlotDto>(), Array.Empty<PortalPrnDto>());
        return BuildFinishBlockers(doses.Slots, breakRunning, canRecordDoses, _slots.UtcNow, provider.Zone);
    }

    /// <summary>
    /// The pure half of the End checklist: a running break first, then - for a worker who can record doses - every dose slot whose time has
    /// arrived (its UTC instant is at or before <paramref name="nowUtc"/>) and that has no outcome, in scheduled-time order. Shared by
    /// <see cref="GetFinishBlockersAsync"/> (the Finish pre-check) and the shift detail (which already holds the dose slots, so it never
    /// queries them twice).
    /// </summary>
    public static List<PortalFinishBlockerDto> BuildFinishBlockers(
        IEnumerable<PortalDoseSlotDto> slots, bool breakRunning, bool canRecordDoses, DateTime nowUtc, TimeZoneInfo zone)
    {
        var blockers = new List<PortalFinishBlockerDto>();
        if (breakRunning)
        {
            blockers.Add(new PortalFinishBlockerDto(
                ShiftFinishBlockerCodes.BreakRunning, "A break is still running. End it before you finish the shift.",
                null, null, null));
        }

        if (!canRecordDoses) return blockers;

        var due = slots
            .Where(s => s.Outcome is null && ProviderLocalTime.LocalToUtc(s.ScheduledAt, zone) <= nowUtc)
            .OrderBy(s => s.ScheduledAt).ThenBy(s => s.MedicationName, StringComparer.Ordinal);
        foreach (var slot in due)
        {
            var label = string.IsNullOrWhiteSpace(slot.Strength) ? slot.MedicationName : $"{slot.MedicationName} {slot.Strength}";
            blockers.Add(new PortalFinishBlockerDto(
                ShiftFinishBlockerCodes.DoseOutcomeMissing,
                $"{label} at {slot.ScheduledAt.ToString("HH:mm", CultureInfo.InvariantCulture)} has no outcome. "
                + "Record it, or mark it not given this shift with a reason.",
                slot.MedicationId, slot.MedicationName, slot.ScheduledAt));
        }

        return blockers;
    }

    // ═════════════════════════ Doses ═════════════════════════

    /// <summary>The scheduled doses due in the shift's rostered window and, when <paramref name="includePrn"/>, the PRN medications, as DTOs.</summary>
    public async Task<ShiftDoses> GetDosesAsync(Shift shift, ProviderTimeZone provider, bool includePrn, CancellationToken ct)
    {
        var (windowStart, windowEnd) = ProviderLocalTime.RosteredWindowLocal(shift);
        var window = await _slots.GetWindowAsync(windowStart, windowEnd, shift.ParticipantId, provider.Zone, includePrn, ct);
        var nowUtc = _slots.UtcNow;

        var slots = window.Slots
            .DistinctBy(s => (s.Medication.Id, s.ScheduledAt))
            .OrderBy(s => s.ScheduledAt).ThenBy(s => s.Medication.Name, StringComparer.Ordinal)
            .Select(ToDoseSlotDto)
            .ToList();
        var prn = window.Prn
            .OrderBy(p => p.Medication.Name, StringComparer.Ordinal)
            .Select(p => ToPrnDto(p, nowUtc))
            .ToList();
        return new ShiftDoses(slots, prn);
    }

    public static PortalDoseSlotDto ToDoseSlotDto(MedicationSlot slot)
    {
        var m = slot.Medication;
        var a = slot.Administration;
        var state = a is not null ? PortalDoseState.Recorded : slot.IsOverdue ? PortalDoseState.Overdue : PortalDoseState.Due;
        return new PortalDoseSlotDto(
            m.Id, m.Name, Clean(m.Strength), m.DoseDescription, m.Form, m.Route, Clean(m.Directions), m.SupportLevel, m.IsHighRisk,
            slot.ScheduledAt, slot.TimeOfDay.ToString(@"hh\:mm", CultureInfo.InvariantCulture), state, state == PortalDoseState.Overdue,
            a is null ? null : ToOutcomeDto(a),
            new PortalDoseWitnessDto(
                m.IsHighRisk, a?.WitnessStatus, a?.WitnessName, ProviderLocalTime.AsUtc(a?.WitnessRequestedAt),
                ProviderLocalTime.AsUtc(a?.WitnessRespondedAt)));
    }

    public static PortalDoseOutcomeDto ToOutcomeDto(MedicationAdministration a) => new(
        a.Id, a.Status, a.RecordedByName, ProviderLocalTime.AsUtc(a.AdministeredAt), a.AdministeredAtTimeZone,
        ProviderLocalTime.AsUtc(a.CreatedAt), Clean(a.Reason), Clean(a.DoseGiven), Clean(a.Notes));

    private static PortalPrnDto ToPrnDto(PrnMedicationStatus p, DateTime nowUtc)
    {
        var m = p.Medication;
        DateTime? nextAvailable = null;
        if (m.PrnMinIntervalMinutes is { } interval && p.LastDoseAt is { } last)
        {
            var at = last.AddMinutes(interval);
            if (at > nowUtc) nextAvailable = at;
        }
        return new PortalPrnDto(
            m.Id, m.Name, Clean(m.Strength), m.DoseDescription, m.Form, m.Route, Clean(m.Directions), m.SupportLevel, m.IsHighRisk,
            Clean(m.PrnIndication), m.PrnMaxDosesPer24h, m.PrnMinIntervalMinutes, p.DosesInLast24h, ProviderLocalTime.AsUtc(p.LastDoseAt),
            MaxDosesReached: m.PrnMaxDosesPer24h is { } max && p.DosesInLast24h >= max,
            ProviderLocalTime.AsUtc(nextAvailable), p.OutcomePendingAdministration?.Id);
    }

    // ═════════════════════════ Routines ═════════════════════════

    /// <summary>The routines relevant to the shift's rostered window, matched on the server (overnight-safe).</summary>
    public static List<PortalShiftRoutineDto> MatchRoutines(Shift shift, IEnumerable<ParticipantRoutine> activeRoutines)
    {
        var (windowStart, windowEnd) = ProviderLocalTime.RosteredWindowLocal(shift);
        return RoutineWindowMatcher.Match(activeRoutines, windowStart, windowEnd)
            .Select(o => new PortalShiftRoutineDto(
                o.Routine.Id, o.Routine.Title, o.Routine.Description, o.Routine.Category, o.Routine.IsCritical,
                o.Routine.StartTime, o.Routine.EndTime, o.OccursAtLocal, o.AfterMidnight))
            .ToList();
    }

    // ═════════════════════════ Need-to-know: at a glance and contacts ═════════════════════════

    /// <summary>
    /// The critical care facts for the worker. Excludes the NDIS number, plan, funding and full diagnoses by construction:
    /// this method is the allow-list, and nothing outside it is ever mapped. Blank text becomes null so absence is explicit.
    /// </summary>
    public static PortalAtAGlanceDto BuildAtAGlance(Participant p) => new(
        new PortalAllergiesDto(Clean(p.AllergiesDetail), p.IsAnaphylaxisRisk, Clean(p.AllergyManagementNotes)),
        new PortalDietDto(
            Clean(p.ChokingRiskMealDetail), Clean(p.PegRegimeMealDetail), Clean(p.ModifiedDietDetail),
            Clean(p.MealAssistanceDetail), Clean(p.MedicationTricks)),
        new PortalCommunicationDto(Clean(p.ExpressiveSkills), Clean(p.ReceptiveSkills), Clean(p.ReadingAbility), Clean(p.CommunicationAids)),
        new PortalBehaviourDto(
            Clean(p.BocTriggers), Clean(p.BocEarlyWarningSigns), Clean(p.BocDeEscalationStrategies), Clean(p.BocWhatNotToDo),
            Clean(p.WhatHelpsMeCalmDown)),
        new PortalHidpaDto(
            p.HidpaSupportCategories.HasFlag(HidpaSupportCategory.EpilepsyManagement),
            p.HidpaSupportCategories.HasFlag(HidpaSupportCategory.EnteralFeeding),
            p.HidpaSupportCategories.HasFlag(HidpaSupportCategory.DysphagiaManagement)),
        new PortalAddressDto(Clean(p.AddressStreet), Clean(p.AddressSuburb), Clean(p.AddressState), Clean(p.AddressPostcode)));

    /// <summary>
    /// Active Emergency Contact roles for the participant that have not ended, first call first: ranked contacts by priority,
    /// then primary ones, then the rest by name. Tenant-scoped by the ParticipantContactRole / Person query filters.
    /// </summary>
    public async Task<List<PortalEmergencyContactDto>> GetEmergencyContactsAsync(Guid participantId, DateOnly providerToday, CancellationToken ct)
    {
        var roles = await _db.ParticipantContactRoles
            .Include(r => r.Person)
            .Where(r => r.ParticipantId == participantId
                && r.RoleType == ContactRoleType.EmergencyContact
                && r.Status == ContactRoleStatus.Active
                && (r.EndDate == null || r.EndDate >= providerToday))
            .ToListAsync(ct);

        return roles
            .Where(r => r.Person is not null)
            .OrderBy(r => r.PriorityOrder ?? int.MaxValue)
            .ThenByDescending(r => r.IsPrimary)
            .ThenBy(r => r.Person!.FullName, StringComparer.Ordinal)
            .Select(r => new PortalEmergencyContactDto(
                r.Id, r.Person!.FullName, Clean(r.RelationshipToParticipant), Clean(r.Person.Phone), Clean(r.Person.Mobile),
                r.IsPrimary, r.PriorityOrder))
            .ToList();
    }

    // ═════════════════════════ Coordinator review ═════════════════════════

    /// <summary>
    /// The coordinator's one-call review of a submitted shift: the completion DTO, every scheduled dose in the rostered window with
    /// its outcome, the PRN doses given during the actual shift, and the shift notes.
    /// </summary>
    public async Task<ShiftCompletionReviewDto> BuildReviewAsync(
        Shift shift, ShiftCompletion completion, ShiftCompletionDto completionDto, CancellationToken ct)
    {
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var doses = await GetDosesAsync(shift, provider, includePrn: false, ct);

        // "As needed" doses this WORKER gave during the actual shift: PRN medications only (an unscheduled record against a Regular
        // medication is not an as-needed dose) and only the submitting worker's own records - a colleague on an overlapping shift for the
        // same participant gave theirs on their own completion.
        var end = completion.ActualEnd ?? _slots.UtcNow;
        var prnDoses = await _db.MedicationAdministrations
            .Include(a => a.ParticipantMedication)
            .Where(a => a.ParticipantId == shift.ParticipantId
                && a.ParticipantMedication!.Type == MedicationType.Prn
                && a.RecordedByUserId == completion.SubmittedByUserId
                && a.ScheduledAt == null
                && a.Status == MedicationAdministrationStatus.Administered
                && a.AdministeredAt != null && a.AdministeredAt >= completion.ActualStart && a.AdministeredAt <= end)
            .OrderBy(a => a.AdministeredAt)
            .ToListAsync(ct);

        var notes = await _db.ShiftNotes
            .Where(n => n.ShiftId == shift.Id)
            .OrderBy(n => n.CreatedAt)
            .ToListAsync(ct);
        var noteIds = notes.Select(n => n.Id).ToList();
        var incidentByNote = noteIds.Count == 0
            ? new Dictionary<Guid, Guid>()
            : (await _db.IncidentReports
                    .Where(i => i.IsActive && i.ShiftNoteId != null && noteIds.Contains(i.ShiftNoteId.Value))
                    .Select(i => new { NoteId = i.ShiftNoteId!.Value, i.Id, i.CreatedAt })
                    .ToListAsync(ct))
                .GroupBy(r => r.NoteId)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).First().Id);

        var participantName = shift.Participant?.FullName
            ?? await _db.Participants.Where(p => p.Id == shift.ParticipantId).Select(p => p.FirstName + " " + p.LastName).FirstOrDefaultAsync(ct)
            ?? string.Empty;
        var staffName = await _db.Users.Where(u => u.Id == completion.SubmittedByUserId)
            .Select(u => u.FirstName + " " + u.LastName).FirstOrDefaultAsync(ct) ?? string.Empty;

        return new ShiftCompletionReviewDto(
            completionDto, participantName, staffName, shift.ServiceDate, provider.Id,
            doses.Slots,
            prnDoses.Select(a => new ReviewPrnDoseDto(
                a.ParticipantMedicationId, a.ParticipantMedication?.Name ?? string.Empty, Clean(a.ParticipantMedication?.Strength),
                a.ParticipantMedication?.DoseDescription ?? string.Empty, ToOutcomeDto(a))).ToList(),
            notes.Select(n => new ShiftNoteDto(
                n.Id, n.ShiftId, n.AuthorUserId, n.AuthorName, n.Body, n.CreatedAt, n.UpdatedAt,
                ShiftNoteKeywordVocabulary.ToCategoryNames(n.FlaggedCategories), n.FlagsAcknowledgedAt,
                incidentByNote.TryGetValue(n.Id, out var incidentId) ? incidentId : null)).ToList());
    }

    /// <summary>Blank or whitespace-only text is "not recorded": null, never an empty string.</summary>
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
