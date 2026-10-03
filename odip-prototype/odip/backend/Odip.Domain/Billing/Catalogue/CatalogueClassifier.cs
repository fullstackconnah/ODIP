using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Catalogue;

/// <summary>What a catalogue item prices. <see cref="DayType"/> is null for items that are not banded by day (sleepover, accommodation nights, travel, transport, centre capital, everything else).</summary>
public sealed record CatalogueClassification(SupportFamily Family, SupportIntensity? Intensity, ClaimDayType? DayType)
{
    public static CatalogueClassification Other { get; } = new(SupportFamily.Other, null, null);

    /// <summary>High intensity and ICBS items: the flag the claim screens have always called IsIntensive.</summary>
    public bool IsIntensive => Intensity is SupportIntensity.HighIntensity or SupportIntensity.Icbs;
}

/// <summary>
/// The code classification map: item code prefix plus registration group to (family, intensity, day type). It is a table, not a heuristic:
/// nothing here reads an item's name, and a sequence is never read without its registration group, because the same digits mean
/// different days in different groups (<c>04_102</c> is Public Holiday in RG 0125 and Weekday Daytime in RG 0136).
/// The table is NDIS-CODES section 11.1, laid out in its column order, plus the five ICBS community access items (04_450..454 in RG 0125)
/// that the importer has always kept in the community access group. Anything not named is <see cref="SupportFamily.Other"/>, so a new
/// catalogue never moves an item into a family by accident. Tested row by row (CatalogueClassifierTests) and against the real file.
/// </summary>
public static class CatalogueClassifier
{
    private static readonly Dictionary<string, CatalogueClassification> Map = BuildMap();

    /// <summary>The "CC_SSS_RRRR" keys the map names (category, sequence, registration group).</summary>
    public static IReadOnlyCollection<string> ClassifiedKeys => Map.Keys;

    /// <summary>
    /// Classifies an item by the category and sequence of its code and its registration group. <paramref name="registrationGroup"/> is the file's
    /// registration group column when the caller has it (it is what the provider must be registered for, and it wins over the third part of the
    /// code); otherwise the code's own third part is used.
    /// </summary>
    public static CatalogueClassification Classify(string? itemNumber, string? registrationGroup = null)
    {
        if (string.IsNullOrWhiteSpace(itemNumber)) return CatalogueClassification.Other;
        var parts = itemNumber.Trim().Split('_');
        if (parts.Length < 3) return CatalogueClassification.Other;
        var group = string.IsNullOrWhiteSpace(registrationGroup) ? parts[2] : registrationGroup.Trim();
        return Map.TryGetValue($"{parts[0]}_{parts[1]}_{group}", out var classification) ? classification : CatalogueClassification.Other;
    }

    /// <summary>
    /// The map read the other way: the "CC_SSS_RRRR" keys filed under this family, intensity and day type (a null intensity or day type matches
    /// the entries that have none), optionally only those of one registration group, in a stable order. The pricing engine asks for what it needs
    /// ("community access, standard, Saturday") and finds the catalogue rows by these keys, so the codes are never repeated outside this table.
    /// Empty when the map names no such item: the Weekday Night band of community access and group activities, for one.
    /// </summary>
    public static IReadOnlyList<string> KeysFor(SupportFamily family, SupportIntensity? intensity, ClaimDayType? dayType, string? registrationGroup = null) =>
        Map.Where(entry => entry.Value.Family == family
                           && entry.Value.Intensity == intensity
                           && entry.Value.DayType == dayType
                           && (registrationGroup is null || entry.Key.EndsWith("_" + registrationGroup, StringComparison.Ordinal)))
            .Select(entry => entry.Key)
            .OrderBy(key => key, StringComparer.Ordinal)
            .ToList();

    private static Dictionary<string, CatalogueClassification> BuildMap()
    {
        var map = new Dictionary<string, CatalogueClassification>(StringComparer.Ordinal);

        // A banded support type, its codes in the 11.1 column order: Weekday Daytime, Weekday Evening, Weekday Night, Saturday, Sunday,
        // Public Holiday. null = the table has "-" (no such item exists in that registration group).
        void Banded(SupportFamily family, SupportIntensity intensity, string registrationGroup,
            string? weekday, string? evening, string? night, string? saturday, string? sunday, string? publicHoliday)
        {
            Add(weekday, ClaimDayType.Weekday);
            Add(evening, ClaimDayType.WeekdayEvening);
            Add(night, ClaimDayType.WeekdayNight);
            Add(saturday, ClaimDayType.Saturday);
            Add(sunday, ClaimDayType.Sunday);
            Add(publicHoliday, ClaimDayType.PublicHoliday);

            void Add(string? sequence, ClaimDayType day)
            {
                if (sequence is not null) map.Add($"{sequence}_{registrationGroup}", new CatalogueClassification(family, intensity, day));
            }
        }

        // An item with no day band: sleepover (Each), accommodation (Day), $1-unit companions, centre capital.
        void Single(SupportFamily family, SupportIntensity? intensity, string registrationGroup, params string[] sequences)
        {
            foreach (var sequence in sequences)
                map.Add($"{sequence}_{registrationGroup}", new CatalogueClassification(family, intensity, null));
        }

        const SupportIntensity std = SupportIntensity.Standard, high = SupportIntensity.HighIntensity, icbs = SupportIntensity.Icbs;

        // PersonalCare: standard (RG 0107) + sleepover 01_010, high intensity (RG 0104).
        Banded(SupportFamily.PersonalCare, std, "0107", "01_011", "01_015", "01_002", "01_013", "01_014", "01_012");
        Single(SupportFamily.Sleepover, std, "0107", "01_010");
        Banded(SupportFamily.PersonalCare, high, "0104", "01_400", "01_401", "01_405", "01_402", "01_403", "01_404");

        // CommunityAccess: standard (RG 0125), ICBS (RG 0125, the items the importer has always kept), high intensity (RG 0104). No night item exists.
        Banded(SupportFamily.CommunityAccess, std, "0125", "04_104", "04_103", null, "04_105", "04_106", "04_102");
        Banded(SupportFamily.CommunityAccess, icbs, "0125", "04_450", "04_451", null, "04_452", "04_453", "04_454");
        Banded(SupportFamily.CommunityAccess, high, "0104", "04_400", "04_401", null, "04_402", "04_403", "04_404");

        // GroupActivity: standard (RG 0136) and high intensity (RG 0104). The sequences differ from RG 0125 for the same days.
        Banded(SupportFamily.GroupActivity, std, "0136", "04_102", "04_103", null, "04_104", "04_105", "04_106");
        Banded(SupportFamily.GroupActivity, high, "0104", "04_600", "04_601", null, "04_602", "04_603", "04_604");

        // StaSupport (RG 0115) + sleepover 01_206; STA accommodation nights.
        Banded(SupportFamily.StaSupport, std, "0115", "01_200", "01_201", "01_205", "01_202", "01_203", "01_204");
        Single(SupportFamily.Sleepover, std, "0115", "01_206");
        Banded(SupportFamily.StaSupport, high, "0115", "01_252", "01_253", "01_254", "01_255", "01_256", "01_257");
        Single(SupportFamily.StaAccommodation, null, "0115", "01_250", "01_251");

        // Companions: provider travel non-labour, activity-based transport, centre capital cost.
        Single(SupportFamily.ProviderTravel, null, "0107", "01_799");
        Single(SupportFamily.ProviderTravel, null, "0104", "01_799", "04_799");
        Single(SupportFamily.ProviderTravel, null, "0115", "01_799");
        Single(SupportFamily.ProviderTravel, null, "0125", "04_799");
        Single(SupportFamily.ProviderTravel, null, "0136", "04_799");
        Single(SupportFamily.ActivityBasedTransport, null, "0125", "04_590");
        Single(SupportFamily.ActivityBasedTransport, null, "0136", "04_591");
        Single(SupportFamily.ActivityBasedTransport, null, "0104", "04_592");
        Single(SupportFamily.CentreCapital, null, "0136", "04_599");
        Single(SupportFamily.CentreCapital, null, "0104", "04_599");

        return map;
    }
}
