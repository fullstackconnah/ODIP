using System.Diagnostics;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Integrations;

/// <summary>
/// Sends one organisation's approved shifts to Employment Hero as timesheet lines, one outbox row per shift for life.
///
/// How a run behaves:
/// - It queues approved shifts that have no row (from the connect date on), optionally re-checks sent rows for edits, then sends what is due.
/// - A row is claimed first (Pending, a 10-minute lease, one try counted) with the concurrency token, so two drains never send the same shift.
///   A try that may have reached EH (a second try with no EH id) looks the line up by its externalId before it creates anything.
/// - A 429 or a refused key is not a try: the claim is handed back and the whole batch waits.
/// - A line in a finalised pay run is never changed; the row says so and the Admins hear once per run.
/// - Nothing here logs a name or a time: counts and exception type names only.
/// </summary>
public sealed class EmploymentHeroTimesheetSender
{
    private static readonly TimeSpan[] Delays = [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(60), TimeSpan.FromMinutes(240)];
    private static readonly TimeSpan Lease = TimeSpan.FromMinutes(10), WaitingRetry = TimeSpan.FromMinutes(30), DrainBudget = TimeSpan.FromSeconds(20);
    private const int BatchSize = 25, ScanSize = 500, ChangeWindowDays = 62;

    private readonly EmploymentHeroClient _client;
    private readonly IntegrationKeyProtector _keys;
    private readonly TimeProvider _clock;
    private readonly ILogger<EmploymentHeroTimesheetSender> _logger;
    private readonly TimeSpan _pause;

    public EmploymentHeroTimesheetSender(EmploymentHeroClient client, IntegrationKeyProtector keys, TimeProvider clock, ILogger<EmploymentHeroTimesheetSender> logger, TimeSpan? pause = null)
    {
        _client = client;
        _keys = keys;
        _clock = clock;
        _logger = logger;
        _pause = pause ?? TimeSpan.FromMilliseconds(250);
    }

    private DateTime Now() => _clock.GetUtcNow().UtcDateTime;

    /// <summary>One organisation's run. Returns its log row when it sent, failed or flagged something (or was held), otherwise null.</summary>
    public async Task<EmploymentHeroSyncLog?> RunAsync(OdipDbContext db, Guid tenantId, bool checkChanges, CancellationToken ct)
    {
        var conn = await db.EmploymentHeroConnections.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
        if (conn is null) return null;
        var key = _keys.Unprotect(conn.ApiKeyCiphertext, conn.ApiKeyNonce, tenantId);
        if (key is null) return null;

        var now = Now();
        var log = new EmploymentHeroSyncLog { Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = conn.BusinessId, Kind = EmploymentHeroSyncKind.Timesheets, StartedAt = now };
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(db, tenantId, ct)).Zone;
        var map = new EmploymentHeroTimesheets.TimesheetMapping(conn.WorkTypeStandard, conn.WorkTypeActiveNight, conn.WorkTypePassiveNight, conn.WorkTypeSleepover);

        await ScanAsync(db, tenantId, now, ct);
        if (checkChanges) await CheckChangesAsync(db, tenantId, map, zone, now, ct);
        var drain = await DrainAsync(db, tenantId, key, conn.BusinessId, map, zone, now, ct);

        if (drain.Flagged > 0)
        {
            var problems = new List<string>();
            if (drain.ChangedFlagged > 0) problems.Add($"{drain.ChangedFlagged} shifts changed after their pay run was finalised. Fix them in Employment Hero; Rostering → Payroll lists them.");
            if (drain.Flagged > drain.ChangedFlagged) problems.Add($"{drain.Flagged - drain.ChangedFlagged} shifts' hours couldn't be sent to Employment Hero. Rostering → Payroll says why.");
            await EmploymentHeroStaffSync.AlertAdminsAsync(db, tenantId, nameof(EmploymentHeroSyncLog), log.Id, string.Join(" ", problems), ct);
        }
        if (drain.Sent + drain.Failed + drain.Flagged == 0 && drain.StoppedBy is null) return null;

        log.FinishedAt = Now();
        log.Sent = drain.Sent;
        log.Failed = drain.Failed;
        log.NeedsAttention = drain.Flagged;
        log.ErrorClass = drain.StoppedBy?.ToString();
        db.EmploymentHeroSyncLogs.Add(log);
        await db.SaveChangesAsync(ct);
        _logger.LogInformation("Employment Hero timesheets for organisation {TenantId}: {Sent} sent, {Failed} failed, {Flagged} need attention", tenantId, drain.Sent, drain.Failed, drain.Flagged);
        return log;
    }

    /// <summary>Queues Pending rows for approved shifts on or after the connect date that have none. A collision with another drain or with Send missing is skipped.</summary>
    private async Task ScanAsync(OdipDbContext db, Guid tenantId, DateTime now, CancellationToken ct)
    {
        if (await EmploymentHeroTimesheets.CutoffAsync(db, tenantId, ct) is not { } cutoff) return;
        var have = db.EmploymentHeroOutbox.Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Timesheet).Select(r => r.EntityId);
        var missing = await db.ShiftCompletions
            .Where(c => c.TenantId == tenantId && c.IsActive && c.ReviewOutcome == ReviewOutcome.Approved && !have.Contains(c.Id)
                        && c.Shift!.Status == ShiftStatus.Completed && c.Shift.ServiceDate >= cutoff)
            .Select(c => c.Id).Take(ScanSize).ToListAsync(ct);
        if (missing.Count == 0) return;
        db.EmploymentHeroOutbox.AddRange(missing.Select(id => EmploymentHeroTimesheets.NewRow(tenantId, id, now)));
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            db.ChangeTracker.Clear();
            _logger.LogInformation("Employment Hero timesheet scan for organisation {TenantId} collided with another run ({Error})", tenantId, ex.GetType().Name);
        }
    }

    /// <summary>Re-builds sent rows from today's data: an edit puts the row back in the queue, and a Changed row whose data matches what was sent again is Sent.</summary>
    private async Task CheckChangesAsync(OdipDbContext db, Guid tenantId, EmploymentHeroTimesheets.TimesheetMapping map, TimeZoneInfo zone, DateTime now, CancellationToken ct)
    {
        var from = ProviderLocalTime.TodayIn(now, zone).AddDays(-ChangeWindowDays);
        var rows = await db.EmploymentHeroOutbox
            .Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Timesheet
                        && (r.Status == EmploymentHeroOutboxStatus.Sent || (r.Status == EmploymentHeroOutboxStatus.NeedsAttention && r.LastError == EmploymentHeroTimesheets.FinalisedMessage))
                        && db.ShiftCompletions.Any(c => c.Id == r.EntityId && c.TenantId == tenantId && c.Shift!.ServiceDate >= from))
            .ToListAsync(ct);
        if (rows.Count == 0) return;
        var data = await LoadAsync(db, tenantId, rows, ct);
        foreach (var row in rows)
        {
            if (!data.TryGetValue(row.EntityId, out var d)) continue;
            var built = EmploymentHeroTimesheets.Build(d.Shift, d.Completion, d.Breaks, d.PayrollId, map, zone);
            if (built.Line is null) continue;
            var hash = built.Hash;
            if (row.Status == EmploymentHeroOutboxStatus.Sent && hash != row.PayloadHash)
            {
                row.Status = EmploymentHeroOutboxStatus.Pending;
                row.NextAttemptAt = now;
                row.Attempts = 0;
                row.LastError = null;
            }
            else if (row.Status == EmploymentHeroOutboxStatus.NeedsAttention && hash == row.PayloadHash)
            {
                row.Status = EmploymentHeroOutboxStatus.Sent;
                row.LastError = null;
            }
            else continue;
            await SaveOrSkipAsync(db, row, now, ct);
        }
    }

    private sealed record RowData(Shift Shift, ShiftCompletion Completion, List<ShiftBreak> Breaks, string? PayrollId);

    private static async Task<Dictionary<Guid, RowData>> LoadAsync(OdipDbContext db, Guid tenantId, List<EmploymentHeroOutbox> rows, CancellationToken ct)
    {
        var ids = rows.Select(r => r.EntityId).ToList();
        var completions = await db.ShiftCompletions.Include(c => c.Shift).Where(c => c.TenantId == tenantId && ids.Contains(c.Id)).ToListAsync(ct);
        var workerIds = completions.Select(c => c.SubmittedByUserId).Distinct().ToList();
        var payroll = await db.Users.Where(u => u.TenantId == tenantId && workerIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.ExternalPayrollId, ct);
        var breaks = (await db.ShiftBreaks.Where(b => b.TenantId == tenantId && ids.Contains(b.ShiftCompletionId)).ToListAsync(ct)).ToLookup(b => b.ShiftCompletionId);
        return completions.Where(c => c.Shift is not null).ToDictionary(c => c.Id, c => new RowData(c.Shift!, c, breaks[c.Id].ToList(), payroll.GetValueOrDefault(c.SubmittedByUserId)));
    }

    private sealed record DrainResult(int Sent, int Failed, int Flagged, int ChangedFlagged, EmploymentHeroFailure? StoppedBy);

    private async Task<DrainResult> DrainAsync(OdipDbContext db, Guid tenantId, string key, string biz, EmploymentHeroTimesheets.TimesheetMapping map, TimeZoneInfo zone, DateTime now, CancellationToken ct)
    {
        int sent = 0, failed = 0, flagged = 0, changedFlagged = 0;
        EmploymentHeroFailure? stoppedBy = null;
        DateTime? holdUntil = null;

        void Flag(EmploymentHeroOutbox row, string why)
        {
            row.Status = EmploymentHeroOutboxStatus.NeedsAttention;
            row.LastError = why;
            flagged++;
            if (why == EmploymentHeroTimesheets.FinalisedMessage) changedFlagged++;
        }
        void Fail(EmploymentHeroOutbox row, string why)
        {
            if (row.Attempts > Delays.Length) { Flag(row, EmploymentHeroTimesheets.GaveUpMessage); return; }
            row.Status = EmploymentHeroOutboxStatus.Failed;
            row.NextAttemptAt = now + Delays[row.Attempts - 1];
            row.LastError = why;
            failed++;
        }

        // Only workers who are linked: an unlinked worker's row waits without costing a try.
        var due = await db.EmploymentHeroOutbox
            .Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Timesheet
                        && (r.Status == EmploymentHeroOutboxStatus.Pending || r.Status == EmploymentHeroOutboxStatus.Failed) && r.NextAttemptAt <= now
                        && db.ShiftCompletions.Any(c => c.Id == r.EntityId && c.TenantId == tenantId
                                                        && db.Users.Any(u => u.Id == c.SubmittedByUserId && u.TenantId == tenantId && u.ExternalPayrollId != null)))
            .OrderBy(r => r.NextAttemptAt).Take(BatchSize).ToListAsync(ct);
        if (due.Count == 0) return new(0, 0, 0, 0, null);
        var data = await LoadAsync(db, tenantId, due, ct);
        var watch = Stopwatch.StartNew();

        foreach (var row in due)
        {
            if (watch.Elapsed > DrainBudget) break;
            if (!data.TryGetValue(row.EntityId, out var d)) { Flag(row, "This shift's hours are no longer available."); await SaveOrSkipAsync(db, row, now, ct); continue; }
            var built = EmploymentHeroTimesheets.Build(d.Shift, d.Completion, d.Breaks, d.PayrollId, map, zone);
            if (built.WaitReason is { } why)
            {
                row.Status = EmploymentHeroOutboxStatus.Pending;
                row.LastError = why;
                row.NextAttemptAt = now + WaitingRetry;
                await SaveOrSkipAsync(db, row, now, ct);
                continue;
            }
            if (!await ClaimAsync(db, row, now, ct)) continue;   // another drain has it
            var line = built.Line!;
            var employee = line.EmployeeId.ToString(CultureInfo.InvariantCulture);
            try
            {
                EhTimesheetRef saved;
                if (row.ExternalId is null)
                    // An earlier try may have reached EH before its answer was lost: look the line up before creating another.
                    saved = (row.Attempts > 1 ? await _client.FindTimesheetByExternalIdAsync(key, biz, line.ExternalId, ct) : null) is { } earlier
                        ? await _client.UpdateTimesheetAsync(key, biz, earlier.Id, line, ct)
                        : await CreateOrAdoptAsync(key, biz, line, ct);
                else
                {
                    var lineId = int.Parse(row.ExternalId, CultureInfo.InvariantCulture);
                    var current = await _client.GetTimesheetAsync(key, biz, lineId, ct);
                    if (current?.Status is { } st && st.Equals("Processed", StringComparison.OrdinalIgnoreCase))
                    {
                        Flag(row, EmploymentHeroTimesheets.FinalisedMessage);
                        await SaveOrSkipAsync(db, row, now, ct);
                        continue;
                    }
                    if (current is null) saved = await CreateOrAdoptAsync(key, biz, line, ct);   // deleted in EH
                    else if (row.ExternalEmployeeId == employee) saved = await _client.UpdateTimesheetAsync(key, biz, lineId, line, ct);
                    else
                    {   // relinked to another EH employee: the old line goes
                        await _client.DeleteTimesheetAsync(key, biz, lineId, ct);
                        saved = await CreateOrAdoptAsync(key, biz, line, ct);
                    }
                }
                row.Status = EmploymentHeroOutboxStatus.Sent;
                row.ExternalId = saved.Id.ToString(CultureInfo.InvariantCulture);
                row.ExternalEmployeeId = employee;
                row.PayloadHash = built.Hash;
                row.SentAt = now;
                row.Attempts = 0;
                row.LastError = null;
                sent++;
            }
            catch (EmploymentHeroException ex) when (ex.Failure is EmploymentHeroFailure.RateLimited or EmploymentHeroFailure.KeyRefused)
            {   // not a try: hand the claim back and hold the whole batch
                row.Attempts--;
                row.Status = EmploymentHeroOutboxStatus.Pending;
                holdUntil = now + (ex.Failure == EmploymentHeroFailure.RateLimited ? ex.RetryAfter ?? TimeSpan.FromSeconds(60) : TimeSpan.FromMinutes(30));
                row.NextAttemptAt = holdUntil.Value;
                row.LastError = ex.Failure == EmploymentHeroFailure.RateLimited ? EmploymentHeroTimesheets.BusyMessage : EmploymentHeroTimesheets.KeyRefusedReason;
                stoppedBy = ex.Failure;
            }
            catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.Refused)
            {
                if (ex.Message.Contains("Processed", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("finalis", StringComparison.OrdinalIgnoreCase)) Flag(row, EmploymentHeroTimesheets.FinalisedMessage);
                else Flag(row, ex.Message.Length <= 300 ? ex.Message : ex.Message[..300]);
            }
            catch (EmploymentHeroException ex)
            {
                Fail(row, ex.Failure == EmploymentHeroFailure.BusinessNotFound ? "Employment Hero couldn't find the business or the employee." : "Employment Hero couldn't be reached.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Fail(row, "ODIP couldn't send this shift's hours.");
                _logger.LogWarning("Timesheet row failed ({Error})", ex.GetType().Name);
            }
            await SaveOrSkipAsync(db, row, now, ct);
            if (holdUntil is not null) break;
            if (_pause > TimeSpan.Zero) await Task.Delay(_pause, ct);
        }

        if (holdUntil is { } until)
            foreach (var row in due.Where(r => r.Status == EmploymentHeroOutboxStatus.Pending && r.NextAttemptAt < until))
            {
                row.NextAttemptAt = until;
                await SaveOrSkipAsync(db, row, now, ct);
            }
        return new(sent, failed, flagged, changedFlagged, stoppedBy);
    }

    /// <summary>POST; if EH refuses because the externalId already exists (an answer was lost), the existing line is updated instead.</summary>
    private async Task<EhTimesheetRef> CreateOrAdoptAsync(string key, string biz, EhTimesheetLine line, CancellationToken ct)
    {
        try
        {
            return await _client.CreateTimesheetAsync(key, biz, line, ct);
        }
        catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.Refused)
        {
            if (await _client.FindTimesheetByExternalIdAsync(key, biz, line.ExternalId, ct) is not { } existing) throw;
            return await _client.UpdateTimesheetAsync(key, biz, existing.Id, line, ct);
        }
    }

    /// <summary>Takes the row for one try: Pending, a 10-minute lease and the try counted. False when another drain saved it first.</summary>
    internal static Task<bool> ClaimAsync(OdipDbContext db, EmploymentHeroOutbox row, DateTime now, CancellationToken ct)
    {
        row.Status = EmploymentHeroOutboxStatus.Pending;
        row.NextAttemptAt = now + Lease;
        row.Attempts++;
        return SaveOrSkipAsync(db, row, now, ct);
    }

    /// <summary>
    /// The token always changes, even within one microsecond (all Postgres keeps), so a racing writer is always detected.
    /// </summary>
    public static DateTime Stamp(DateTime original, DateTime now) =>
        new(Math.Max(now.Ticks / 10 * 10, original.Ticks / 10 * 10 + 10), DateTimeKind.Utc);

    /// <summary>Saves one row. Another writer got there first: every entry in the failed save is detached and false is returned, so nothing else is lost or half-saved.</summary>
    internal static async Task<bool> SaveOrSkipAsync(OdipDbContext db, EmploymentHeroOutbox row, DateTime now, CancellationToken ct)
    {
        row.UpdatedAt = Stamp(row.UpdatedAt, now);
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateConcurrencyException ex)
        {
            foreach (var entry in ex.Entries) entry.State = EntityState.Detached;
            return false;
        }
    }
}
