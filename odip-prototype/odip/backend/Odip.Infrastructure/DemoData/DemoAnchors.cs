using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.DemoData;

/// <summary>
/// The clock a tick works to. <see cref="D0"/> is the provider's calendar date now (never the UTC date), <see cref="W0"/> the Monday on or
/// before it, <see cref="NowLocal"/> the provider's wall clock. Shift times and dose slots are provider-local wall-clock values stored
/// as typed; every instant (completions, breaks, requests, decisions) goes through <see cref="LocalToUtc(DateTime)"/>, the one conversion
/// allowed: it handles the daylight-saving gap and overlap, so no "AddHours(-10)" and no "DateTime.UtcNow.Date" anywhere in the demo data.
/// </summary>
public sealed record DemoAnchors(DateTime NowUtc, ProviderTimeZone Provider, DateTime NowLocal, DateOnly D0, DateOnly W0)
{
    public TimeZoneInfo Zone => Provider.Zone;

    public static DemoAnchors Create(DateTime nowUtc, string? providerState)
    {
        var utc = ProviderLocalTime.AsUtc(nowUtc);
        var provider = ProviderTimeZoneResolver.FromState(providerState);
        var local = ProviderLocalTime.UtcToLocal(utc, provider.Zone);
        var today = DateOnly.FromDateTime(local);
        return new DemoAnchors(utc, provider, local, today, MondayOf(today));
    }

    public static DateOnly MondayOf(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

    /// <summary>The Monday <paramref name="weeksFromW0"/> weeks after (negative: before) this week's. W1 is <c>Monday(1)</c>.</summary>
    public DateOnly Monday(int weeksFromW0) => W0.AddDays(7 * weeksFromW0);

    public DateTime LocalToUtc(DateTime localWallClock) => ProviderLocalTime.LocalToUtc(localWallClock, Zone);

    public DateTime LocalToUtc(DateOnly date, TimeOnly time) => LocalToUtc(date.ToDateTime(time, DateTimeKind.Unspecified));
}
