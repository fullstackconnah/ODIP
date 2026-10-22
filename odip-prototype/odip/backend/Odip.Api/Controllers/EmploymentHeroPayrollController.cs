using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Rostering → Payroll: for a pay period, which approved hours Employment Hero has, which are waiting, and which need someone. A separate controller
/// from the Settings card because [Authorize] attributes AND together: the card is Admin-only, this page also admits Coordinators (Send missing stays Admin).
/// Problems stay on the outbox rows, never in EmploymentHeroAttention, which PR 1's staff sync reconciles away.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/integrations/employment-hero/payroll")]
public class EmploymentHeroPayrollController : ControllerBase
{
    public const int MaxDays = 62;
    public const string RangeMessage = "Choose a pay period of 62 days or fewer.";
    public const string NotConnectedMessage = "Employment Hero isn't connected.";
    public const string CollisionMessage = "Hours are being queued right now. Try again in a minute.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly IntegrationKeyProtector _keys;
    private readonly EmploymentHeroClient _client;
    private readonly TimeProvider _clock;

    public EmploymentHeroPayrollController(OdipDbContext db, ICurrentTenant tenant, IntegrationKeyProtector keys, EmploymentHeroClient client, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _keys = keys;
        _client = client;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>The organisation this request works in. A SuperAdmin must be viewing as one; unscoped, the query filters would read every organisation.</summary>
    private Guid? TenantId => !_tenant.IsSuperAdmin && _tenant.TenantId is { } id ? id : null;

    /// <summary>The pay periods to pick from: finalised pay runs plus each schedule's next period, newest first.</summary>
    [HttpGet("periods")]
    public async Task<ActionResult<ApiResponse<PayPeriodsDto>>> Periods(CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<PayPeriodsDto>.Fail(EmploymentHeroController.ChooseOrganisation));
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        if (await SavedKeyAsync(tenantId, ct) is not { } saved) return Ok(ApiResponse<PayPeriodsDto>.Ok(new PayPeriodsDto(false, today, [])));
        try
        {
            var schedules = (await _client.ListPaySchedulesAsync(saved.Key, saved.BusinessId, ct)).ToDictionary(s => s.Id, s => s.Name);
            string ScheduleName(int id) => string.IsNullOrWhiteSpace(schedules.GetValueOrDefault(id)) ? $"Pay schedule {id}" : schedules[id]!.Trim();
            var runs = (await _client.ListRecentPayRunsAsync(saved.Key, saved.BusinessId, ct))
                .Select(r => new PayPeriodDto(r.PayScheduleId, ScheduleName(r.PayScheduleId), DateOnly.FromDateTime(r.PayPeriodStarting), DateOnly.FromDateTime(r.PayPeriodEnding), r.IsFinalised));
            var forecasts = (await _client.ListNextPayDatesAsync(saved.Key, saved.BusinessId, ct))
                .Where(n => n.NextScheduledFromDate is not null && n.NextScheduledToDate is not null)
                .Select(n => new PayPeriodDto(n.PayScheduleId, ScheduleName(n.PayScheduleId), DateOnly.FromDateTime(n.NextScheduledFromDate!.Value), DateOnly.FromDateTime(n.NextScheduledToDate!.Value), false));
            // A pay run beats the forecast for the same dates.
            var periods = runs.Concat(forecasts).GroupBy(p => (p.PayScheduleId, p.From, p.To)).Select(g => g.First())
                .OrderByDescending(p => p.To).ThenBy(p => p.ScheduleName, StringComparer.Ordinal).ToList();
            return Ok(ApiResponse<PayPeriodsDto>.Ok(new PayPeriodsDto(true, today, periods)));
        }
        catch (EmploymentHeroException ex)
        {
            return StatusCode(ex.Failure is EmploymentHeroFailure.KeyRefused or EmploymentHeroFailure.BusinessNotFound ? 400 : 503, ApiResponse<PayPeriodsDto>.Fail(ex.Message));
        }
    }

    /// <summary>The check: every approved shift in the range, by worker, with the word the Payroll page prints.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PayrollCheckDto>>> Check([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<PayrollCheckDto>.Fail(EmploymentHeroController.ChooseOrganisation));
        if (RangeRefusal(from, to) is { } refusal) return BadRequest(ApiResponse<PayrollCheckDto>.Fail(refusal));
        if (!await _db.EmploymentHeroConnections.AnyAsync(c => c.TenantId == tenantId, ct)) return Conflict(ApiResponse<PayrollCheckDto>.Fail(NotConnectedMessage));
        return Ok(ApiResponse<PayrollCheckDto>.Ok((await LoadAsync(tenantId, from, to, ct)).Check));
    }

    /// <summary>Queues exactly the shifts the check marks Sendable, whatever the connect date. Admin only.</summary>
    [HttpPost("send-missing")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<SendMissingResultDto>>> SendMissing([FromBody] PayrollRangeDto dto, CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<SendMissingResultDto>.Fail(EmploymentHeroController.ChooseOrganisation));
        if (dto.From is not { } from || dto.To is not { } to) return BadRequest(ApiResponse<SendMissingResultDto>.Fail(RangeMessage));
        if (RangeRefusal(from, to) is { } refusal) return BadRequest(ApiResponse<SendMissingResultDto>.Fail(refusal));
        if (!await _db.EmploymentHeroConnections.AnyAsync(c => c.TenantId == tenantId, ct)) return Conflict(ApiResponse<SendMissingResultDto>.Fail(NotConnectedMessage));

        var loaded = await LoadAsync(tenantId, from, to, ct);
        var now = _clock.GetUtcNow().UtcDateTime;
        var queued = 0;
        foreach (var item in loaded.Items.Where(i => i.Sendable))
        {
            queued++;
            if (item.Row is null)
            {
                _db.EmploymentHeroOutbox.Add(EmploymentHeroTimesheets.NewRow(tenantId, item.CompletionId, now));
                continue;
            }
            // shortcut: a given-up row that never got an EH id may have reached EH on a try whose reply was lost, so it restarts at Attempts 1 and looks itself up
            // by externalId before it posts; the cost is four more failures before it gives up again, not six. Upgrade by storing whether a POST was ever sent.
            item.Row.Attempts = item.Row.ExternalId is null && item.Row.Attempts > 0 ? 1 : 0;
            item.Row.Status = EmploymentHeroOutboxStatus.Pending;
            item.Row.LastError = null;
            item.Row.NextAttemptAt = now;
            item.Row.UpdatedAt = now > item.Row.UpdatedAt ? now : item.Row.UpdatedAt.AddTicks(10);
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict(ApiResponse<SendMissingResultDto>.Fail(CollisionMessage));
        }
        _db.ChangeTracker.Clear();
        return Ok(ApiResponse<SendMissingResultDto>.Ok(new SendMissingResultDto(queued, (await LoadAsync(tenantId, from, to, ct)).Check)));
    }

    private static string? RangeRefusal(DateOnly from, DateOnly to) => from > to || to.DayNumber - from.DayNumber + 1 > MaxDays ? RangeMessage : null;

    private sealed record Item(Guid CompletionId, EmploymentHeroOutbox? Row, bool Sendable);

    /// <summary>The range's approved shifts with their derived words. Every query names the organisation and, for the outbox, Kind == Timesheet.</summary>
    private async Task<(PayrollCheckDto Check, List<Item> Items)> LoadAsync(Guid tenantId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct)).Zone;
        var conn = await _db.EmploymentHeroConnections.AsNoTracking().FirstAsync(c => c.TenantId == tenantId, ct);
        var map = new EmploymentHeroTimesheets.TimesheetMapping(conn.WorkTypeStandard, conn.WorkTypeActiveNight, conn.WorkTypePassiveNight, conn.WorkTypeSleepover);

        var completions = await _db.ShiftCompletions.Include(c => c.Shift)
            .Where(c => c.TenantId == tenantId && c.IsActive && c.ReviewOutcome == ReviewOutcome.Approved
                        && c.Shift!.Status == ShiftStatus.Completed && c.Shift.ServiceDate >= from && c.Shift.ServiceDate <= to)
            .ToListAsync(ct);
        var ids = completions.Select(c => c.Id).ToList();
        var workerIds = completions.Select(c => c.SubmittedByUserId).Distinct().ToList();
        var participantIds = completions.Select(c => c.Shift!.ParticipantId).Distinct().ToList();
        var workers = await _db.Users.Where(u => u.TenantId == tenantId && workerIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var participants = await _db.Participants.Where(p => p.TenantId == tenantId && participantIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => $"{p.FirstName} {p.LastName}".Trim(), ct);
        var rows = (await _db.EmploymentHeroOutbox.Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Timesheet && ids.Contains(r.EntityId)).ToListAsync(ct))
            .ToDictionary(r => r.EntityId);
        var breaks = (await _db.ShiftBreaks.AsNoTracking().Where(b => b.TenantId == tenantId && ids.Contains(b.ShiftCompletionId)).ToListAsync(ct)).ToLookup(b => b.ShiftCompletionId);
        var awaiting = await _db.Shifts.CountAsync(s => s.TenantId == tenantId && s.ServiceDate >= from && s.ServiceDate <= to
                                                        && (s.Status == ShiftStatus.InProgress || s.Status == ShiftStatus.PendingReview), ct);

        var items = new List<Item>();
        var byWorker = new Dictionary<Guid, List<PayrollShiftDto>>();
        foreach (var c in completions)
        {
            var shift = c.Shift!;
            workers.TryGetValue(c.SubmittedByUserId, out var worker);
            var payrollId = worker?.ExternalPayrollId;
            rows.TryGetValue(c.Id, out var row);
            var shiftBreaks = breaks[c.Id].ToList();
            var built = EmploymentHeroTimesheets.Build(shift, c, shiftBreaks, payrollId, map, zone);
            var (status, reason, sendable) = EmploymentHeroTimesheets.StatusOf(row, payrollId is not null, built.WaitReason, zone);
            var rostered = (int)(shift.EndTime.ToTimeSpan() - shift.StartTime.ToTimeSpan()).TotalMinutes + (shift.EndsNextDay ? 1440 : 0);
            var (_, breakMinutes, net) = ShiftBreakRules.NetWorked(c.ActualStart, c.ActualEnd, now, shiftBreaks);
            var paid = shift.NightType == SleepoverType.Sleepover ? rostered : net;   // a sleepover is paid its rostered hours
            items.Add(new Item(c.Id, row, sendable));
            if (!byWorker.TryGetValue(c.SubmittedByUserId, out var list)) byWorker[c.SubmittedByUserId] = list = [];
            list.Add(new PayrollShiftDto(shift.Id, shift.ServiceDate, participants.GetValueOrDefault(shift.ParticipantId, ""), shift.StartTime, shift.EndTime, shift.EndsNextDay,
                rostered, c.ActualStart, c.ActualEnd, c.TimeZoneId, breakMinutes, paid, shift.NightType, status, reason, row?.SentAt, sendable));
        }

        static int Rank(PayrollShiftStatus s) => s switch
        {
            PayrollShiftStatus.Changed => 0, PayrollShiftStatus.Failed => 1, PayrollShiftStatus.NotLinked => 2, PayrollShiftStatus.Waiting => 3, _ => 4,
        };
        var workerDtos = byWorker.Select(kv =>
        {
            var shifts = kv.Value.OrderBy(s => s.ServiceDate).ThenBy(s => s.RosteredStart).ToList();
            workers.TryGetValue(kv.Key, out var w);
            return new PayrollWorkerDto(kv.Key, w?.FullName ?? "Former staff member", w?.ExternalPayrollId is not null, shifts.Sum(s => s.RosteredMinutes), shifts.Sum(s => s.PaidMinutes), shifts);
        }).OrderBy(w => w.Shifts.Min(s => Rank(s.Status))).ThenBy(w => w.Name, StringComparer.OrdinalIgnoreCase).ToList();

        var all = workerDtos.SelectMany(w => w.Shifts).ToList();
        int Count(PayrollShiftStatus s) => all.Count(x => x.Status == s);
        var check = new PayrollCheckDto(from, to, all.Count, Count(PayrollShiftStatus.Sent), Count(PayrollShiftStatus.Waiting), Count(PayrollShiftStatus.Failed),
            Count(PayrollShiftStatus.Changed), Count(PayrollShiftStatus.NotLinked), all.Count(x => x.Sendable), awaiting, workerDtos);
        return (check, items);
    }

    private async Task<(string BusinessId, string Key)?> SavedKeyAsync(Guid tenantId, CancellationToken ct)
    {
        var conn = await _db.EmploymentHeroConnections.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
        var key = conn is null ? null : _keys.Unprotect(conn.ApiKeyCiphertext, conn.ApiKeyNonce, tenantId);
        return conn is null || key is null ? null : (conn.BusinessId, key);
    }
}
