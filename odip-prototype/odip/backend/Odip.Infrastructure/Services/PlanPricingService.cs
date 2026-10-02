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
        List<HolidayCoverage>? coverage = priceable ? await LoadCoverageAsync(from, to, ct) : null;
        DateOnly? overridesThrough = priceable ? await LoadOverridesThroughAsync(ct) : null;

        return PlanPricingEngine.Quote(new PlanQuoteRequest
        {
            Blocks = blocks, PeriodFrom = from, PeriodTo = to, Policy = policy, Catalogue = catalogue, Holidays = holidays,
            HolidayCoverage = coverage, HolidayOverridesThrough = overridesThrough,
        });
    }

    /// <summary>
    /// Every row whose window touches the period or the day after it, active or not: an import end-dates a superseded row and its window still prices the
    /// dates inside it. The day after is loaded because an occurrence that starts on the last day can run into it (a Monday 22:00 to Tuesday 02:00 support has a
    /// part on the Tuesday), and a price change that starts that day must be there to price it. The holidays are loaded to the same day.
    /// </summary>
    private Task<List<SupportCatalogueItem>> LoadCatalogueAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var last = to.AddDays(1);
        return _db.SupportCatalogueItems.AsNoTracking()
            .Where(item => item.EffectiveFrom <= last && (item.EffectiveTo == null || item.EffectiveTo >= from))
            .ToListAsync(ct);
    }

    /// <summary>
    /// The (state, year) pairs the synced calendar has any row for, over the years the period reaches (and the day after it), so the engine can say when a year
    /// has none: the feed syncs this year and the next only, and a period that runs past it would otherwise price every holiday as an ordinary day.
    /// </summary>
    private async Task<List<HolidayCoverage>> LoadCoverageAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var first = new DateOnly(from.Year, 1, 1);
        var last = new DateOnly(to.AddDays(1).Year, 12, 31);
        var rows = await _db.PublicHolidays.AsNoTracking()
            .Where(h => h.Date >= first && h.Date <= last)
            .Select(h => new { h.Date, h.State })
            .Distinct()
            .ToListAsync(ct);
        return rows.Select(r => new HolidayCoverage(r.State, r.Date.Year)).Distinct().ToList();
    }

    /// <summary>The date of the last override row, or <see cref="DateOnly.MinValue"/> when there are none.</summary>
    private async Task<DateOnly> LoadOverridesThroughAsync(CancellationToken ct) =>
        await _db.PublicHolidayOverrides.AsNoTracking().MaxAsync(o => (DateOnly?)o.Date, ct) ?? DateOnly.MinValue;

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
