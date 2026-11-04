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

    /// <summary>"No fix, for any reason" at Start. No worker coordinate is kept anywhere (owner, 2026-11-04); only the result below.</summary>
    public bool GeolocationDeclined { get; set; }

    /// <summary>The Start check against the shift's service location; null when it was not checked (rows before the check, a manual start through Finish).</summary>
    public LocationCheckStatus? LocationCheck { get; set; }
    /// <summary>Whole metres from the place, set for AtLocation and NotAtLocation.</summary>
    public int? LocationDistanceMetres { get; set; }
    /// <summary>The phone's reported accuracy in whole metres, when it gave one.</summary>
    public int? LocationAccuracyMetres { get; set; }
    /// <summary>The worker's reason (max 300), or "Started offline".</summary>
    public string? LocationReason { get; set; }
    /// <summary>UTC. The Start stamp the check ran at.</summary>
    public DateTime? LocationCheckedAt { get; set; }

    /// <summary>Why the worker started more than <see cref="ShiftTimeRules.OffRosterMinutes"/> minutes off the roster (optional, trimmed, max 500). Null: none given or not off roster.</summary>
    public string? StartTimeReason { get; set; }
    /// <summary>Why the worker finished more than <see cref="ShiftTimeRules.OffRosterMinutes"/> minutes off the roster (optional, trimmed, max 500). A re-Finish after a Return replaces it.</summary>
    public string? FinishTimeReason { get; set; }

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

    /// <summary>UTC. The server's start stamp, kept when the worker moved <see cref="ActualStart"/> at Finish (owner decision 3); null when not moved.</summary>
    public DateTime? OriginalActualStart { get; set; }

    /// <summary>UTC. The Finish instant, kept when the worker moved <see cref="ActualEnd"/> earlier; null when not moved.</summary>
    public DateTime? OriginalActualEnd { get; set; }

    /// <summary>The worker sent a time the phone recorded offline (Start, Finish or a break); the review page marks it. False for every row before the installable app.</summary>
    public bool SentFromOffline { get; set; }

    /// <summary>Why the worker moved either time (max 500); null when nothing was moved.</summary>
    public string? TimeAdjustmentReason { get; set; }

    /// <summary>Kilometres driven with the participant during the shift, 0 to 2,000 to one decimal place (owner decision 4); null when not given.</summary>
    public decimal? Kilometres { get; set; }

    // Provider travel, recorded as two legs (travel PR-A1). Not Kilometres, which is driving WITH the participant. Null or 0 means no travel on that leg.
    /// <summary>Minutes of the worker's trip TO the participant, before the shift: whole minutes, 0 to 480; null when not given.</summary>
    public int? PreShiftTravelMinutes { get; set; }

    /// <summary>Kilometres of the trip before the shift, 0 to 2,000 to one decimal place; null when not given. Not <see cref="Kilometres"/>.</summary>
    public decimal? PreShiftTravelKilometres { get; set; }

    /// <summary>Minutes of the trip AFTER the shift, to base or home: whole minutes, 0 to 480; null when not given.</summary>
    public int? PostShiftTravelMinutes { get; set; }

    /// <summary>Kilometres of the trip after the shift, 0 to 2,000 to one decimal place; null when not given. Not <see cref="Kilometres"/>.</summary>
    public decimal? PostShiftTravelKilometres { get; set; }

    /// <summary>The worker's answer to "Anything to report?" at Finish: true, false, or null when skipped. Informational; it blocks nothing.</summary>
    public bool? AnythingToReport { get; set; }

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
/// today. Unmatched/null state falls back to Australia/Sydney (the map's largest bucket).
/// It is also the default for an organisation with no saved ProviderSettings.TimeZoneId, and the
/// backfill and the frontend picker use the same table.
/// </summary>
public static class StateTimeZoneMap
{
    private static readonly Dictionary<string, string> Map = new(StringComparer.OrdinalIgnoreCase)
    {
        ["VIC"] = "Australia/Melbourne",
        ["NSW"] = "Australia/Sydney",
        ["ACT"] = "Australia/Sydney",
        ["TAS"] = "Australia/Hobart",
        ["QLD"] = "Australia/Brisbane",
        ["SA"] = "Australia/Adelaide",
        ["WA"] = "Australia/Perth",
        ["NT"] = "Australia/Darwin",
    };

    /// <summary>The zones an organisation may choose (the map's distinct values). Ordinal: ids are exact-case. Declared after Map: static initialisers run in text order.</summary>
    public static readonly IReadOnlySet<string> Zones = Map.Values.ToHashSet(StringComparer.Ordinal);

    public static string Resolve(string? state) =>
        state is not null && Map.TryGetValue(state, out var zone) ? zone : "Australia/Sydney";

    /// <summary>The clock a zone id runs on: Melbourne and Hobart follow Sydney's rules, so they share its clock; every other id is its own. Compare clocks, not ids, to ask "same time here and there?".</summary>
    public static string Clock(string id) => id is "Australia/Melbourne" or "Australia/Hobart" ? "Australia/Sydney" : id;
}

/// <summary>
/// Design spec §3: rostered start/end are computed from Shift.ServiceDate + StartTime/EndTime
/// (+1 day on EndTime if EndsNextDay), interpreted as local time in the given IANA zone and
/// converted to UTC. Variance is the signed minute difference against ActualStart/ActualEnd
/// (positive = late/over, negative = early/under).
/// </summary>
public static class ShiftTimeRules
{
    /// <summary>A start or finish more than this many whole minutes either side of the roster is "off roster". Fixed, separate from the org's VarianceReviewMinutes.</summary>
    public const int OffRosterMinutes = 5;
    public const int MaxReasonLength = 500;

    public static bool IsOffRoster(int varianceMinutes) => Math.Abs(varianceMinutes) > OffRosterMinutes;

    /// <summary>The worker's typed reason: trimmed, empty is none, cut to the column length (never a 400 on Start or Finish).</summary>
    public static string? CleanReason(string? reason)
    {
        var trimmed = reason?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length > MaxReasonLength ? trimmed[..MaxReasonLength] : trimmed;
    }
}

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
