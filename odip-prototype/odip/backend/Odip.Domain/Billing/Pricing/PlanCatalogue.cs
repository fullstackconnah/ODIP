using System.Collections.Concurrent;
using System.Globalization;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Pricing;

/// <summary>What the engine needs from the catalogue: a family, an intensity, a day band and the registration group the family sits in, never an item code.</summary>
/// <param name="CategoryPrefix">The first part of the item code ("01" or "04"), only where one registration group holds the same kind of item in two categories (provider travel costs in RG 0104).</param>
/// <param name="Sequence">The second part of the item code ("250" or "251"), only where the classification gives two items the same family (STA participant and support worker accommodation).</param>
public sealed record ItemNeed(SupportFamily Family, SupportIntensity? Intensity, ClaimDayType? DayType, string RegistrationGroup, string? CategoryPrefix = null, string? Sequence = null)
{
    /// <summary>The family in words ("community access", "sleepover"), for messages.</summary>
    public string FamilyName => Family switch
    {
        SupportFamily.PersonalCare => "personal care",
        SupportFamily.CommunityAccess => "community access",
        SupportFamily.GroupActivity => "group activities",
        SupportFamily.StaSupport => "short-term accommodation support",
        SupportFamily.StaAccommodation => "short-term accommodation nights",
        SupportFamily.Sleepover => "sleepover",
        SupportFamily.ProviderTravel => "provider travel costs",
        SupportFamily.ActivityBasedTransport => "activity-based transport",
        SupportFamily.CentreCapital => "centre capital cost",
        _ => "other"
    };

    public string Describe()
    {
        var intensity = Intensity switch
        {
            SupportIntensity.HighIntensity => " high intensity",
            SupportIntensity.Icbs => " ICBS",
            SupportIntensity.Standard => " standard",
            _ => string.Empty
        };
        var band = DayType switch
        {
            ClaimDayType.Weekday => " Weekday Daytime",
            ClaimDayType.WeekdayEvening => " Weekday Evening",
            ClaimDayType.WeekdayNight => " Weekday Night",
            ClaimDayType.Saturday => " Saturday",
            ClaimDayType.Sunday => " Sunday",
            ClaimDayType.PublicHoliday => " Public Holiday",
            _ => string.Empty
        };
        return $"{FamilyName}{intensity}{band} (registration group {RegistrationGroup})";
    }
}

/// <summary>The catalogue row that prices a need on a service date and its price for the zone, or the typed reason there is none.</summary>
public sealed record ItemChoice
{
    public SupportCatalogueItem? Row { get; init; }
    public decimal Price { get; init; }
    public PlanFailureReason? Failure { get; init; }
    public string? Message { get; init; }
    public bool Found => Failure is null && Row is not null;

    internal static ItemChoice Fail(PlanFailureReason reason, string message, SupportCatalogueItem? row = null) => new() { Failure = reason, Message = message, Row = row };
}

/// <summary>
/// A snapshot of catalogue rows indexed for the pricing engine. Selection is the phase A classifier plus the phase A date-effective lookup: the
/// classifier says which code keys file under a family, intensity and day band (the map is the only place codes live), the rows of those keys that
/// are valid on the service date say which code is meant, and <see cref="EffectiveCatalogueResolver.Find"/> returns its price for the zone or a
/// typed failure. Nothing here is a price or a code, and the rows are never changed.
/// </summary>
public sealed class PlanCatalogue
{
    private readonly Dictionary<string, List<SupportCatalogueItem>> _byKey = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<SupportCatalogueItem>> _byCode = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<ItemNeed, List<string>> _keys = new();

    public PlanCatalogue(IEnumerable<SupportCatalogueItem> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        foreach (var row in rows)
        {
            if (string.IsNullOrWhiteSpace(row.ItemNumber)) continue;
            var code = row.ItemNumber.Trim();
            (_byCode.TryGetValue(code, out var sameCode) ? sameCode : _byCode[code] = new List<SupportCatalogueItem>()).Add(row);
            if (KeyOf(row) is { } key)
                (_byKey.TryGetValue(key, out var sameKey) ? sameKey : _byKey[key] = new List<SupportCatalogueItem>()).Add(row);
        }
    }

    /// <summary>The "CC_SSS_RRRR" key of a row, as the classifier reads it: the registration group column wins over the third part of the code.</summary>
    internal static string? KeyOf(SupportCatalogueItem row)
    {
        var parts = row.ItemNumber.Trim().Split('_');
        if (parts.Length < 3) return null;
        var group = string.IsNullOrWhiteSpace(row.RegistrationGroup) ? parts[2] : row.RegistrationGroup.Trim();
        return $"{parts[0]}_{parts[1]}_{group}";
    }

    /// <summary>The row and price for a need on a service date and zone, or why there is none.</summary>
    public ItemChoice Find(ItemNeed need, DateOnly serviceDate, PriceZone zone)
    {
        ArgumentNullException.ThrowIfNull(need);
        var date = serviceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        var keys = _keys.GetOrAdd(need, n => CatalogueClassifier.KeysFor(n.Family, n.Intensity, n.DayType, n.RegistrationGroup)
            .Where(key => n.CategoryPrefix is null || key.StartsWith(n.CategoryPrefix + "_", StringComparison.Ordinal))
            .Where(key => n.Sequence is null || key.Split('_')[1] == n.Sequence)
            .ToList());
        if (keys.Count == 0)
            return ItemChoice.Fail(PlanFailureReason.NoItem, $"The catalogue has no item for {need.Describe()}.");

        var valid = keys.Where(_byKey.ContainsKey)
            .SelectMany(key => _byKey[key])
            .Where(row => EffectiveCatalogueResolver.IsValidOn(row, serviceDate))
            .ToList();
        if (valid.Count == 0)
            return ItemChoice.Fail(PlanFailureReason.CatalogueNotFound, $"No catalogue row for {need.Describe()} is valid on {date}. Import the catalogue for that period.");

        var codes = EffectiveCatalogueResolver.NewestVersion(valid).Select(row => row.ItemNumber.Trim()).Distinct(StringComparer.Ordinal).OrderBy(c => c, StringComparer.Ordinal).ToList();
        if (codes.Count > 1)
            return ItemChoice.Fail(PlanFailureReason.CatalogueAmbiguous, $"{codes.Count.ToString(CultureInfo.InvariantCulture)} different catalogue items ({string.Join(", ", codes)}) are valid on {date} for {need.Describe()}.");

        var code = codes[0];
        var found = EffectiveCatalogueResolver.Find(_byCode[code], code, serviceDate, zone);
        if (found.Found)
            return new ItemChoice { Row = found.Item, Price = found.Price!.Value };

        var reason = found.Failure switch
        {
            CatalogueLookupFailure.Ambiguous => PlanFailureReason.CatalogueAmbiguous,
            CatalogueLookupFailure.ZoneNotEligible => PlanFailureReason.ZoneNotEligible,
            CatalogueLookupFailure.NotPriced => PlanFailureReason.CatalogueNotPriced,
            _ => PlanFailureReason.CatalogueNotFound,
        };
        return ItemChoice.Fail(reason, found.Message ?? $"No price for {code} on {date}.", found.Item);
    }
}
