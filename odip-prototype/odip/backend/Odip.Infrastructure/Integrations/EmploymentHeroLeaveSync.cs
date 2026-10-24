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
/// Sends one organisation's approved leave to Employment Hero and takes cancelled leave back, one outbox row per leave for life.
/// It follows <see cref="EmploymentHeroTimesheetSender"/>: claim a row first, look an earlier try up by its marker before creating, hold the batch on a 429.
/// Leave entered in Employment Hero is never sent back. Nothing here logs a name or a date: counts and exception type names only.
/// </summary>
public sealed class EmploymentHeroLeaveSync
{
    private static readonly TimeSpan[] Delays = [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(60), TimeSpan.FromMinutes(240)];
    private static readonly TimeSpan WaitingRetry = TimeSpan.FromMinutes(30), DrainBudget = TimeSpan.FromSeconds(10);
    private const int BatchSize = 10, ScanSize = 200, WindowDays = 62;

    private readonly EmploymentHeroClient _client;
    private readonly IntegrationKeyProtector _keys;
    private readonly TimeProvider _clock;
    private readonly ILogger<EmploymentHeroLeaveSync> _logger;
    private readonly TimeSpan _pause;

    public EmploymentHeroLeaveSync(EmploymentHeroClient client, IntegrationKeyProtector keys, TimeProvider clock, ILogger<EmploymentHeroLeaveSync> logger, TimeSpan? pause = null)
    {
        _client = client;
        _keys = keys;
        _clock = clock;
        _logger = logger;
        _pause = pause ?? TimeSpan.FromMilliseconds(250);
    }

    private DateTime Now() => _clock.GetUtcNow().UtcDateTime;

    /// <summary>One organisation's run. Returns its log row when it sent, failed, flagged or imported something (or was held), otherwise null.</summary>
    public async Task<EmploymentHeroSyncLog?> RunAsync(OdipDbContext db, Guid tenantId, bool pull, CancellationToken ct)
    {
        var conn = await db.EmploymentHeroConnections.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
        if (conn is null) return null;
        var key = _keys.Unprotect(conn.ApiKeyCiphertext, conn.ApiKeyNonce, tenantId);
        if (key is null) return null;

        db.AuditActorName = EmploymentHeroStaffSync.ActorName;
        try
        {
            var now = Now();
            var log = new EmploymentHeroSyncLog { Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = conn.BusinessId, Kind = EmploymentHeroSyncKind.Leave, StartedAt = now };
            var today = await ProviderTimeZoneResolver.TodayAsync(db, tenantId, _clock, ct);
            var map = new EmploymentHeroLeave.LeaveMapping(conn.LeaveCategoryAnnual, conn.LeaveCategorySick, conn.LeaveCategoryPersonal, conn.LeaveCategoryOther);

            await ScanAsync(db, tenantId, EmploymentHeroLeave.Cutoff(conn.ConnectedAt), today, now, ct);
            await CheckChangesAsync(db, tenantId, map, today, now, ct);
            var drain = await DrainAsync(db, tenantId, key, conn.BusinessId, map, now, ct);
            var pulled = pull && drain.StoppedBy is null ? await PullAsync(db, tenantId, key, conn.BusinessId, map, today, now, ct) : new PullResult(0, 0);

            if (drain.Flagged > 0)
                await EmploymentHeroStaffSync.AlertAdminsAsync(db, tenantId, nameof(EmploymentHeroSyncLog), log.Id,
                    $"{drain.Flagged} leave requests couldn't be sent to Employment Hero. Settings → Integrations lists them.", ct);
            if (drain.Sent + drain.Failed + drain.Flagged + pulled.Created + pulled.Updated == 0 && drain.StoppedBy is null) return null;

            log.FinishedAt = Now();
            log.Sent = drain.Sent;
            log.Created = pulled.Created;
            log.Updated = pulled.Updated;
            log.Failed = drain.Failed;
            log.NeedsAttention = drain.Flagged;
            log.ErrorClass = drain.StoppedBy?.ToString();
            db.EmploymentHeroSyncLogs.Add(log);
            await db.SaveChangesAsync(ct);
            _logger.LogInformation("Employment Hero leave for organisation {TenantId}: {Sent} sent, {Failed} failed, {Flagged} need attention", tenantId, drain.Sent, drain.Failed, drain.Flagged);
            return log;
        }
        finally
        {
            db.AuditActorName = null;
        }
    }

    /// <summary>Queues Pending rows for approved ODIP leave decided since the cutoff that has none. Leave already linked to an EH request (adopted) is not sent again.</summary>
    private async Task ScanAsync(OdipDbContext db, Guid tenantId, DateTime cutoff, DateOnly today, DateTime now, CancellationToken ct)
    {
        var from = today.AddDays(-WindowDays);
        var have = db.EmploymentHeroOutbox.Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Leave).Select(r => r.EntityId);
        var missing = await db.LeaveRequests
            .Where(l => l.Status == LeaveStatus.Approved && l.Source == LeaveSource.Odip && l.ExternalLeaveId == null && l.DecidedAt >= cutoff && l.EndDate >= from
                        && !have.Contains(l.Id) && db.Users.Any(u => u.Id == l.UserId && u.TenantId == tenantId))
            .Select(l => l.Id).Take(ScanSize).ToListAsync(ct);
        // One row per save: EF sorts a batch's inserts by their random row Ids, so two scans insert the same leave in different orders and deadlock on the unique index.
        var collided = 0;
        foreach (var id in missing)
        {
            db.EmploymentHeroOutbox.Add(EmploymentHeroLeave.NewRow(tenantId, EmploymentHeroOutboxKind.Leave, id, now));
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
                collided++;
            }
        }
        if (collided > 0) _logger.LogInformation("Employment Hero leave scan for organisation {TenantId} collided with another run on {Collided} rows", tenantId, collided);
    }

    /// <summary>A sent leave whose employee or dates changed goes back in the queue; a row flagged after a finalised pay run clears when the data matches what was sent again.</summary>
    private async Task CheckChangesAsync(OdipDbContext db, Guid tenantId, EmploymentHeroLeave.LeaveMapping map, DateOnly today, DateTime now, CancellationToken ct)
    {
        var from = today.AddDays(-WindowDays);
        var rows = await db.EmploymentHeroOutbox
            .Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Leave
                        && (r.Status == EmploymentHeroOutboxStatus.Sent || (r.Status == EmploymentHeroOutboxStatus.NeedsAttention && r.LastError == EmploymentHeroTimesheets.FinalisedMessage))
                        && db.LeaveRequests.Any(l => l.Id == r.EntityId && l.TenantId == tenantId && l.Status == LeaveStatus.Approved && l.Source == LeaveSource.Odip && l.EndDate >= from))
            .ToListAsync(ct);
        if (rows.Count == 0) return;
        var data = await LoadAsync(db, tenantId, rows.Select(r => r.EntityId), ct);
        foreach (var row in rows)
        {
            if (!data.TryGetValue(row.EntityId, out var d)) continue;
            var built = EmploymentHeroLeave.Build(d.Leave, d.PayrollId, map);
            if (built.Line is null) continue;
            var hash = EmploymentHeroLeave.Hash(built.Line);
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
            await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
        }
    }

    private sealed record RowData(LeaveRequest Leave, string? PayrollId);

    private static async Task<Dictionary<Guid, RowData>> LoadAsync(OdipDbContext db, Guid tenantId, IEnumerable<Guid> leaveIds, CancellationToken ct)
    {
        var ids = leaveIds.ToList();
        var leaves = await db.LeaveRequests.Where(l => l.TenantId == tenantId && ids.Contains(l.Id)).ToListAsync(ct);
        var workerIds = leaves.Select(l => l.UserId).Distinct().ToList();
        var payroll = await db.Users.Where(u => u.TenantId == tenantId && workerIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.ExternalPayrollId, ct);
        return leaves.ToDictionary(l => l.Id, l => new RowData(l, payroll.GetValueOrDefault(l.UserId)));
    }

    private sealed record PullResult(int Created, int Updated);

    /// <summary>
    /// EH to ODIP, one list call (Decision 8): EH's Rejected or Cancelled closes an Approved ODIP leave (never the other way), approved EH-entered leave comes in
    /// read-only and follows EH, ODIP's own sends are linked by marker and never imported. One save at the end, dropped if the connection changed meanwhile.
    /// </summary>
    private async Task<PullResult> PullAsync(OdipDbContext db, Guid tenantId, string key, string businessId, EmploymentHeroLeave.LeaveMapping map, DateOnly today, DateTime now, CancellationToken ct)
    {
        var windowFrom = today.AddDays(-WindowDays);
        var windowTo = today.AddDays(366);
        List<EhLeaveRef> listed;
        try
        {
            listed = await _client.ListLeaveRequestsAsync(key, businessId, windowFrom, windowTo, null, ct);
        }
        catch (EmploymentHeroException)
        {
            return new(0, 0);
        }

        string Id(int n) => n.ToString(CultureInfo.InvariantCulture);
        var ids = listed.Select(r => Id(r.Id)).ToList();
        var linked = await db.Users.Where(u => u.TenantId == tenantId && u.ExternalPayrollId != null).Select(u => new { u.Id, Payroll = u.ExternalPayrollId! }).ToListAsync(ct);
        var userByPayroll = linked.GroupBy(u => u.Payroll).ToDictionary(g => g.Key, g => g.First().Id);
        var payrollByUser = linked.GroupBy(u => u.Id).ToDictionary(g => g.Key, g => g.First().Payroll);
        var known = await db.LeaveRequests.Where(l => l.TenantId == tenantId && l.ExternalLeaveId != null && ids.Contains(l.ExternalLeaveId)).ToListAsync(ct);
        var knownById = known.GroupBy(l => l.ExternalLeaveId!).ToDictionary(g => g.Key, g => g.First());
        var cancelPending = (await db.EmploymentHeroOutbox.AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.LeaveCancel && r.Status != EmploymentHeroOutboxStatus.Sent).Select(r => r.EntityId).ToListAsync(ct)).ToHashSet();
        var rows = (await db.EmploymentHeroOutbox.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Leave).ToListAsync(ct))
            .GroupBy(r => r.EntityId).ToDictionary(g => g.Key, g => g.First());
        var markerIds = listed.Select(r => EmploymentHeroLeave.TryParseMarker(r.Notes, out var m) ? m : (Guid?)null).OfType<Guid>().ToList();
        var marked = markerIds.Count == 0 ? new Dictionary<Guid, LeaveRequest>()
            : (await db.LeaveRequests.Where(l => l.TenantId == tenantId && l.Source == LeaveSource.Odip && markerIds.Contains(l.Id)).ToListAsync(ct)).ToDictionary(l => l.Id);
        var unlinked = await db.LeaveRequests.Where(l => l.TenantId == tenantId && l.Status == LeaveStatus.Approved && l.Source == LeaveSource.Odip && l.ExternalLeaveId == null
                                                         && l.EndDate >= windowFrom && l.StartDate <= windowTo).ToListAsync(ct);

        // The drain owns an ODIP leave until its DELETE and re-POST land (Decision 6, S3).
        bool Skipped(LeaveRequest l) => cancelPending.Contains(l.Id)
            || (l.Source == LeaveSource.Odip && rows.TryGetValue(l.Id, out var row) && row.ExternalId is not null
                && (!payrollByUser.TryGetValue(l.UserId, out var p) || row.ExternalEmployeeId != p));

        var closures = new List<(LeaveRequest Leave, LeaveStatus To)>();
        var created = new List<LeaveRequest>();
        var changed = 0;
        LeaveStatus? Verdict(string? status) => string.Equals(status, "Rejected", StringComparison.OrdinalIgnoreCase) ? LeaveStatus.Declined
            : string.Equals(status, "Cancelled", StringComparison.OrdinalIgnoreCase) ? LeaveStatus.Cancelled : null;

        foreach (var r in listed)
        {
            var eh = Id(r.Id);
            var approved = string.Equals(r.Status, "Approved", StringComparison.OrdinalIgnoreCase);
            var from = DateOnly.FromDateTime(r.FromDate);
            var to = DateOnly.FromDateTime(r.ToDate);
            var userId = userByPayroll.TryGetValue(Id(r.EmployeeId), out var u) ? (Guid?)u : null;

            if (knownById.TryGetValue(eh, out var leave))                                    // rule 1
            {
                if (leave.Status != LeaveStatus.Approved || Skipped(leave)) continue;
                if (Verdict(r.Status) is { } to2) closures.Add((leave, to2));
                else if (leave.Source == LeaveSource.EmploymentHero && approved)
                {
                    var type = EmploymentHeroLeave.TypeFor(r.LeaveCategoryId, map);
                    if (leave.StartDate != from || leave.EndDate != to || leave.LeaveType != type)
                    {
                        (leave.StartDate, leave.EndDate, leave.LeaveType, leave.UpdatedAt) = (from, to, type, now);
                        changed++;
                    }
                }
                continue;
            }
            if (EmploymentHeroLeave.TryParseMarker(r.Notes, out var markedId))               // rule 2
            {
                if (marked.TryGetValue(markedId, out var mine) && mine.ExternalLeaveId is null && !knownById.ContainsKey(eh)) { mine.ExternalLeaveId = eh; knownById[eh] = mine; unlinked.Remove(mine); }
                continue;
            }
            if (!approved || userId is not { } owner) continue;
            var twin = unlinked.FirstOrDefault(l => l.UserId == owner && l.StartDate == from && l.EndDate == to && !rows.ContainsKey(l.Id));   // rule 3
            twin ??= unlinked.FirstOrDefault(l => l.UserId == owner && l.StartDate == from && l.EndDate == to                                    // rule 4
                && rows.TryGetValue(l.Id, out var sending) && sending.ExternalId is null && sending.Attempts > 0
                && EmploymentHeroLeave.Build(l, payrollByUser[owner], map).Line?.LeaveCategoryId == r.LeaveCategoryId);
            if (twin is not null) { twin.ExternalLeaveId = eh; knownById[eh] = twin; unlinked.Remove(twin); continue; }
            var added = new LeaveRequest                                                      // rule 5
            {
                Id = Guid.NewGuid(), TenantId = tenantId, UserId = owner, LeaveType = EmploymentHeroLeave.TypeFor(r.LeaveCategoryId, map), StartDate = from, EndDate = to,
                Status = LeaveStatus.Approved, Source = LeaveSource.EmploymentHero, ExternalLeaveId = eh, RequestedByUserId = owner, RequestedAt = now, DecidedAt = now,
                CreatedAt = now, UpdatedAt = now,
            };
            created.Add(added);
            knownById[eh] = added;
        }

        // Known Approved leave EH didn't list gets a GET each, at most ten a pull.
        var missing = await db.LeaveRequests.Where(l => l.TenantId == tenantId && l.Status == LeaveStatus.Approved && l.ExternalLeaveId != null
                                                        && l.EndDate >= windowFrom && l.StartDate <= windowTo && !ids.Contains(l.ExternalLeaveId)).OrderBy(l => l.StartDate).ToListAsync(ct);
        foreach (var l in missing.Where(m => !Skipped(m)).Take(10))
        {
            var employee = l.Source == LeaveSource.Odip && rows.TryGetValue(l.Id, out var sent) && sent.ExternalEmployeeId is not null ? sent.ExternalEmployeeId
                : payrollByUser.GetValueOrDefault(l.UserId);
            if (!int.TryParse(employee, NumberStyles.None, CultureInfo.InvariantCulture, out var employeeId) || !int.TryParse(l.ExternalLeaveId, NumberStyles.None, CultureInfo.InvariantCulture, out var leaveId)) continue;
            try
            {
                var found = await _client.GetLeaveRequestAsync(key, businessId, employeeId, leaveId, ct);
                if (found is null) closures.Add((l, LeaveStatus.Cancelled));
                else if (Verdict(found.Status) is { } verdict) closures.Add((l, verdict));
            }
            catch (EmploymentHeroException)
            {
                break;
            }
        }

        // S6, S7: a reconnect or disconnect while EH was being read drops the batch. N1: a decision made meanwhile is not overwritten.
        async Task<bool> Reconnected() => await db.EmploymentHeroConnections.AsNoTracking().Where(c => c.TenantId == tenantId).Select(c => c.BusinessId).FirstOrDefaultAsync(ct) != businessId;
        if (await Reconnected())
        {
            db.ChangeTracker.Clear();
            return new(0, 0);
        }
        var closeIds = closures.Select(c => c.Leave.Id).ToList();
        var stillApproved = (await db.LeaveRequests.AsNoTracking().Where(l => closeIds.Contains(l.Id) && l.Status == LeaveStatus.Approved).Select(l => l.Id).ToListAsync(ct)).ToHashSet();
        var tasks = new Odip.Infrastructure.Tasks.ObligationTaskService(db, _clock);
        foreach (var (l, to) in closures.Where(c => stillApproved.Contains(c.Leave.Id)))
        {
            (l.Status, l.DecidedByUserId, l.DecidedAt, l.UpdatedAt) = (to, null, now, now);
            if (to == LeaveStatus.Declined) l.DecisionNote = "Changed in Employment Hero";
            await tasks.CompleteByLeaveAsync(l.Id, ct);
            changed++;
        }
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            db.ChangeTracker.Clear();
            _logger.LogInformation("Employment Hero leave pull for organisation {TenantId} collided with another run ({Error})", tenantId, ex.GetType().Name);
            return new(0, 0);
        }
        // One leave per save: EF sorts a batch's inserts by their random row Ids, so two pulls insert the same EH leaves in different orders and deadlock on the unique index.
        if (created.Count > 0 && await Reconnected()) return new(0, changed);
        var imported = 0;
        foreach (var leave in created)
        {
            db.LeaveRequests.Add(leave);
            try
            {
                await db.SaveChangesAsync(ct);
                imported++;
            }
            catch (DbUpdateException ex)
            {
                db.ChangeTracker.Clear();
                _logger.LogInformation("Employment Hero leave pull for organisation {TenantId} found {ExternalLeaveId} already imported by another run ({Error})", tenantId, leave.ExternalLeaveId, ex.GetType().Name);
            }
        }
        return new(imported, changed);
    }

    private sealed record DrainResult(int Sent, int Failed, int Flagged, EmploymentHeroFailure? StoppedBy);

    private static bool SaysFinalised(string words) =>
        words.Contains("Processed", StringComparison.OrdinalIgnoreCase) || words.Contains("paid", StringComparison.OrdinalIgnoreCase) || words.Contains("finalis", StringComparison.OrdinalIgnoreCase);

    private async Task<DrainResult> DrainAsync(OdipDbContext db, Guid tenantId, string key, string biz, EmploymentHeroLeave.LeaveMapping map, DateTime now, CancellationToken ct)
    {
        int sent = 0, failed = 0, flagged = 0, budget = BatchSize;
        EmploymentHeroFailure? stoppedBy = null;
        DateTime? holdUntil = null;
        var stop = false;
        var watch = Stopwatch.StartNew();

        // D3: the timesheet sender's Flag and Fail are local to its drain, so the leave drain has its own copies.
        void Flag(EmploymentHeroOutbox row, string why)
        {
            row.Status = EmploymentHeroOutboxStatus.NeedsAttention;
            row.LastError = why;
            flagged++;
        }
        void Fail(EmploymentHeroOutbox row, string why)
        {
            if (row.Attempts > Delays.Length) { Flag(row, EmploymentHeroLeave.GaveUpMessage); return; }
            row.Status = EmploymentHeroOutboxStatus.Failed;
            row.NextAttemptAt = now + Delays[row.Attempts - 1];
            row.LastError = why;
            failed++;
        }

        // Only linked workers on leave that is still wanted: an unlinked worker's row waits without costing a try.
        var due = await db.EmploymentHeroOutbox
            .Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Leave
                        && (r.Status == EmploymentHeroOutboxStatus.Pending || r.Status == EmploymentHeroOutboxStatus.Failed) && r.NextAttemptAt <= now
                        && db.LeaveRequests.Any(l => l.Id == r.EntityId && l.TenantId == tenantId && l.Status == LeaveStatus.Approved && l.Source == LeaveSource.Odip
                                                     && db.Users.Any(u => u.Id == l.UserId && u.TenantId == tenantId && u.ExternalPayrollId != null))
                        && !db.EmploymentHeroOutbox.Any(c => c.TenantId == tenantId && c.Kind == EmploymentHeroOutboxKind.LeaveCancel && c.EntityId == r.EntityId))
            .OrderBy(r => r.NextAttemptAt).Take(budget).ToListAsync(ct);
        var data = await LoadAsync(db, tenantId, due.Select(r => r.EntityId), ct);

        foreach (var row in due)
        {
            if (watch.Elapsed > DrainBudget || stop || holdUntil is not null) break;
            budget--;
            if (!data.TryGetValue(row.EntityId, out var d)) { Flag(row, "This leave is no longer available."); await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct); continue; }
            var leave = d.Leave;
            var built = EmploymentHeroLeave.Build(leave, d.PayrollId, map);
            if (built.WaitReason is { } why)
            {
                row.Status = EmploymentHeroOutboxStatus.Pending;
                row.LastError = why;
                row.NextAttemptAt = now + WaitingRetry;
                await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
                continue;
            }
            if (!await EmploymentHeroTimesheetSender.ClaimAsync(db, row, now, ct)) continue;   // another drain has it
            if (!await StillWantedAsync(db, tenantId, leave.Id, ct))
            {   // cancelled since loading: the LeaveCancel owns it
                row.Attempts--;
                row.NextAttemptAt = now;
                await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
                continue;
            }
            var line = built.Line!;
            var employee = line.EmployeeId;
            var employeeText = employee.ToString(CultureInfo.InvariantCulture);
            var firstCreate = row.ExternalId is null;
            try
            {
                var (hours, defaulted) = EmploymentHeroLeave.Hours(leave.StartDate, leave.EndDate, await _client.GetStandardHoursPerDayAsync(key, biz, employee, ct));
                if (hours == 0)
                {
                    Flag(row, EmploymentHeroLeave.WeekendMessage);
                    await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
                    continue;
                }
                line = line with { Hours = hours };
                if (row.ExternalId is { } old && row.ExternalEmployeeId != employeeText)
                {   // relinked: EH's request belongs to the old employee
                    await _client.DeleteLeaveRequestAsync(key, biz, int.Parse(row.ExternalEmployeeId!, CultureInfo.InvariantCulture), int.Parse(old, CultureInfo.InvariantCulture), ct);
                    row.ExternalId = null;
                    row.ExternalEmployeeId = null;
                    leave.ExternalLeaveId = null;
                    firstCreate = true;
                    await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);   // a lost POST below is then found first
                }
                // An earlier try may have reached EH before its answer was lost: look the request up before creating another.
                var found = row.ExternalId is null && row.Attempts > 1 ? await FindAsync(key, biz, leave, employee, line.LeaveCategoryId, ct) : null;
                int? id = row.ExternalId is { } known ? int.Parse(known, CultureInfo.InvariantCulture) : found?.Id;
                if (id is { } existing) await _client.UpdateLeaveRequestAsync(key, biz, employee, existing, line with { Id = existing }, ct);
                else
                {
                    found = await _client.CreateLeaveRequestAsync(key, biz, employee, line, ct);
                    id = found.Id;
                }
                if (string.Equals(found?.Status, "Pending", StringComparison.OrdinalIgnoreCase))
                    await _client.ApproveLeaveRequestAsync(key, biz, employee, id.Value, ct);
                row.Status = EmploymentHeroOutboxStatus.Sent;
                row.ExternalId = id.Value.ToString(CultureInfo.InvariantCulture);
                row.ExternalEmployeeId = employeeText;
                row.PayloadHash = EmploymentHeroLeave.Hash(line);
                row.SentAt = now;
                row.Attempts = 0;
                row.LastError = null;
                sent++;
                leave.ExternalLeaveId = row.ExternalId;   // same save: the pull dedupes on it
                leave.SentHours = hours;
                leave.SentHoursDefaulted = defaulted;
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
                if (SaysFinalised(ex.Message)) Flag(row, firstCreate ? EmploymentHeroLeave.CreateFinalisedMessage : EmploymentHeroTimesheets.FinalisedMessage);
                else Flag(row, ex.Message.Length <= 300 ? ex.Message : ex.Message[..300]);
            }
            catch (EmploymentHeroException ex)
            {
                Fail(row, ex.Failure == EmploymentHeroFailure.BusinessNotFound ? "Employment Hero couldn't find the business or the employee." : "Employment Hero couldn't be reached.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Fail(row, "ODIP couldn't send this leave.");
                _logger.LogWarning("Leave row failed ({Error})", ex.GetType().Name);
            }
            try
            {
                await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
            }
            catch (DbUpdateException ex) when (ex is not DbUpdateConcurrencyException)
            {   // EH's id is already on another leave. Every row loaded for this batch is detached now, so a later claim would never be stored: flag this row and stop.
                db.ChangeTracker.Clear();
                var again = await db.EmploymentHeroOutbox.FirstAsync(r => r.Id == row.Id, ct);
                Flag(again, EmploymentHeroLeave.LinkClashMessage);
                await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, again, now, ct);
                _logger.LogWarning("Leave row could not be linked ({Error})", ex.GetType().Name);
                stop = true;
                break;
            }
            if (holdUntil is not null) break;
            if (_pause > TimeSpan.Zero) await Task.Delay(_pause, ct);
        }

        if (!stop && holdUntil is null) await CancelDrainAsync(db, tenantId, key, biz, map, now, watch, budget, () => holdUntil, h => holdUntil = h, f => stoppedBy = f,
            () => sent++, Flag, Fail, ct);

        if (holdUntil is { } until)
            foreach (var row in await db.EmploymentHeroOutbox
                         .Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Leave && r.Status == EmploymentHeroOutboxStatus.Pending && r.NextAttemptAt < until).ToListAsync(ct))
            {
                row.NextAttemptAt = until;
                await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
            }
        return new(sent, failed, flagged, stoppedBy);
    }

    /// <summary>An AsNoTracking read: the leave is still Approved and has no LeaveCancel row.</summary>
    private static async Task<bool> StillWantedAsync(OdipDbContext db, Guid tenantId, Guid leaveId, CancellationToken ct) =>
        await db.LeaveRequests.AsNoTracking().AnyAsync(l => l.Id == leaveId && l.TenantId == tenantId && l.Status == LeaveStatus.Approved, ct)
        && !await db.EmploymentHeroOutbox.AsNoTracking().AnyAsync(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.LeaveCancel && r.EntityId == leaveId, ct);

    /// <summary>The request ODIP's earlier try created: the one holding this leave's marker, else the first unmarked one with the same category and dates (a marked one belongs to another ODIP leave).</summary>
    private async Task<EhLeaveRef?> FindAsync(string key, string biz, LeaveRequest leave, int employeeId, int? categoryId, CancellationToken ct)
    {
        var list = await _client.ListLeaveRequestsAsync(key, biz, leave.StartDate, leave.EndDate, employeeId, ct);
        return list.FirstOrDefault(r => EmploymentHeroLeave.TryParseMarker(r.Notes, out var id) && id == leave.Id)
               ?? list.FirstOrDefault(r => !EmploymentHeroLeave.TryParseMarker(r.Notes, out _) && r.LeaveCategoryId == categoryId && DateOnly.FromDateTime(r.FromDate) == leave.StartDate && DateOnly.FromDateTime(r.ToDate) == leave.EndDate);
    }

    /// <summary>Takes cancelled leave back out of EH. Shares the Leave drain's 10-row budget and 10 s.</summary>
    private async Task CancelDrainAsync(OdipDbContext db, Guid tenantId, string key, string biz, EmploymentHeroLeave.LeaveMapping map, DateTime now, Stopwatch watch, int budget,
        Func<DateTime?> getHold, Action<DateTime?> setHold, Action<EmploymentHeroFailure?> setStopped, Action countSent,
        Action<EmploymentHeroOutbox, string> flag, Action<EmploymentHeroOutbox, string> fail, CancellationToken ct)
    {
        if (budget <= 0) return;
        var due = await db.EmploymentHeroOutbox
            .Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.LeaveCancel
                        && (r.Status == EmploymentHeroOutboxStatus.Pending || r.Status == EmploymentHeroOutboxStatus.Failed) && r.NextAttemptAt <= now)
            .OrderBy(r => r.NextAttemptAt).Take(budget).ToListAsync(ct);
        if (due.Count == 0) return;
        var data = await LoadAsync(db, tenantId, due.Select(r => r.EntityId), ct);
        var ids = due.Select(r => r.EntityId).ToList();
        var leaveRows = (await db.EmploymentHeroOutbox.Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Leave && ids.Contains(r.EntityId)).ToListAsync(ct))
            .ToDictionary(r => r.EntityId);

        foreach (var row in due)
        {
            if (watch.Elapsed > DrainBudget || getHold() is not null) break;
            if (!data.TryGetValue(row.EntityId, out var d)) { flag(row, "This leave is no longer available."); await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct); continue; }
            var leave = d.Leave;
            leaveRows.TryGetValue(row.EntityId, out var l);
            if (l is { Status: EmploymentHeroOutboxStatus.Pending, Attempts: > 0 } && l.NextAttemptAt > now)
            {   // the send is in flight: wait for it, then delete what it created
                row.NextAttemptAt = l.NextAttemptAt;
                await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
                continue;
            }
            var idText = l?.ExternalId ?? leave.ExternalLeaveId;
            var employeeText = l?.ExternalId is not null ? l.ExternalEmployeeId : d.PayrollId;
            if (!int.TryParse(employeeText ?? d.PayrollId, NumberStyles.None, CultureInfo.InvariantCulture, out var employee) && (idText is not null || l is { Attempts: > 0 }))
            {
                row.LastError = EmploymentHeroTimesheets.NotLinkedReason;
                row.NextAttemptAt = now + WaitingRetry;
                await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
                continue;
            }
            if (!await EmploymentHeroTimesheetSender.ClaimAsync(db, row, now, ct)) continue;
            try
            {
                int? id = idText is not null ? int.Parse(idText, CultureInfo.InvariantCulture) : null;
                if (id is null && l is { Attempts: > 0 })
                    id = (await FindAsync(key, biz, leave, employee, EmploymentHeroLeave.Build(leave, d.PayrollId, map).Line?.LeaveCategoryId, ct))?.Id;
                if (id is { } gone) await _client.DeleteLeaveRequestAsync(key, biz, employee, gone, ct);   // false (already gone) is done too
                row.Status = EmploymentHeroOutboxStatus.Sent;
                row.ExternalId = id?.ToString(CultureInfo.InvariantCulture);
                row.SentAt = now;
                row.Attempts = 0;
                row.LastError = null;
                countSent();
            }
            catch (EmploymentHeroException ex) when (ex.Failure is EmploymentHeroFailure.RateLimited or EmploymentHeroFailure.KeyRefused)
            {
                row.Attempts--;
                row.Status = EmploymentHeroOutboxStatus.Pending;
                var hold = now + (ex.Failure == EmploymentHeroFailure.RateLimited ? ex.RetryAfter ?? TimeSpan.FromSeconds(60) : TimeSpan.FromMinutes(30));
                setHold(hold);
                row.NextAttemptAt = hold;
                row.LastError = ex.Failure == EmploymentHeroFailure.RateLimited ? EmploymentHeroTimesheets.BusyMessage : EmploymentHeroTimesheets.KeyRefusedReason;
                setStopped(ex.Failure);
            }
            catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.Refused)
            {   // the leave stays Cancelled in ODIP either way
                if (SaysFinalised(ex.Message)) flag(row, EmploymentHeroLeave.CancelFinalisedMessage);
                else flag(row, ex.Message.Length <= 300 ? ex.Message : ex.Message[..300]);
            }
            catch (EmploymentHeroException ex)
            {
                fail(row, ex.Failure == EmploymentHeroFailure.BusinessNotFound ? "Employment Hero couldn't find the business or the employee." : "Employment Hero couldn't be reached.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                fail(row, "ODIP couldn't take this leave back.");
                _logger.LogWarning("Leave cancel row failed ({Error})", ex.GetType().Name);
            }
            await EmploymentHeroTimesheetSender.SaveOrSkipAsync(db, row, now, ct);
            if (getHold() is not null) break;
            if (_pause > TimeSpan.Zero) await Task.Delay(_pause, ct);
        }
    }
}
