using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// Two rules over the same query. STARTED (owner, 2026-10-29): a RosterWeek row, or a non-Cancelled shift an AGREEMENT pattern made in the week; a one-off, or a shift a hand-made pattern made, does not count.
/// It drives Start's refusal, the board's CanStart and approval's fill windows. ROSTERED (the board's WeekStarted, as before): a row, or a non-Cancelled shift from any pattern (history and Demo-pack weeks have no row),
/// so a hand-made week stays usable on the board. A null <paramref name="tenantId"/> leaves the scoping to the query filter.
/// </summary>
public static class StartedWeeks
{
    /// <summary>The Mondays of the weeks of [<paramref name="from"/>, <paramref name="to"/>] that are started (the agreement rule).</summary>
    public static Task<HashSet<DateOnly>> MondaysAsync(OdipDbContext db, Guid? tenantId, DateOnly from, DateOnly to, CancellationToken ct) =>
        WeeksAsync(db, tenantId, from, to, agreementOnly: true, ct);

    /// <summary>The Mondays of the weeks of [<paramref name="from"/>, <paramref name="to"/>] that are rostered (any pattern's shift counts): what the board treats as usable.</summary>
    public static Task<HashSet<DateOnly>> RosteredMondaysAsync(OdipDbContext db, Guid? tenantId, DateOnly from, DateOnly to, CancellationToken ct) =>
        WeeksAsync(db, tenantId, from, to, agreementOnly: false, ct);

    private static async Task<HashSet<DateOnly>> WeeksAsync(OdipDbContext db, Guid? tenantId, DateOnly from, DateOnly to, bool agreementOnly, CancellationToken ct)
    {
        var firstMonday = RosterWeek.MondayOf(from);
        var lastSunday = RosterWeek.MondayOf(to).AddDays(6);
        var rows = await db.RosterWeeks.Where(w => (tenantId == null || w.TenantId == tenantId) && w.WeekStart >= firstMonday && w.WeekStart <= lastSunday)
            .Select(w => w.WeekStart).ToListAsync(ct);
        var days = await db.Shifts.Where(s => (tenantId == null || s.TenantId == tenantId) && s.ServiceDate >= firstMonday && s.ServiceDate <= lastSunday
                                              && s.Status != ShiftStatus.Cancelled && s.ShiftPatternId != null
                                              && (!agreementOnly || db.ShiftPatterns.Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId != null)))
            .Select(s => s.ServiceDate).Distinct().ToListAsync(ct);
        return rows.Concat(days.Select(RosterWeek.MondayOf)).ToHashSet();
    }
}
