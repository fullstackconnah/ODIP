using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>Outcome of an office review of a submitted <see cref="ShiftCompletion"/> (design spec §1/§3).</summary>
public enum ReviewOutcome
{
    Approved = 0,
    Returned = 1
}

/// <summary>
/// One worker Start/Finish submission against a <see cref="Shift"/>, and the office's review of
/// it (design spec §1). "At most one active" per Shift is enforced by
/// IX_ShiftCompletions_ShiftId_Active (a partial unique index on ShiftId WHERE "IsActive",
/// configured in OdipDbContext) — see <see cref="IsActive"/>'s own remarks for why an explicit
/// bool was chosen over deriving activeness from <see cref="ReviewOutcome"/>.
/// </summary>
public class ShiftCompletion : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid ShiftId { get; set; }
    public Shift? Shift { get; set; }

    /// <summary>UTC. Server-stamped at Start unless <see cref="StartWasManual"/> (then supplied by the worker on Finish).</summary>
    public DateTime ActualStart { get; set; }
    /// <summary>UTC. Null until Finish; may fall on the next calendar day for an overnight shift.</summary>
    public DateTime? ActualEnd { get; set; }
    /// <summary>IANA id used to compute variance — resolved once at Start from <see cref="StateTimeZoneMap"/>.</summary>
    public string TimeZoneId { get; set; } = string.Empty;

    public decimal? StartLatitude { get; set; }
    public decimal? StartLongitude { get; set; }
    public decimal? EndLatitude { get; set; }
    public decimal? EndLongitude { get; set; }
    public bool GeolocationDeclined { get; set; }

    /// <summary>True when Finish supplied ActualStart because Start was skipped.</summary>
    public bool StartWasManual { get; set; }

    /// <summary>The worker — Shift.UserId at Start (or manual-Finish) time.</summary>
    public Guid SubmittedByUserId { get; set; }
    /// <summary>= ActualStart unless StartWasManual, in which case this is the real Finish-time stamp.</summary>
    public DateTime StartedAt { get; set; }
    /// <summary>Set on Finish.</summary>
    public DateTime? SubmittedAt { get; set; }

    public Guid? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public ReviewOutcome? ReviewOutcome { get; set; }
    public string? ReturnReason { get; set; }

    /// <summary>ActualStart - rostered start, signed minutes (positive = late).</summary>
    public int VarianceMinutesStart { get; set; }
    /// <summary>ActualEnd - rostered end, signed minutes. 0 until Finish.</summary>
    public int VarianceMinutesEnd { get; set; }

    /// <summary>
    /// True for the one "current" row per Shift. Return sets this false in the same
    /// transaction that flips Shift.Status back to Published, excluding it from the active 1:1
    /// without deleting it — full history stays queryable by ShiftId alone. Approve never
    /// touches this — an Approved row is the active row forever, since a Completed shift can
    /// never be re-started.
    /// </summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Design spec §3: TimeZoneId is resolved once, at Start, from a static AU-state → IANA-zone
/// map keyed off ProviderSettings.State — the only geographic signal that exists on the tenant
/// today. Unmatched/null state falls back to Australia/Sydney (same zone as the map's largest
/// bucket, and the same zone ProviderSettings.State's own default "VIC" resolves to).
/// </summary>
public static class StateTimeZoneMap
{
    private static readonly Dictionary<string, string> Map = new(StringComparer.OrdinalIgnoreCase)
    {
        ["VIC"] = "Australia/Sydney",
        ["NSW"] = "Australia/Sydney",
        ["ACT"] = "Australia/Sydney",
        ["TAS"] = "Australia/Sydney",
        ["QLD"] = "Australia/Brisbane",
        ["SA"] = "Australia/Adelaide",
        ["WA"] = "Australia/Perth",
        ["NT"] = "Australia/Darwin",
    };

    public static string Resolve(string? state) =>
        state is not null && Map.TryGetValue(state, out var zone) ? zone : "Australia/Sydney";
}

/// <summary>
/// Design spec §3: rostered start/end are computed from Shift.ServiceDate + StartTime/EndTime
/// (+1 day on EndTime if EndsNextDay), interpreted as local time in the given IANA zone and
/// converted to UTC. Variance is the signed minute difference against ActualStart/ActualEnd
/// (positive = late/over, negative = early/under).
/// </summary>
public static class ShiftVarianceCalculator
{
    public static (DateTime RosteredStartUtc, DateTime RosteredEndUtc) ResolveRosteredTimesUtc(Shift shift, string timeZoneId)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        var rosteredStartLocal = shift.ServiceDate.ToDateTime(shift.StartTime, DateTimeKind.Unspecified);
        var endDate = shift.EndsNextDay ? shift.ServiceDate.AddDays(1) : shift.ServiceDate;
        var rosteredEndLocal = endDate.ToDateTime(shift.EndTime, DateTimeKind.Unspecified);

        return (TimeZoneInfo.ConvertTimeToUtc(rosteredStartLocal, tz), TimeZoneInfo.ConvertTimeToUtc(rosteredEndLocal, tz));
    }

    public static int VarianceMinutes(DateTime actualUtc, DateTime rosteredUtc) =>
        (int)Math.Round((actualUtc - rosteredUtc).TotalMinutes);
}
