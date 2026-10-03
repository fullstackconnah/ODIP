using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

/// <summary>
/// The public holiday overrides the migration inserts: the gaps NDIS-CODES section 5.3 found between the Nager.Date feed (what the app syncs) and
/// the Fair Work Ombudsman lists on 2 October 2026, for the 2026-27 financial year. They are inserted once with fixed ids; after that the table is the
/// owner's to maintain (the migration never rewrites a row). Not seeded: the Tasmanian area-limited days (Royal Hobart Show, Recreation Day, Royal
/// Hobart Regatta, Easter Tuesday for the public service), because they apply to areas and the table has no area; NDIS-CODES 11.3 question 8.
///
/// Every row has its own LITERAL id. Never derive an id from the position of a row in this list: <c>HasData</c> rewrites the row it knows by id, so a row
/// inserted mid-list would renumber the rows after it and the next migration would overwrite rows the owner has edited since. A new row gets a new
/// literal id and can go anywhere in the list; an existing row's id never changes.
/// </summary>
public static class PublicHolidayOverrideSeed
{
    private const string Source = "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026";

    public static IReadOnlyList<PublicHolidayOverride> All { get; } = new[]
    {
        // Boxing Day, Saturday 26 December 2026.
        Row("5eed0000-0000-4000-8000-000000000001", 2026, 12, 26, "ACT", "Boxing Day"),
        Row("5eed0000-0000-4000-8000-000000000002", 2026, 12, 26, "NSW", "Boxing Day"),
        Row("5eed0000-0000-4000-8000-000000000003", 2026, 12, 26, "NT", "Boxing Day"),
        Row("5eed0000-0000-4000-8000-000000000004", 2026, 12, 26, "QLD", "Boxing Day"),
        Row("5eed0000-0000-4000-8000-000000000005", 2026, 12, 26, "VIC", "Boxing Day"),
        Row("5eed0000-0000-4000-8000-000000000006", 2026, 12, 26, "WA", "Boxing Day"),
        Row("5eed0000-0000-4000-8000-000000000007", 2026, 12, 26, "SA", "Proclamation Day holiday"),

        // Anzac Day, Sunday 25 April 2027 (ACT also has an extra holiday that day).
        Row("5eed0000-0000-4000-8000-000000000008", 2027, 4, 25, "ACT", "Extra public holiday for Anzac Day"),
        Row("5eed0000-0000-4000-8000-000000000009", 2027, 4, 25, "NSW", "Anzac Day"),
        Row("5eed0000-0000-4000-8000-000000000010", 2027, 4, 25, "WA", "Anzac Day"),

        // Part-day holidays: the public holiday rate applies inside the declared hours, to midnight.
        Row("5eed0000-0000-4000-8000-000000000011", 2026, 12, 24, "NT", "Christmas Eve", new TimeOnly(19, 0)),
        Row("5eed0000-0000-4000-8000-000000000012", 2026, 12, 31, "NT", "New Year's Eve", new TimeOnly(19, 0)),
        Row("5eed0000-0000-4000-8000-000000000013", 2026, 12, 24, "QLD", "Christmas Eve", new TimeOnly(18, 0)),
        Row("5eed0000-0000-4000-8000-000000000014", 2026, 12, 24, "SA", "Christmas Eve", new TimeOnly(19, 0)),
        Row("5eed0000-0000-4000-8000-000000000015", 2026, 12, 31, "SA", "New Year's Eve", new TimeOnly(19, 0)),
    };

    private static PublicHolidayOverride Row(string id, int year, int month, int day, string state, string name, TimeOnly? from = null) => new()
    {
        Id = new Guid(id), Date = new DateOnly(year, month, day), State = state, Name = name, StartTime = from, EndTime = null, Source = Source,
    };
}
