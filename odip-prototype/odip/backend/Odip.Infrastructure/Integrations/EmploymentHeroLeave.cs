using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Integrations;

/// <summary>What ODIP sends Employment Hero for an approved leave request, its fingerprint, and the words the card prints. Pure except <see cref="MappingAsync"/>.</summary>
public static class EmploymentHeroLeave
{
    public const string FromEhMessage = "This leave was entered in Employment Hero. Change or cancel it there.";
    public const string CancelFinalisedMessage = "Cancelled in ODIP after the pay run was finalised: fix it in Employment Hero";
    public const string WeekendMessage = "This leave falls only on a weekend, so ODIP has no standard hours to send. Enter it in Employment Hero if it is paid.";
    public const string GaveUpMessage = "ODIP stopped trying after six tries.";
    public const string CreateFinalisedMessage = "Sent after the pay run was finalised: enter it in Employment Hero";
    public const string LinkClashMessage = "ODIP could not link this leave to Employment Hero's copy.";
    private const string UnreadableIdReason = "ODIP can't read this worker's Employment Hero id. Link them again in Settings → Integrations.";
    private const string CategoryReasonStart = "Choose the Employment Hero leave category for ";
    public const decimal DefaultDailyHours = 7.6m;

    // shortcut: a placeholder ship time; the lead sets it to the real ship time in the merge commit. Leave decided before it may already be entered in EH by payroll.
    public static readonly DateTime LeaveSyncEpoch = new(2026, 10, 24, 0, 0, 0, DateTimeKind.Utc);
    public static DateTime Cutoff(DateTime connectedAt) => connectedAt > LeaveSyncEpoch ? connectedAt : LeaveSyncEpoch;

    public sealed record LeaveMapping(string? Annual, string? Sick, string? Personal, string? Other);
    public sealed record LeaveBuild(EhLeaveLine? Line, string? WaitReason);

    private static readonly Regex MarkerPattern = new(@"ref ([0-9a-fA-F-]{36})", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static string Marker(Guid leaveId) => $"Sent from ODIP (ref {leaveId:D})";

    /// <summary>The leave a note was sent for, when it still holds ODIP's marker.</summary>
    public static bool TryParseMarker(string? notes, out Guid leaveId)
    {
        leaveId = Guid.Empty;
        return notes is not null && notes.Contains("Sent from ODIP", StringComparison.Ordinal)
            && MarkerPattern.Match(notes) is { Success: true } m && Guid.TryParse(m.Groups[1].Value, out leaveId);
    }

    // shortcut: counts Mon-Fri and ignores public holidays; move to EH's leaverequest/estimate if payroll asks (Open gap 1).
    public static (decimal Hours, bool Defaulted) Hours(DateOnly from, DateOnly to, decimal? perDay)
    {
        var days = 0;
        for (var d = from; d <= to; d = d.AddDays(1)) if (d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)) days++;
        var defaulted = perDay is not > 0;
        return (Math.Round(days * (defaulted ? DefaultDailyHours : perDay!.Value), 2), defaulted);
    }

    /// <summary>Employee and dates only: no category (a mapping change applies to unsent leave only) and no hours (those need an EH call).</summary>
    public static string Hash(EhLeaveLine l) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('|',
        l.EmployeeId.ToString(CultureInfo.InvariantCulture), l.FromDate, l.ToDate))));

    private static string? Mapped(LeaveType type, LeaveMapping map) => type switch
    {
        LeaveType.Annual => map.Annual, LeaveType.Sick => map.Sick, LeaveType.Personal => map.Personal, _ => map.Other,
    };

    /// <summary>Total: leave that can't be sent yet comes back with the reason, never an exception. The line's Hours is 0; the send fills it.</summary>
    public static LeaveBuild Build(LeaveRequest leave, string? payrollId, LeaveMapping map)
    {
        if (payrollId is null) return new(null, EmploymentHeroTimesheets.NotLinkedReason);
        if (!int.TryParse(payrollId, NumberStyles.None, CultureInfo.InvariantCulture, out var employeeId)) return new(null, UnreadableIdReason);
        if (!int.TryParse(Mapped(leave.LeaveType, map), NumberStyles.None, CultureInfo.InvariantCulture, out var categoryId))
            return new(null, $"{CategoryReasonStart}{leave.LeaveType.ToString().ToLowerInvariant()} leave in Settings → Integrations.");
        string Day(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "T00:00:00";
        return new(new EhLeaveLine(null, employeeId, Day(leave.StartDate), Day(leave.EndDate), categoryId, 0m, Marker(leave.Id), true), null);
    }

    /// <summary>The ODIP type an EH category comes in as: the first type (enum order) mapped to it, else Other.</summary>
    public static LeaveType TypeFor(int? categoryId, LeaveMapping map)
    {
        if (categoryId is { } id)
            foreach (var type in new[] { LeaveType.Annual, LeaveType.Sick, LeaveType.Personal })
                if (Mapped(type, map) == id.ToString(CultureInfo.InvariantCulture)) return type;
        return LeaveType.Other;
    }

    public static async Task<LeaveMapping> MappingAsync(OdipDbContext db, Guid tenantId, CancellationToken ct) =>
        await db.EmploymentHeroConnections.IgnoreQueryFilters().AsNoTracking().Where(c => c.TenantId == tenantId)
            .Select(c => new LeaveMapping(c.LeaveCategoryAnnual, c.LeaveCategorySick, c.LeaveCategoryPersonal, c.LeaveCategoryOther)).FirstOrDefaultAsync(ct)
        ?? new LeaveMapping(null, null, null, null);

    /// <summary>True for <see cref="Build"/>'s own wait reasons (a missing category, an unreadable id): the card lists those without Try again.</summary>
    public static bool IsWaiting(string? lastError) => lastError is not null && (lastError == UnreadableIdReason || lastError.StartsWith(CategoryReasonStart, StringComparison.Ordinal));
}
