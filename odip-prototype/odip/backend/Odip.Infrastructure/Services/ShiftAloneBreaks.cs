using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The breaks taken alone (<c>WithParticipant</c> false) of the shifts' ACTIVE completions, read once for the shift claim (preview, run, claim again) and the budget ledger, so an estimate and the claim
/// it becomes deduct the same minutes (W9). A returned completion is archived with its breaks and is ignored. A running break ends at the actual end.
/// </summary>
public static class ShiftAloneBreaks
{
    public static async Task<Dictionary<Guid, List<(DateTime From, DateTime To)>>> LoadAsync(OdipDbContext db, IReadOnlyCollection<Guid> shiftIds, CancellationToken ct)
    {
        if (shiftIds.Count == 0) return new();
        var rows = await db.ShiftBreaks.AsNoTracking()
            .Where(b => !b.WithParticipant && b.ShiftCompletion!.IsActive && shiftIds.Contains(b.ShiftCompletion.ShiftId))
            .Select(b => new { b.ShiftCompletion!.ShiftId, From = b.StartedAt, To = b.EndedAt ?? b.ShiftCompletion.ActualEnd })
            .ToListAsync(ct);
        return rows.Where(r => r.To is not null).GroupBy(r => r.ShiftId).ToDictionary(g => g.Key, g => g.Select(r => (r.From, r.To!.Value)).ToList());
    }

    /// <summary>The spans a shift's claim leaves out, or null when it has none to leave.</summary>
    public static IReadOnlyList<(int From, int To)>? SpansOf(
        Dictionary<Guid, List<(DateTime From, DateTime To)>> byShift, Guid shiftId, DateOnly serviceDate, TimeOnly start, TimeOnly end, bool endsNextDay, SleepoverType nightType, TimeZoneInfo zone) =>
        byShift.TryGetValue(shiftId, out var breaks) ? ShiftBreakRules.UnclaimedSpans(serviceDate, start, end, endsNextDay, nightType, breaks, zone) : null;
}
