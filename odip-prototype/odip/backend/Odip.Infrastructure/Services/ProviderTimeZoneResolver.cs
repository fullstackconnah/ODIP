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
    /// The zone of ONE shift: its service location's zone when it has a valid one, else the zone of the shift's organisation. The location is read by id AND the shift's tenant, so a
    /// SuperAdmin's unfiltered context cannot pick up another organisation's place. An archived place still gives its zone. Every call that resolves the zone for one shift uses this;
    /// calls that cover many shifts load the places' zones in one query (<see cref="ZonesOfLocationsAsync"/>) and pick per shift with <see cref="ZoneOf"/> (one query per shift is not allowed).
    /// </summary>
    public static async Task<ProviderTimeZone> ForShiftAsync(OdipDbContext db, Shift shift, CancellationToken ct)
    {
        if (shift.ServiceLocationId is { } locationId)
        {
            var zoneId = await db.ServiceLocations.Where(l => l.Id == locationId && l.TenantId == shift.TenantId).Select(l => l.TimeZoneId).FirstOrDefaultAsync(ct);
            if (zoneId is not null && StateTimeZoneMap.Zones.Contains(zoneId)) return new ProviderTimeZone(zoneId, ProviderLocalTime.ResolveZone(zoneId));
        }
        return await ResolveAsync(db, shift.TenantId, ct);
    }

    /// <summary>The valid zone of each named place of ONE organisation, in one query. A place without a zone (or an unknown one) is absent: <see cref="ZoneOf"/> falls back to the organisation's.</summary>
    public static async Task<Dictionary<Guid, TimeZoneInfo>> ZonesOfLocationsAsync(OdipDbContext db, Guid tenantId, IEnumerable<Guid?> locationIds, CancellationToken ct)
    {
        var ids = locationIds.OfType<Guid>().Distinct().ToList();
        if (ids.Count == 0) return new();
        var rows = await db.ServiceLocations.Where(l => ids.Contains(l.Id) && l.TenantId == tenantId && l.TimeZoneId != null).Select(l => new { l.Id, l.TimeZoneId }).ToListAsync(ct);
        return rows.Where(r => StateTimeZoneMap.Zones.Contains(r.TimeZoneId!)).ToDictionary(r => r.Id, r => ProviderLocalTime.ResolveZone(r.TimeZoneId!));
    }

    /// <summary>One shift's zone from <see cref="ZonesOfLocationsAsync"/>: its place's, else the organisation's.</summary>
    public static TimeZoneInfo ZoneOf(Shift shift, IReadOnlyDictionary<Guid, TimeZoneInfo> byLocation, TimeZoneInfo orgZone) => ZoneOf(shift.ServiceLocationId, byLocation, orgZone);

    public static TimeZoneInfo ZoneOf(Guid? locationId, IReadOnlyDictionary<Guid, TimeZoneInfo> byLocation, TimeZoneInfo orgZone) =>
        locationId is { } id && byLocation.TryGetValue(id, out var zone) ? zone : orgZone;

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
