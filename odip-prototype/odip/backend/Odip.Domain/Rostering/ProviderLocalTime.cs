namespace Odip.Domain.Rostering;

/// <summary>
/// Provider-local wall-clock helpers. Rostered shift times and medication slot times are zone-less
/// local clock values ("08:00" on a date) in the PROVIDER's time zone — the same single zone
/// <see cref="ShiftCompletion.TimeZoneId"/> uses, resolved from <c>ProviderSettings.State</c> via
/// <see cref="StateTimeZoneMap"/>. Anything that compares such a local value with "now" (a dose
/// being overdue, a break inside the shift window) must convert through this zone: comparing a
/// zone-less local time with <see cref="DateTime.UtcNow"/> is wrong by the UTC offset (10-11 hours
/// for an Australian provider), which is the bug the MAR "overdue" chip had.
///
/// Comparisons are made on UTC INSTANTS (convert the local slot to UTC, compare with now) rather
/// than on wall-clock values, so the repeated hour at the end of daylight saving and the skipped
/// hour at its start cannot produce a wrong answer.
/// </summary>
public static class ProviderLocalTime
{
    /// <summary>Same fallback <see cref="StateTimeZoneMap.Resolve"/> and <see cref="ShiftVarianceCalculator"/> use.</summary>
    public const string FallbackZoneId = "Australia/Sydney";

    /// <summary>
    /// Resolves an IANA zone id to a <see cref="TimeZoneInfo"/>. An unresolvable/corrupt id must never
    /// 500 a request (the shift-completion F5 rule) — it falls back to <see cref="FallbackZoneId"/>.
    /// </summary>
    public static TimeZoneInfo ResolveZone(string? timeZoneId)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(timeZoneId) ? FallbackZoneId : timeZoneId);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById(FallbackZoneId);
        }
    }

    /// <summary>
    /// Converts a zone-less provider-local wall-clock value to the UTC instant it denotes. A local time
    /// inside a spring-forward gap (which does not exist on the wall clock) is skewed one hour later into
    /// the first valid instant rather than throwing — same rule as
    /// <see cref="ShiftVarianceCalculator.ResolveRosteredTimesUtc"/>. A local time that occurs twice (the
    /// repeated hour when daylight saving ends) resolves to standard time, the .NET default.
    /// </summary>
    public static DateTime LocalToUtc(DateTime localWallClock, TimeZoneInfo zone)
    {
        var unspecified = DateTime.SpecifyKind(localWallClock, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(unspecified)) unspecified = unspecified.AddHours(1);
        return DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeToUtc(unspecified, zone), DateTimeKind.Utc);
    }

    /// <summary>
    /// Marks a UTC instant as UTC so it serialises with a trailing "Z". Instants read back from Postgres come out with
    /// Kind Unspecified (the legacy timestamp behaviour persists Kind verbatim) and would otherwise serialise with NO zone
    /// suffix, indistinguishable from a provider-local wall-clock value on the wire. The shift-package DTOs use this for
    /// every instant they return (breaks, handover, dose outcomes, PRN); provider-local wall-clock fields (dose scheduledAt,
    /// routine occursAt) are deliberately left Unspecified.
    /// </summary>
    public static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    public static DateTime? AsUtc(DateTime? value) => value.HasValue ? AsUtc(value.Value) : null;

    /// <summary>The provider-local wall-clock value (Kind Unspecified, like every stored local time) of a UTC instant.</summary>
    public static DateTime UtcToLocal(DateTime utc, TimeZoneInfo zone) =>
        DateTime.SpecifyKind(
            TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone),
            DateTimeKind.Unspecified);

    /// <summary>
    /// The provider's CALENDAR DATE at the UTC instant <paramref name="utcNow"/>: what a wall calendar in the provider's zone shows. This
    /// is "today" for every calendar rule (a task is overdue, a plan has expired, a review is due, "the date this was completed"). The UTC
    /// date is the wrong answer for 10-11 hours of every Sydney day: at 08:00 on Saturday 3 Oct it is still Friday the 2nd.
    /// </summary>
    public static DateOnly TodayIn(DateTime utcNow, TimeZoneInfo zone) => DateOnly.FromDateTime(UtcToLocal(utcNow, zone));

    /// <summary>
    /// The shift's rostered window as zone-less provider-local wall-clock values: ServiceDate +
    /// StartTime to ServiceDate (+1 day when <see cref="Shift.EndsNextDay"/>) + EndTime. This is the
    /// window "doses due in the shift" are computed over — the ROSTERED window, deliberately not the
    /// worker's actual start/end: a worker who arrives late is still responsible for a dose due at the
    /// rostered start, so a late start must never make a due dose disappear from the checklist.
    /// </summary>
    public static (DateTime StartLocal, DateTime EndLocal) RosteredWindowLocal(Shift shift)
    {
        var start = shift.ServiceDate.ToDateTime(shift.StartTime, DateTimeKind.Unspecified);
        var endDate = shift.EndsNextDay ? shift.ServiceDate.AddDays(1) : shift.ServiceDate;
        var end = endDate.ToDateTime(shift.EndTime, DateTimeKind.Unspecified);
        return (start, end);
    }
}
