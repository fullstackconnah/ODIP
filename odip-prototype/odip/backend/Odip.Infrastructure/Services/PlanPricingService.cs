using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Loads what the pure pricing engine needs (the tenant's settings, the catalogue rows that can price the period, and the delivery states' public
/// holidays: the synced rows and the override rows together) and runs it. Nothing here prices anything and nothing is written.
/// </summary>
public sealed class PlanPricingService
{
    public const string FeedSource = "Nager.Date feed";

    private readonly OdipDbContext _db;

    public PlanPricingService(OdipDbContext db) => _db = db;

    /// <summary>The tenant's settings row, or null when it has stored none (the engine then prices with the defaults). Always keyed on the tenant: a SuperAdmin's context sees every tenant's rows.</summary>
    public Task<PlanPricingSettings?> FindSettingsAsync(Guid tenantId, CancellationToken ct = default) =>
        _db.PlanPricingSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);

    public async Task<PlanQuote> QuoteAsync(Guid tenantId, IReadOnlyList<PlanBlock> blocks, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(blocks);

        var policy = PlanPricingPolicy.From(await FindSettingsAsync(tenantId, ct));

        // A period the engine will refuse loads nothing: it answers with the reason.
        var priceable = to >= from && to.DayNumber - from.DayNumber + 1 <= PlanPricingEngine.MaxPeriodDays;
        var catalogue = priceable ? await LoadCatalogueAsync(from, to, ct) : new List<SupportCatalogueItem>();
        var holidays = priceable ? await LoadHolidaysAsync(blocks, from, to, ct) : new List<HolidayEntry>();

        return PlanPricingEngine.Quote(new PlanQuoteRequest
        {
            Blocks = blocks, PeriodFrom = from, PeriodTo = to, Policy = policy, Catalogue = catalogue, Holidays = holidays,
        });
    }

    /// <summary>Every row whose window touches the period, active or not: an import end-dates a superseded row and its window still prices the dates inside it.</summary>
    private Task<List<SupportCatalogueItem>> LoadCatalogueAsync(DateOnly from, DateOnly to, CancellationToken ct) =>
        _db.SupportCatalogueItems.AsNoTracking()
            .Where(item => item.EffectiveFrom <= to && (item.EffectiveTo == null || item.EffectiveTo >= from))
            .ToListAsync(ct);

    /// <summary>
    /// The public holidays of the blocks' delivery states for the period and the day after it (an occurrence on the last day can end the next day): the
    /// synced rows first, then the override rows (NDIS-CODES 5.3), both as one list. National rows (no state) are for every state.
    /// </summary>
    private async Task<List<HolidayEntry>> LoadHolidaysAsync(IReadOnlyList<PlanBlock> blocks, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var last = to.AddDays(1);
        var states = blocks.Select(b => b?.Location?.State?.Trim().ToUpperInvariant()).Where(s => !string.IsNullOrEmpty(s)).Distinct().Cast<string>().ToList();

        var feed = await _db.PublicHolidays.AsNoTracking()
            .Where(h => h.Date >= from && h.Date <= last && (h.State == null || states.Contains(h.State)))
            .ToListAsync(ct);
        var overrides = await _db.PublicHolidayOverrides.AsNoTracking()
            .Where(h => h.Date >= from && h.Date <= last && (h.State == null || states.Contains(h.State)))
            .ToListAsync(ct);

        return feed.Select(h => new HolidayEntry(h.Date, h.State, h.Name, null, null, FeedSource))
            .Concat(overrides.Select(o => new HolidayEntry(o.Date, o.State, o.Name, o.StartTime, o.EndTime, o.Source)))
            .ToList();
    }
}
