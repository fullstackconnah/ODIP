using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

/// <summary>
/// The public holiday overrides the migration inserts: the gaps NDIS-CODES section 5.3 found between the Nager.Date feed (what the app syncs) and
/// the Fair Work Ombudsman lists on 2 October 2026, for the 2026-27 financial year. They are inserted once with fixed ids; after that the table is the
/// owner's to maintain (the migration never rewrites a row). Not seeded: the Tasmanian area-limited days (Royal Hobart Show, Recreation Day, Royal
/// Hobart Regatta, Easter Tuesday for the public service), because they apply to areas and the table has no area; NDIS-CODES 11.3 question 8.
/// </summary>
public static class PublicHolidayOverrideSeed
{
    private const string Source = "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026";

    public static IReadOnlyList<PublicHolidayOverride> All { get; } = Build();

    private static List<PublicHolidayOverride> Build()
    {
        var rows = new List<PublicHolidayOverride>();
        var n = 0;

        void Add(int year, int month, int day, string state, string name, TimeOnly? from = null) => rows.Add(new PublicHolidayOverride
        {
            Id = new Guid($"5eed0000-0000-4000-8000-{++n:D12}"), Date = new DateOnly(year, month, day), State = state, Name = name, StartTime = from, EndTime = null, Source = Source,
        });

        // Boxing Day, Saturday 26 December 2026.
        foreach (var state in new[] { "ACT", "NSW", "NT", "QLD", "VIC", "WA" }) Add(2026, 12, 26, state, "Boxing Day");
        Add(2026, 12, 26, "SA", "Proclamation Day holiday");

        // Anzac Day, Sunday 25 April 2027 (ACT also has an extra holiday that day).
        Add(2027, 4, 25, "ACT", "Extra public holiday for Anzac Day");
        Add(2027, 4, 25, "NSW", "Anzac Day");
        Add(2027, 4, 25, "WA", "Anzac Day");

        // Part-day holidays: the public holiday rate applies inside the declared hours, to midnight.
        Add(2026, 12, 24, "NT", "Christmas Eve", new TimeOnly(19, 0));
        Add(2026, 12, 31, "NT", "New Year's Eve", new TimeOnly(19, 0));
        Add(2026, 12, 24, "QLD", "Christmas Eve", new TimeOnly(18, 0));
        Add(2026, 12, 24, "SA", "Christmas Eve", new TimeOnly(19, 0));
        Add(2026, 12, 31, "SA", "New Year's Eve", new TimeOnly(19, 0));

        return rows;
    }
}
