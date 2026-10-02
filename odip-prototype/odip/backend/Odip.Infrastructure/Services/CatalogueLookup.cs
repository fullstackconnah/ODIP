using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Services;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public static class CatalogueLookupExtensions
{
    /// <summary>
    /// The date-effective lookup against the database: the single catalogue row for <paramref name="itemCode"/> valid on <paramref name="serviceDate"/>
    /// and its <paramref name="zone"/> price, or a typed failure. Only the rows whose window holds the date are loaded; the decision is
    /// <see cref="EffectiveCatalogueResolver.Find"/>'s, so the pure and the database path cannot disagree.
    /// </summary>
    public static async Task<CatalogueLookupResult> FindCatalogueItemAsync(
        this OdipDbContext db, string itemCode, DateOnly serviceDate, PriceZone zone, CancellationToken ct = default)
    {
        var code = (itemCode ?? string.Empty).Trim();
        var rows = await db.SupportCatalogueItems.AsNoTracking()
            .Where(i => i.ItemNumber == code)
            .Where(EffectiveCatalogueResolver.ValidOn(serviceDate))
            .ToListAsync(ct);
        return EffectiveCatalogueResolver.Find(rows, code, serviceDate, zone);
    }
}
