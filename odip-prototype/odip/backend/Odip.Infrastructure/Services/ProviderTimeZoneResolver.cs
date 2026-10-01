using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>The provider's single IANA time zone (id) and its <see cref="TimeZoneInfo"/>.</summary>
public sealed record ProviderTimeZone(string Id, TimeZoneInfo Zone);

/// <summary>
/// Resolves the provider's local time zone the way shift completion does: from the tenant's
/// <c>ProviderSettings.State</c> through <see cref="StateTimeZoneMap"/> (unmatched or missing state falls
/// back to Australia/Sydney). The one place that knows how, so the MAR, the medication slot service, the
/// shift package and shift completion can never disagree about "what time is it for this provider".
/// </summary>
public static class ProviderTimeZoneResolver
{
    public static async Task<ProviderTimeZone> ResolveAsync(OdipDbContext db, CancellationToken ct)
    {
        var state = await db.ProviderSettings.Select(p => p.State).FirstOrDefaultAsync(ct);
        return FromState(state);
    }

    /// <summary>
    /// The provider's calendar date now (see <see cref="ProviderLocalTime.TodayIn"/>): the "today" every calendar rule uses. Pass the
    /// request's <see cref="TimeProvider"/> so a test can fix the clock.
    /// </summary>
    public static async Task<DateOnly> TodayAsync(OdipDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var provider = await ResolveAsync(db, ct);
        return ProviderLocalTime.TodayIn(clock.GetUtcNow().UtcDateTime, provider.Zone);
    }

    public static ProviderTimeZone FromState(string? state)
    {
        var id = StateTimeZoneMap.Resolve(state);
        return new ProviderTimeZone(id, ProviderLocalTime.ResolveZone(id));
    }
}
