using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Pricing;

/// <summary>
/// One public holiday for the engine: the synced feed's rows and the maintained override rows both arrive as these. <see cref="State"/> null is a
/// national holiday. A whole-day holiday has no times. A part-day holiday (NDIS-CODES 5.3: SA and NT 19:00 on Christmas Eve and New Year's Eve,
/// QLD 18:00 on Christmas Eve) has a start and an end; the end is exclusive and a missing end means midnight, a missing start the start of the day.
/// </summary>
public sealed record HolidayEntry(DateOnly Date, string? State, string Name, TimeOnly? From = null, TimeOnly? To = null, string Source = "")
{
    public bool IsWholeDay => From is null && To is null;
}

/// <summary>A (state, year) the synced holiday calendar has rows for: <see cref="State"/> null covers every state.</summary>
public sealed record HolidayCoverage(string? State, int Year);

/// <summary>The holidays of every state for a quote. <see cref="On"/> answers for one delivery state on one date.</summary>
public sealed class HolidayCalendar
{
    /// <summary>The eight state and territory codes a holiday row, a delivery location and a catalogue price column use. A holiday with no state is national.</summary>
    public static readonly IReadOnlyList<string> StateCodes = new[] { "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA" };

    private readonly Dictionary<DateOnly, List<HolidayEntry>> _byDate;

    public HolidayCalendar(IEnumerable<HolidayEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        _byDate = entries
            .GroupBy(e => e.Date)
            .ToDictionary(g => g.Key, g => g
                .OrderBy(e => e.From ?? TimeOnly.MinValue)
                .ThenBy(e => e.To ?? TimeOnly.MaxValue)
                .ThenBy(e => e.Name, StringComparer.Ordinal)
                .ThenBy(e => e.Source, StringComparer.Ordinal)
                .ThenBy(e => e.State, StringComparer.Ordinal)
                .ToList());
    }

    /// <summary>The entries that apply in <paramref name="state"/> on <paramref name="date"/>: the national ones and that state's own, in a stable order. The state is matched in any case.</summary>
    public IReadOnlyList<HolidayEntry> On(DateOnly date, string state)
    {
        if (!_byDate.TryGetValue(date, out var entries)) return Array.Empty<HolidayEntry>();
        var wanted = (state ?? string.Empty).Trim();
        return entries.Where(e => e.State is null || string.Equals(e.State.Trim(), wanted, StringComparison.OrdinalIgnoreCase)).ToList();
    }
}

/// <summary>A stretch of one calendar day that is priced as one band: minutes from midnight (the end is exclusive, 1440 is midnight) and the day type the catalogue prices it as.</summary>
public sealed record DaySpan(int FromMinute, int ToMinute, ClaimDayType DayType, string Band, HolidayEntry? Holiday)
{
    public bool IsHoliday => Holiday is not null;
    public int Minutes => ToMinute - FromMinute;
}

/// <summary>
/// The day bands of NDIS-CODES 5.1. A weekday splits at 06:00 and 20:00 (night, daytime, evening); Saturday, Sunday and a public holiday are one
/// band for the whole calendar day. A public holiday beats the day of the week; a part-day holiday is a public holiday band only inside its hours
/// and the ordinary bands of the day continue around it.
/// </summary>
public static class DayBands
{
    public const string WeekdayNight = "Weekday Night";
    public const string WeekdayDaytime = "Weekday Daytime";
    public const string WeekdayEvening = "Weekday Evening";
    public const string Saturday = "Saturday";
    public const string Sunday = "Sunday";
    public const string PublicHoliday = "Public Holiday";

    private const int Day = 1440, Six = 360, Eight = 1200;

    public static IReadOnlyList<DaySpan> For(DateOnly date, IReadOnlyList<HolidayEntry> holidaysOnDate)
    {
        ArgumentNullException.ThrowIfNull(holidaysOnDate);

        var whole = holidaysOnDate.FirstOrDefault(h => h.IsWholeDay);
        if (whole is not null) return new[] { new DaySpan(0, Day, ClaimDayType.PublicHoliday, PublicHoliday, whole) };

        var ordinary = Ordinary(date.DayOfWeek);
        var part = holidaysOnDate
            .Where(h => !h.IsWholeDay)
            .Select(h => (Entry: h, From: Minute(h.From) ?? 0, To: EndMinute(h)))
            .Where(h => h.To > h.From)
            .OrderBy(h => h.From).ThenBy(h => h.To).ThenBy(h => h.Entry.Name, StringComparer.Ordinal)
            .ToList();
        if (part.Count == 0) return ordinary;

        var cuts = new SortedSet<int>(ordinary.SelectMany(s => new[] { s.FromMinute, s.ToMinute })
            .Concat(part.SelectMany(h => new[] { h.From, h.To })));
        var spans = new List<DaySpan>();
        var cutList = cuts.ToList();
        for (var i = 0; i + 1 < cutList.Count; i++)
        {
            int from = cutList[i], to = cutList[i + 1];
            var holiday = part.Where(h => h.From <= from && from < h.To).Select(h => h.Entry).FirstOrDefault();
            var piece = holiday is not null
                ? new DaySpan(from, to, ClaimDayType.PublicHoliday, PublicHoliday, holiday)
                : ordinary.First(s => s.FromMinute <= from && from < s.ToMinute) with { FromMinute = from, ToMinute = to };

            if (spans.Count > 0 && spans[^1].DayType == piece.DayType && ReferenceEquals(spans[^1].Holiday, piece.Holiday))
                spans[^1] = spans[^1] with { ToMinute = piece.ToMinute };
            else
                spans.Add(piece);
        }

        return spans;
    }

    private static IReadOnlyList<DaySpan> Ordinary(DayOfWeek day) => day switch
    {
        DayOfWeek.Saturday => new[] { new DaySpan(0, Day, ClaimDayType.Saturday, Saturday, null) },
        DayOfWeek.Sunday => new[] { new DaySpan(0, Day, ClaimDayType.Sunday, Sunday, null) },
        _ => new[]
        {
            new DaySpan(0, Six, ClaimDayType.WeekdayNight, WeekdayNight, null),
            new DaySpan(Six, Eight, ClaimDayType.Weekday, WeekdayDaytime, null),
            new DaySpan(Eight, Day, ClaimDayType.WeekdayEvening, WeekdayEvening, null),
        },
    };

    private static int? Minute(TimeOnly? time) => time is { } t ? t.Hour * 60 + t.Minute : null;

    /// <summary>The minute a part-day holiday ends (exclusive). No end is midnight, and so is an end of 00:00 on a row that has a start: a person typing "19:00 to 00:00" means the evening, and 00:00 is never after 19:00.</summary>
    private static int EndMinute(HolidayEntry holiday) => Minute(holiday.To) switch
    {
        null => Day,
        0 when holiday.From is not null => Day,
        var minute => minute.Value,
    };
}
