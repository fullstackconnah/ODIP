using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>The provider's single IANA time zone (id) and its <see cref="TimeZoneInfo"/>.</summary>
public sealed record ProviderTimeZone(string Id, TimeZoneInfo Zone);

/// <summary>
/// Resolves the provider's local time zone the way shift completion does: from the organisation's saved
/// <c>ProviderSettings.TimeZoneId</c>, else its <c>State</c> through <see cref="StateTimeZoneMap"/> (unmatched or missing state falls
/// back to Australia/Sydney). The one place that knows how, so the MAR, the medication slot service, the
/// shift package and shift completion can never disagree about "what time is it for this provider".
/// </summary>
public static class ProviderTimeZoneResolver
{
    public static async Task<ProviderTimeZone> ResolveAsync(OdipDbContext db, CancellationToken ct)
    {
        var row = await db.ScopedProviderSettings().Select(p => new { p.TimeZoneId, p.State }).FirstOrDefaultAsync(ct);
        return For(row?.TimeZoneId, row?.State);
    }

    /// <summary>
    /// The zone of ONE named organisation. <see cref="ResolveAsync(OdipDbContext, CancellationToken)"/> reads whichever settings row the tenant
    /// filter lets through, and a SuperAdmin's context has no filter.
    /// </summary>
    public static async Task<ProviderTimeZone> ResolveAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        var row = await db.ProviderSettings.Where(p => p.TenantId == tenantId).Select(p => new { p.TimeZoneId, p.State }).FirstOrDefaultAsync(ct);
        return For(row?.TimeZoneId, row?.State);
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

    /// <summary>
    /// The provider's calendar date now for ONE named organisation: <see cref="TodayAsync(OdipDbContext, TimeProvider, CancellationToken)"/> reads whichever settings row the context's tenant filter
    /// lets through, and a SuperAdmin's context has no filter, so it would answer with another organisation's state. A service that is handed a tenant id (the budget ledger) uses this.
    /// </summary>
    public static async Task<DateOnly> TodayAsync(OdipDbContext db, Guid tenantId, TimeProvider clock, CancellationToken ct)
    {
        var provider = await ResolveAsync(db, tenantId, ct);
        return ProviderLocalTime.TodayIn(clock.GetUtcNow().UtcDateTime, provider.Zone);
    }

    /// <summary>The organisation's zone: its stored setting when that is one <see cref="StateTimeZoneMap.Zones"/> accepts, else its State's default.</summary>
    public static ProviderTimeZone For(string? timeZoneId, string? state)
    {
        var id = timeZoneId is not null && StateTimeZoneMap.Zones.Contains(timeZoneId) ? timeZoneId : StateTimeZoneMap.Resolve(state);
        return new ProviderTimeZone(id, ProviderLocalTime.ResolveZone(id));
    }

    // Issued invoices and credit notes: their dates follow the State snapshot on the document, so they never move when the zone setting changes.
    public static ProviderTimeZone ForInvoiceState(string? state) => For(null, state);
}
