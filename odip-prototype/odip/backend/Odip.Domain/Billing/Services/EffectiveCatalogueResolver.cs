using System.Globalization;
using System.Linq.Expressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Services;

/// <summary>The date-effective rules for picking a catalogue row: which rows are valid on a service date, and the one price a lookup returns.</summary>
public static class EffectiveCatalogueResolver
{
    /// <summary>
    /// Whether a catalogue row prices a service on <paramref name="date"/>: the date is inside the row's own window (EffectiveFrom to EffectiveTo, open-ended when
    /// EffectiveTo is null, both days included), and the row has not been withdrawn by hand. IsActive is not "valid today": an import end-dates the rows a
    /// newer catalogue supersedes and marks them inactive, yet each is still the right row for the service dates inside its window, and a service that
    /// happened before a December price set must keep the price of its own date. So an inactive row is valid when it has an end date (history), and
    /// is valid on no date when it is both inactive and open-ended (an import always end-dates what it deactivates, so only a hand edit leaves that).
    /// This is the one definition of "valid on a date": the lookup, both claim engines and the agreement draft use it, as a method here and as
    /// <see cref="ValidOn"/> inside a database query.
    /// </summary>
    public static bool IsValidOn(SupportCatalogueItem item, DateOnly date) =>
        item.EffectiveFrom <= date
        && (!item.EffectiveTo.HasValue || item.EffectiveTo.Value >= date)
        && (item.IsActive || item.EffectiveTo.HasValue);

    /// <summary><see cref="IsValidOn"/> as an expression, for a query that must filter in the database (a unit test pins that the two agree).</summary>
    public static Expression<Func<SupportCatalogueItem, bool>> ValidOn(DateOnly date) =>
        item => item.EffectiveFrom <= date
            && (item.EffectiveTo == null || item.EffectiveTo >= date)
            && (item.IsActive || item.EffectiveTo != null);

    /// <summary>
    /// The row a claim engine prices a service from, by day type and intensity rather than by code: among the rows of <paramref name="groupItems"/> valid on
    /// <paramref name="serviceDate"/> (<see cref="IsValidOn"/>), the exact match for the day type and intensity, else any row of the day type (an intensive
    /// participant with no intensive item is priced from the standard one, as the engines always did). Null when no row is valid that day: the caller leaves
    /// the line out, as it always did for a day type the catalogue lacks, rather than price it from a row that did not apply. If two rows are valid (old
    /// imports could leave a one-day overlap) the newer version wins, so the choice never depends on row order.
    /// </summary>
    public static SupportCatalogueItem? FindForDay(IEnumerable<SupportCatalogueItem> groupItems, ClaimDayType dayType, bool isIntensive, DateOnly serviceDate)
    {
        ArgumentNullException.ThrowIfNull(groupItems);
        var valid = groupItems.Where(i => i.DayType == dayType && IsValidOn(i, serviceDate)).ToList();
        return Newest(valid.Where(i => i.IsIntensive == isIntensive)) ?? Newest(valid);

        static SupportCatalogueItem? Newest(IEnumerable<SupportCatalogueItem> rows) =>
            rows.OrderByDescending(i => i.EffectiveFrom).ThenByDescending(i => i.IsActive)
                .ThenBy(i => i.ItemNumber, StringComparer.Ordinal).ThenBy(i => i.Id).FirstOrDefault();
    }

    /// <summary>
    /// Of the rows valid on one date for one item, those that tie for the newest version (the latest EffectiveFrom): a single row is the answer, two or more
    /// start on the same day and cannot be told apart (a catalogue inserted twice), which is what "ambiguous" means. An older row that is still valid beside a
    /// newer one is shadowed by it, exactly as <see cref="FindForDay"/> treats it: the previous importer end-dated a superseded row on the day it started its
    /// replacement, so that one day sits in both windows, and an old open-ended row can be left behind. The lookup and the agreement draft both decide with this.
    /// </summary>
    public static IReadOnlyList<SupportCatalogueItem> NewestVersion(IReadOnlyCollection<SupportCatalogueItem> validRows)
    {
        ArgumentNullException.ThrowIfNull(validRows);
        if (validRows.Count < 2) return validRows.ToList();
        var newest = validRows.Max(r => r.EffectiveFrom);
        return validRows.Where(r => r.EffectiveFrom == newest).ToList();
    }

    /// <summary>
    /// The date-effective lookup: the single catalogue row for <paramref name="itemCode"/> that is valid on <paramref name="serviceDate"/> (see
    /// <see cref="IsValidOn"/>; on a day two versions overlap, the newer one, see <see cref="NewestVersion"/>), and its price for <paramref name="zone"/>, or a
    /// typed failure (none, ambiguous, zone not eligible, not priced). The code is matched exactly, registration group included, because the same digits
    /// mean different items in different groups. Pure: callers load the rows (see <c>FindCatalogueItemAsync</c> for the database path).
    /// </summary>
    public static CatalogueLookupResult Find(IEnumerable<SupportCatalogueItem> catalogueItems, string itemCode, DateOnly serviceDate, PriceZone zone)
    {
        ArgumentNullException.ThrowIfNull(catalogueItems);
        var code = itemCode?.Trim() ?? string.Empty;
        var date = serviceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        var matches = code.Length == 0
            ? new List<SupportCatalogueItem>()
            : NewestVersion(catalogueItems.Where(item => string.Equals(item.ItemNumber, code, StringComparison.Ordinal) && IsValidOn(item, serviceDate)).ToList()).ToList();

        if (matches.Count == 0)
            return CatalogueLookupResult.Fail(CatalogueLookupFailure.NotFound, null, $"No catalogue row for '{code}' is valid on {date}.");
        if (matches.Count > 1)
            return CatalogueLookupResult.Fail(CatalogueLookupFailure.Ambiguous, null,
                $"{matches.Count.ToString(CultureInfo.InvariantCulture)} catalogue rows for '{code}' start on the same day and are valid on {date}: the catalogue holds duplicates of this version.");

        var item = matches[0];
        if (item.PriceNational is null)
            return CatalogueLookupResult.Fail(CatalogueLookupFailure.NotPriced, item, $"'{code}' has no price limit on {date} (a quotable item, or a row with no National price).");

        var price = zone switch
        {
            PriceZone.National => item.PriceNational,
            PriceZone.Remote => item.PriceRemote,
            PriceZone.VeryRemote => item.PriceVeryRemote,
            _ => throw new ArgumentOutOfRangeException(nameof(zone), zone, "Unknown price zone.")
        };
        return price is null
            ? CatalogueLookupResult.Fail(CatalogueLookupFailure.ZoneNotEligible, item, $"'{code}' lists no {zone} price on {date}, so it is not eligible for that loading.")
            : CatalogueLookupResult.Success(item, price.Value);
    }
}

/// <summary>Why <see cref="EffectiveCatalogueResolver.Find"/> returned no price.</summary>
public enum CatalogueLookupFailure
{
    /// <summary>No row for the code is valid on the service date (an unknown code, a date before the first catalogue, or after the last row ended).</summary>
    NotFound = 0,
    /// <summary>Two or more rows for the code start on the same day and are valid on the service date: one version inserted twice, which the next import heals. An older version overlapping a newer one is not ambiguous: the newer wins.</summary>
    Ambiguous = 1,
    /// <summary>One row is valid but lists no price for the zone: the item is not eligible for Remote / Very Remote loading.</summary>
    ZoneNotEligible = 2,
    /// <summary>One row is valid but has no National price: a quotable item (claimable only if a stated plan item), or a row written before zone prices existed.</summary>
    NotPriced = 3
}

/// <summary>The outcome of a date-effective lookup. <see cref="Item"/> is set whenever exactly one row was valid, including the two price failures; <see cref="Price"/> only on success.</summary>
public sealed record CatalogueLookupResult
{
    public SupportCatalogueItem? Item { get; init; }
    public decimal? Price { get; init; }
    public CatalogueLookupFailure? Failure { get; init; }
    public string? Message { get; init; }

    public bool Found => Failure is null;

    internal static CatalogueLookupResult Success(SupportCatalogueItem item, decimal price) => new() { Item = item, Price = price };
    internal static CatalogueLookupResult Fail(CatalogueLookupFailure failure, SupportCatalogueItem? item, string message) => new() { Failure = failure, Item = item, Message = message };
}
