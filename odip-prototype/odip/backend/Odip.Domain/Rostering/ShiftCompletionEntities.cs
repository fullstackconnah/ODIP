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
    /// <summary>Database name of the partial unique index enforcing one active completion per shift
    /// (OdipDbContext + migration 20260908113607). PortalController.StartShift matches this name on
    /// PostgresException.ConstraintName to turn a racing double-Start into 409 SHIFT_NOT_STARTABLE.</summary>
    public const string ActiveIndexName = "IX_ShiftCompletions_ShiftId_Active";

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
    /// The handover note the worker leaves for the next worker, written at Finish (one per completion; empty is
    /// allowed). The latest handover for a participant is the most recent submitted-or-approved completion's - see
    /// <c>ShiftHandoverService</c>.
    /// </summary>
    public string? HandoverText { get; set; }

    /// <summary>The worker explicitly confirmed "nothing to hand over" at Finish (distinct from simply leaving it blank).</summary>
    public bool NothingToHandOver { get; set; }

    /// <summary>The worker explicitly confirmed "nothing to note" at Finish instead of writing a shift note.</summary>
    public bool NothingToNoteConfirmed { get; set; }

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
        TimeZoneInfo tz;
        try
        {
            tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            // F5: an unresolvable/corrupt IANA id must never 500 the whole request — fall back
            // to the same zone StateTimeZoneMap.Resolve defaults to for an unmatched state.
            tz = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
        }

        var rosteredStartLocal = shift.ServiceDate.ToDateTime(shift.StartTime, DateTimeKind.Unspecified);
        var endDate = shift.EndsNextDay ? shift.ServiceDate.AddDays(1) : shift.ServiceDate;
        var rosteredEndLocal = endDate.ToDateTime(shift.EndTime, DateTimeKind.Unspecified);

        return (ToUtcSafe(rosteredStartLocal, tz), ToUtcSafe(rosteredEndLocal, tz));
    }

    /// <summary>
    /// F5: a rostered local time can land inside a spring-forward gap (the clock skips an hour,
    /// e.g. 02:00-03:00 doesn't exist on the day DST starts) — TimeZoneInfo.ConvertTimeToUtc
    /// throws for those. Skew one hour later into the first valid instant rather than fail the
    /// whole completion flow over an edge-of-DST rostered time.
    /// </summary>
    private static DateTime ToUtcSafe(DateTime local, TimeZoneInfo tz)
    {
        if (tz.IsInvalidTime(local)) local = local.AddHours(1);
        return TimeZoneInfo.ConvertTimeToUtc(local, tz);
    }

    public static int VarianceMinutes(DateTime actualUtc, DateTime rosteredUtc) =>
        (int)Math.Round((actualUtc - rosteredUtc).TotalMinutes);
}
