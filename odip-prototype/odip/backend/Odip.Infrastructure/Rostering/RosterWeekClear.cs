using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>What the one-off clear did, for its log line and its tests.</summary>
public sealed record RosterWeekClearRun(int Organisations, int AlreadyDone, int WeeksCleared, int ShiftsRemoved, int WeeksMarked, int Failures);

/// <summary>
/// Start rostering's one-off (2026-10-16, L7). For each organisation with shifts, in one transaction under its board lock:
/// - logs what it will do, then removes every week after the provider's current week whose shifts are all untouched (an open Draft an agreement pattern made that nobody edited, wrote on or recorded against);
/// - marks every week that still holds a live pattern shift as started (a RosterWeek row, the StartedWeeks rule), past and current weeks included.
/// It removes through EF, so each removed shift gets its audit row. An organisation that already has a RosterWeek row is skipped: it was done, or Start ran there, and a week Start made is never cleared.
/// </summary>
// shortcut: runs at startup while RosterWeekClear:Enabled is true; delete this class, its tests, its Program.cs call and its compose line in the PR after the deploy that ran it.
public static class RosterWeekClear
{
    public const string ActorName = "Start rostering one-off clear";

    public static async Task<RosterWeekClearRun> RunAsync(DbContextOptions<OdipDbContext> options, TimeProvider clock, ILogger logger, CancellationToken ct)
    {
        List<Guid> tenantIds;
        await using (var across = new OdipDbContext(options, new ScopedTenantOverride { IsSuperAdmin = true }))
            tenantIds = await across.Shifts.AsNoTracking().Select(s => s.TenantId).Distinct().ToListAsync(ct);

        int done = 0, cleared = 0, removed = 0, marked = 0, failures = 0;
        foreach (var tenantId in tenantIds)
        {
            try
            {
                if (await ClearOneAsync(options, tenantId, clock, logger, ct) is not { } one) { done++; continue; }
                cleared += one.WeeksCleared; removed += one.ShiftsRemoved; marked += one.WeeksMarked;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failures++;
                logger.LogError(ex, "Roster week clear failed for organisation {TenantId}; nothing of it was changed, and the next start tries again", tenantId);
            }
        }

        var run = new RosterWeekClearRun(tenantIds.Count, done, cleared, removed, marked, failures);
        logger.LogInformation("Roster week clear: {Organisations} organisations, {Done} already done, {Weeks} weeks and {Shifts} shifts removed, {Marked} weeks marked started, {Failures} failures",
            run.Organisations, run.AlreadyDone, run.WeeksCleared, run.ShiftsRemoved, run.WeeksMarked, run.Failures);
        return run;
    }

    /// <summary>One organisation, in its own tenant-scoped context and transaction. Null when it already has a RosterWeek row.</summary>
    private static async Task<(int WeeksCleared, int ShiftsRemoved, int WeeksMarked)?> ClearOneAsync(DbContextOptions<OdipDbContext> options, Guid tenantId, TimeProvider clock, ILogger logger, CancellationToken ct)
    {
        await using var db = new OdipDbContext(options, new ScopedTenantOverride { TenantId = tenantId }) { AuditActorName = ActorName };
        await using var held = await RosterGenerationLock.AcquireAsync(db, tenantId, ct, scope: "roster-board");
        if (await db.RosterWeeks.AnyAsync(ct)) return null;

        var provider = ProviderTimeZoneResolver.FromState(await db.ProviderSettings.Where(p => p.TenantId == tenantId).Select(p => p.State).FirstOrDefaultAsync(ct));
        var currentMonday = RosterWeek.MondayOf(ProviderLocalTime.TodayIn(clock.GetUtcNow().UtcDateTime, provider.Zone));
        var firstClearable = currentMonday.AddDays(7);
        // S1: no query filter may hide a row that points at a shift (a rollback-window incident with no tenant), so the filters are off and the root names the tenant itself.
        var shifts = await db.Shifts.IgnoreQueryFilters().AsNoTracking().Where(s => s.TenantId == tenantId).Select(s => new
        {
            s.Id, s.ServiceDate,
            // DEEP-S2: the StartedWeeks rule, so the backfill marks only weeks the board already reads as started.
            Started = s.ShiftPatternId != null && s.Status != ShiftStatus.Cancelled,
            // shortcut: an edit within a second of the shift's creation counts as untouched (CreatedAt and UpdatedAt are separate UtcNow reads); add an edited flag if that ever matters.
            Untouched = s.Status == ShiftStatus.Draft && s.UserId == null && s.ShiftPatternId != null && s.ReturnCount == 0 && s.UpdatedAt <= s.CreatedAt.AddSeconds(1)
                // DEEP-S1: only an agreement pattern's shift: Start makes those again, never a hand-made pattern's.
                && db.ShiftPatterns.IgnoreQueryFilters().Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId != null)
                && (s.Notes == null || s.Notes == "") && (s.OverrideReason == null || s.OverrideReason == "") && (s.AcknowledgedFindingCodes == null || s.AcknowledgedFindingCodes == "")
                && !db.ShiftNotes.IgnoreQueryFilters().Any(n => n.ShiftId == s.Id) && !db.ShiftCompletions.IgnoreQueryFilters().Any(c => c.ShiftId == s.Id)
                && !db.HandoverAcknowledgements.IgnoreQueryFilters().Any(a => a.ShiftId == s.Id) && !db.ClaimLineItems.IgnoreQueryFilters().Any(c => c.ShiftId == s.Id)
                && !db.BookingTasks.IgnoreQueryFilters().Any(t => t.ShiftId == s.Id) && !db.IncidentReports.IgnoreQueryFilters().Any(i => i.ShiftId == s.Id),
        }).ToListAsync(ct);

        var weeks = shifts.GroupBy(s => RosterWeek.MondayOf(s.ServiceDate)).ToList();
        var clear = weeks.Where(w => w.Key >= firstClearable && w.All(s => s.Untouched)).ToList();
        // A week with no live pattern shift (one-offs only, or Cancelled only, or empty) gets no row, so Start still works there. A re-run is then guarded by the rows Start and
        // Generate write; an organisation left with no row is judged again, which only matters while the flag stays on.
        var keep = weeks.Except(clear).Where(w => w.Any(s => s.Started)).Select(w => w.Key).OrderBy(w => w).ToList();
        var ids = clear.SelectMany(w => w.Select(s => s.Id)).ToList();
        logger.LogInformation("Roster week clear, organisation {TenantId}: removing {Shifts} untouched shifts in {Weeks} weeks ({Mondays}); marking {Kept} weeks started",
            tenantId, ids.Count, clear.Count, string.Join(", ", clear.Select(w => w.Key.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))), keep.Count);

        db.Shifts.RemoveRange(await db.Shifts.Where(s => ids.Contains(s.Id)).ToListAsync(ct));
        var now = clock.GetUtcNow().UtcDateTime;
        db.RosterWeeks.AddRange(keep.Select(monday => new RosterWeek { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = monday, StartedAt = now }));
        await db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return (clear.Count, ids.Count, keep.Count);
    }
}
