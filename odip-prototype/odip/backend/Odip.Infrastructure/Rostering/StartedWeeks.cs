using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// Which roster weeks are started (L3, as the lead decided 2026-10-16): a RosterWeek row, or a non-Cancelled shift an agreement pattern made in the week (history and Demo-pack weeks have no row).
/// A one-off, or a shift a hand-made pattern made, does not start a week (owner, 2026-10-29). The one rule for the board, Start's refusal and approval's windows. A null <paramref name="tenantId"/> leaves the scoping to the query filter.
/// </summary>
public static class StartedWeeks
{
    /// <summary>The Mondays of the weeks of [<paramref name="from"/>, <paramref name="to"/>] that are started.</summary>
    public static async Task<HashSet<DateOnly>> MondaysAsync(OdipDbContext db, Guid? tenantId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var firstMonday = RosterWeek.MondayOf(from);
        var lastSunday = RosterWeek.MondayOf(to).AddDays(6);
        var rows = await db.RosterWeeks.Where(w => (tenantId == null || w.TenantId == tenantId) && w.WeekStart >= firstMonday && w.WeekStart <= lastSunday)
            .Select(w => w.WeekStart).ToListAsync(ct);
        var days = await db.Shifts.Where(s => (tenantId == null || s.TenantId == tenantId) && s.ServiceDate >= firstMonday && s.ServiceDate <= lastSunday
                                              && s.Status != ShiftStatus.Cancelled
                                              && db.ShiftPatterns.Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId != null))
            .Select(s => s.ServiceDate).Distinct().ToListAsync(ct);
        return rows.Concat(days.Select(RosterWeek.MondayOf)).ToHashSet();
    }
}
