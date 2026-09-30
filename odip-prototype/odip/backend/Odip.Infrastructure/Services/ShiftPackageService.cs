using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Shift-package logic that is not a single feature: today, what must be cleared before Finish. The End checklist
/// (BRIEF section 3) is enforced by the server, not merely shown: every dose due in the shift's ROSTERED window needs an
/// outcome (given, refused, withheld, or "not given this shift" with a reason, recorded as a Missed administration),
/// and a running break must be ended. The portal DTO carries the same list as <c>finishBlockers</c> so the client can
/// render the checklist before it ever calls Finish.
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

    /// <summary>
    /// The blockers that stop <paramref name="shift"/> being finished now, in checklist order (running break first, then
    /// doses by scheduled time). <paramref name="completion"/> is the active completion, or null on the manual-start
    /// path where none exists yet. Empty means Finish may proceed.
    /// </summary>
    public async Task<List<PortalFinishBlockerDto>> GetFinishBlockersAsync(Shift shift, ShiftCompletion? completion, CancellationToken ct)
    {
        var blockers = new List<PortalFinishBlockerDto>();

        if (completion is not null
            && await _db.ShiftBreaks.AnyAsync(b => b.ShiftCompletionId == completion.Id && b.EndedAt == null, ct))
        {
            blockers.Add(new PortalFinishBlockerDto(
                ShiftFinishBlockerCodes.BreakRunning, "A break is still running. End it before you finish the shift.",
                null, null, null));
        }

        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var (windowStart, windowEnd) = ProviderLocalTime.RosteredWindowLocal(shift);
        var window = await _slots.GetWindowAsync(windowStart, windowEnd, shift.ParticipantId, provider.Zone, includePrn: false, ct);

        var unrecorded = window.Slots
            .Where(s => s.Administration is null)
            .OrderBy(s => s.ScheduledAt).ThenBy(s => s.Medication.Name, StringComparer.Ordinal)
            .DistinctBy(s => (s.Medication.Id, s.ScheduledAt));
        foreach (var slot in unrecorded)
        {
            var m = slot.Medication;
            var label = string.IsNullOrWhiteSpace(m.Strength) ? m.Name : $"{m.Name} {m.Strength}";
            blockers.Add(new PortalFinishBlockerDto(
                ShiftFinishBlockerCodes.DoseOutcomeMissing,
                $"{label} at {slot.ScheduledAt.ToString("HH:mm", CultureInfo.InvariantCulture)} has no outcome. "
                + "Record it, or mark it not given this shift with a reason.",
                m.Id, m.Name, slot.ScheduledAt));
        }

        return blockers;
    }
}
