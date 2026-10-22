using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Integrations;

/// <summary>What ODIP sends Employment Hero for an approved shift, its fingerprint, and the one word the Payroll page prints. Pure: no database, no clock.</summary>
public static class EmploymentHeroTimesheets
{
    public const string NotLinkedReason = "Staff not linked to Employment Hero";
    public const string FinalisedMessage = "Changed after the pay run was finalised: fix it in Employment Hero";
    public const string GaveUpMessage = "ODIP stopped trying after six tries. Send missing tries again.";
    public const string BusyMessage = "Employment Hero is busy.";
    public const string KeyRefusedReason = "Employment Hero didn't accept the API key.";

    public sealed record TimesheetMapping(string? Standard, string? ActiveNight, string? PassiveNight, string? Sleepover);
    public sealed record TimesheetBuild(EhTimesheetLine? Line, string? WaitReason, string? Hash = null);

    private const string Wire = "yyyy-MM-dd'T'HH:mm:ss";

    /// <summary>Total: a shift that can't be sent yet comes back with the reason, never an exception.</summary>
    public static TimesheetBuild Build(Shift s, ShiftCompletion c, IEnumerable<ShiftBreak> breaks, string? payrollId, TimesheetMapping map, TimeZoneInfo providerZone)
    {
        if (payrollId is null) return new(null, NotLinkedReason);
        if (!int.TryParse(payrollId, NumberStyles.None, CultureInfo.InvariantCulture, out var employeeId))
            return new(null, "ODIP can't read this worker's Employment Hero id. Link them again in Settings → Integrations.");
        var (workType, kind) = s.NightType switch
        {
            SleepoverType.ActiveNight => (map.ActiveNight, "active nights"),
            SleepoverType.PassiveNight => (map.PassiveNight, "passive nights"),
            SleepoverType.Sleepover => (map.Sleepover, "sleepovers"),
            _ => (map.Standard, (string?)null),
        };
        int? workTypeId = int.TryParse(workType, NumberStyles.None, CultureInfo.InvariantCulture, out var w) ? w : null;
        if (kind is not null && workTypeId is null) return new(null, $"Choose the Employment Hero work type for {kind} in Settings → Integrations.");
        var zone = string.IsNullOrEmpty(c.TimeZoneId) ? providerZone : ProviderLocalTime.ResolveZone(c.TimeZoneId);
        string Local(DateTime utc)
        {
            var t = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);
            return t.AddTicks(-(t.Ticks % TimeSpan.TicksPerMinute)).ToString(Wire, CultureInfo.InvariantCulture);
        }
        string start, end;
        var sent = new List<EhBreak>();
        var instants = new List<string>();   // what the hash covers: the shift's own times, so a work-type or provider time-zone change never reads as an edit
        if (s.NightType == SleepoverType.Sleepover)   // a sleepover sends its rostered times (already local)
        {
            start = s.ServiceDate.ToDateTime(s.StartTime).ToString(Wire, CultureInfo.InvariantCulture);
            end = s.ServiceDate.AddDays(s.EndsNextDay ? 1 : 0).ToDateTime(s.EndTime).ToString(Wire, CultureInfo.InvariantCulture);
            instants.AddRange([start, end]);
        }
        else
        {
            var to = c.ActualEnd ?? c.ActualStart;
            start = Local(c.ActualStart);
            end = Local(to);
            instants.AddRange([Minute(c.ActualStart), Minute(to)]);
            foreach (var b in breaks.OrderBy(b => b.StartedAt))   // clamped exactly as ShiftBreakRules.NetWorked clamps
            {
                var from = b.StartedAt < c.ActualStart ? c.ActualStart : b.StartedAt;
                var until = b.EndedAt is { } e && e < to ? e : to;
                if (until > from && Local(until) != Local(from)) { sent.Add(new EhBreak(Local(from), Local(until), false)); instants.AddRange([Minute(from), Minute(until)]); }   // a sub-minute break would go zero-length
            }
        }
        var hash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new object[] { employeeId, s.NightType, instants }, EmploymentHeroClient.WireJson)));
        return new(new EhTimesheetLine(null, employeeId, start, end, sent, workTypeId, c.Id.ToString("D")), null, hash);
    }

    private static string Minute(DateTime utc) => (utc.Ticks / TimeSpan.TicksPerMinute).ToString(CultureInfo.InvariantCulture);

    /// <summary>The provider-local date the organisation connected on; shifts before it are never queued. Null when the organisation isn't connected.</summary>
    public static async Task<DateOnly?> CutoffAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        var at = await db.EmploymentHeroConnections.IgnoreQueryFilters().Where(c => c.TenantId == tenantId).Select(c => (DateTime?)c.ConnectedAt).FirstOrDefaultAsync(ct);
        if (at is null) return null;
        return ProviderLocalTime.TodayIn(ProviderLocalTime.AsUtc(at.Value), (await ProviderTimeZoneResolver.ResolveAsync(db, tenantId, ct)).Zone);
    }

    public static EmploymentHeroOutbox NewRow(Guid tenantId, Guid completionId, DateTime now) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, Kind = EmploymentHeroOutboxKind.Timesheet, EntityId = completionId,
        Status = EmploymentHeroOutboxStatus.Pending, Attempts = 0, NextAttemptAt = now, CreatedAt = now, UpdatedAt = now,
    };

    /// <summary>Adds a Pending row for each approved shift on or after the connect date that has none yet. Never saves: it rides on the approval's own save.</summary>
    public static async Task EnqueueAsync(OdipDbContext db, Guid tenantId, IReadOnlyCollection<(Shift Shift, ShiftCompletion Completion)> approved, DateTime now, CancellationToken ct)
    {
        if (approved.Count == 0 || await CutoffAsync(db, tenantId, ct) is not { } cutoff) return;
        var due = approved.Where(p => p.Shift.ServiceDate >= cutoff).Select(p => p.Completion.Id).ToList();
        if (due.Count == 0) return;
        var have = await db.EmploymentHeroOutbox.IgnoreQueryFilters()
            .Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Timesheet && due.Contains(r.EntityId)).Select(r => r.EntityId).ToListAsync(ct);
        foreach (var id in due.Except(have)) db.EmploymentHeroOutbox.Add(NewRow(tenantId, id, now));
    }

    /// <summary>The one derivation of a shift's word, reason and whether Send missing may queue it. The first matching rule wins.</summary>
    public static (PayrollShiftStatus Status, string? Reason, bool Sendable) StatusOf(EmploymentHeroOutbox? row, bool linked, string? waitReason, TimeZoneInfo providerZone)
    {
        string Retry() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(row!.NextAttemptAt, DateTimeKind.Utc), providerZone)
            .ToString("h:mm tt", CultureInfo.InvariantCulture).ToLowerInvariant();
        if (!linked && (row is null || row.Status == EmploymentHeroOutboxStatus.Pending)) return (PayrollShiftStatus.NotLinked, NotLinkedReason, false);
        if (row is null) return (PayrollShiftStatus.Waiting, "Not queued yet. Send missing queues it.", true);
        return row.Status switch
        {
            EmploymentHeroOutboxStatus.Pending when row.LastError is BusyMessage or KeyRefusedReason => (PayrollShiftStatus.Waiting, $"{row.LastError} ODIP tries again at {Retry()}.", false),
            EmploymentHeroOutboxStatus.Pending => (PayrollShiftStatus.Waiting,
                waitReason ?? (row.SentAt is null ? "Queued. ODIP sends about 25 shifts a minute." : "Changed in ODIP; the update is queued."), false),
            EmploymentHeroOutboxStatus.Failed => (PayrollShiftStatus.Failed, $"{row.LastError} ODIP tries again at {Retry()}.", true),
            EmploymentHeroOutboxStatus.NeedsAttention when row.LastError == FinalisedMessage => (PayrollShiftStatus.Changed, FinalisedMessage, false),
            EmploymentHeroOutboxStatus.NeedsAttention => (PayrollShiftStatus.Failed, row.LastError, true),
            _ => (PayrollShiftStatus.Sent, null, false),
        };
    }
}
