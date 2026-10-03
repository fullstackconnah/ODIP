using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// A delivery state's holiday calendar and the day bands it makes (NDIS-CODES 5.1 and 5.3). A weekday has three bands (night to 06:00,
/// daytime to 20:00, evening to midnight), Saturday and Sunday are one band each, and a public holiday is one band for the whole calendar day,
/// except a part-day holiday (SA and NT from 19:00 on Christmas Eve and New Year's Eve, QLD from 18:00 on Christmas Eve), which is a public
/// holiday band only inside its declared hours.
/// </summary>
public class HolidayCalendarTests
{
    private static readonly DateOnly Mon = new(2026, 10, 5), Sat = new(2026, 10, 10), Sun = new(2026, 10, 11), Thu = new(2026, 12, 24);

    private static HolidayEntry Day(DateOnly date, string? state, string name, string source = "Nager.Date feed") => new(date, state, name, null, null, source);

    private static HolidayEntry Part(DateOnly date, string state, string name, TimeOnly? from, TimeOnly? to) => new(date, state, name, from, to, "override");

    private static string Describe(IReadOnlyList<DaySpan> spans) => string.Join(" | ", spans.Select(s => $"{s.FromMinute / 60:00}:{s.FromMinute % 60:00}-{s.ToMinute / 60:00}:{s.ToMinute % 60:00} {s.Band}"));

    // ── The bands of an ordinary day ──────────────────────────────────────────────

    [Fact]
    public void A_weekday_has_a_night_a_daytime_and_an_evening_band()
    {
        var spans = DayBands.For(Mon, Array.Empty<HolidayEntry>());

        Assert.Equal("00:00-06:00 Weekday Night | 06:00-20:00 Weekday Daytime | 20:00-24:00 Weekday Evening", Describe(spans));
        Assert.Equal(new[] { ClaimDayType.WeekdayNight, ClaimDayType.Weekday, ClaimDayType.WeekdayEvening }, spans.Select(s => s.DayType));
        Assert.All(spans, s => Assert.False(s.IsHoliday));
    }

    [Theory]
    [InlineData(2026, 10, 10, "00:00-24:00 Saturday", ClaimDayType.Saturday)]
    [InlineData(2026, 10, 11, "00:00-24:00 Sunday", ClaimDayType.Sunday)]
    public void Saturday_and_Sunday_are_one_band_for_the_whole_day(int y, int m, int d, string expected, ClaimDayType dayType)
    {
        var spans = DayBands.For(new DateOnly(y, m, d), Array.Empty<HolidayEntry>());

        Assert.Equal(expected, Describe(spans));
        Assert.Equal(dayType, Assert.Single(spans).DayType);
    }

    [Theory]
    [InlineData(2026, 10, 5)]
    [InlineData(2026, 10, 6)]
    [InlineData(2026, 10, 9)]
    public void Every_weekday_from_Monday_to_Friday_has_the_same_three_bands(int y, int m, int d)
    {
        Assert.Equal("00:00-06:00 Weekday Night | 06:00-20:00 Weekday Daytime | 20:00-24:00 Weekday Evening", Describe(DayBands.For(new DateOnly(y, m, d), Array.Empty<HolidayEntry>())));
    }

    // ── A whole-day public holiday ────────────────────────────────────────────────

    [Fact]
    public void A_public_holiday_is_one_band_for_the_whole_day_and_beats_the_day_of_the_week()
    {
        var labour = Day(Mon, "NSW", "Labour Day");
        var onMonday = DayBands.For(Mon, new[] { labour });
        var onSaturday = DayBands.For(Sat, new[] { Day(Sat, null, "A holiday on a Saturday") });
        var onSunday = DayBands.For(Sun, new[] { Day(Sun, "QLD", "A holiday on a Sunday") });

        Assert.Equal("00:00-24:00 Public Holiday", Describe(onMonday));
        Assert.Same(labour, Assert.Single(onMonday).Holiday);
        Assert.True(Assert.Single(onMonday).IsHoliday);
        Assert.Equal(ClaimDayType.PublicHoliday, Assert.Single(onSaturday).DayType);
        Assert.Equal(ClaimDayType.PublicHoliday, Assert.Single(onSunday).DayType);
    }

    [Fact]
    public void A_whole_day_entry_beats_a_part_day_one_on_the_same_date()
    {
        var whole = Day(Thu, "NT", "Christmas Eve");
        var spans = DayBands.For(Thu, new[] { Part(Thu, "NT", "Christmas Eve (evening)", new TimeOnly(19, 0), null), whole });

        Assert.Equal("00:00-24:00 Public Holiday", Describe(spans));
        Assert.Same(whole, Assert.Single(spans).Holiday);
    }

    // ── A part-day public holiday ─────────────────────────────────────────────────

    [Fact]
    public void A_part_day_holiday_to_midnight_is_a_public_holiday_band_from_its_start_and_does_not_split_at_20_00()
    {
        var christmasEve = Part(Thu, "NT", "Christmas Eve", new TimeOnly(19, 0), null);

        var spans = DayBands.For(Thu, new[] { christmasEve });

        Assert.Equal("00:00-06:00 Weekday Night | 06:00-19:00 Weekday Daytime | 19:00-24:00 Public Holiday", Describe(spans));
        Assert.Same(christmasEve, spans[^1].Holiday);
    }

    [Fact]
    public void A_part_day_holiday_that_ends_at_00_00_runs_to_midnight_like_one_with_no_end()
    {
        // Review L1: a hand-added override row 19:00 to 00:00 (EndTime = 00:00:00) was dropped because 00:00 is not after 19:00, so the holiday rate never applied.
        var written = DayBands.For(Thu, new[] { Part(Thu, "NT", "Christmas Eve", new TimeOnly(19, 0), new TimeOnly(0, 0)) });
        var omitted = DayBands.For(Thu, new[] { Part(Thu, "NT", "Christmas Eve", new TimeOnly(19, 0), null) });

        Assert.Equal("00:00-06:00 Weekday Night | 06:00-19:00 Weekday Daytime | 19:00-24:00 Public Holiday", Describe(written));
        Assert.Equal(Describe(omitted), Describe(written));
    }

    [Fact]
    public void A_part_day_holiday_with_a_start_and_an_end_cuts_the_ordinary_bands_around_it()
    {
        var spans = DayBands.For(Mon, new[] { Part(Mon, "NSW", "Midday holiday", new TimeOnly(12, 0), new TimeOnly(14, 0)) });

        Assert.Equal("00:00-06:00 Weekday Night | 06:00-12:00 Weekday Daytime | 12:00-14:00 Public Holiday | 14:00-20:00 Weekday Daytime | 20:00-24:00 Weekday Evening", Describe(spans));
    }

    [Fact]
    public void A_part_day_holiday_from_the_start_of_the_day_runs_to_its_end_time()
    {
        var spans = DayBands.For(Mon, new[] { Part(Mon, "NSW", "Morning holiday", null, new TimeOnly(8, 0)) });

        Assert.Equal("00:00-08:00 Public Holiday | 08:00-20:00 Weekday Daytime | 20:00-24:00 Weekday Evening", Describe(spans));
    }

    [Fact]
    public void A_part_day_holiday_on_a_Saturday_keeps_the_Saturday_band_outside_its_hours()
    {
        var spans = DayBands.For(Sat, new[] { Part(Sat, "QLD", "Evening holiday", new TimeOnly(18, 0), null) });

        Assert.Equal("00:00-18:00 Saturday | 18:00-24:00 Public Holiday", Describe(spans));
    }

    [Fact]
    public void Two_part_day_holidays_on_one_date_both_apply()
    {
        var spans = DayBands.For(Mon, new[]
        {
            Part(Mon, "NSW", "Second", new TimeOnly(16, 0), new TimeOnly(17, 0)),
            Part(Mon, "NSW", "First", new TimeOnly(9, 0), new TimeOnly(10, 0)),
        });

        Assert.Equal("00:00-06:00 Weekday Night | 06:00-09:00 Weekday Daytime | 09:00-10:00 Public Holiday | 10:00-16:00 Weekday Daytime | 16:00-17:00 Public Holiday | 17:00-20:00 Weekday Daytime | 20:00-24:00 Weekday Evening", Describe(spans));
    }

    [Fact]
    public void The_bands_cover_the_whole_day_with_no_gap_and_no_overlap_whatever_the_holiday()
    {
        var holidays = new[]
        {
            Array.Empty<HolidayEntry>(),
            new[] { Day(Mon, "NSW", "x") },
            new[] { Part(Mon, "NSW", "x", new TimeOnly(5, 30), new TimeOnly(20, 30)) },
            new[] { Part(Mon, "NSW", "x", new TimeOnly(0, 0), new TimeOnly(0, 1)), Part(Mon, "NSW", "y", new TimeOnly(23, 59), null) },
        };

        foreach (var entries in holidays)
        foreach (var date in new[] { Mon, Sat, Sun })
        {
            var spans = DayBands.For(date, entries.Select(e => e with { Date = date }).ToList());
            Assert.Equal(0, spans[0].FromMinute);
            Assert.Equal(1440, spans[^1].ToMinute);
            for (var i = 1; i < spans.Count; i++) Assert.Equal(spans[i - 1].ToMinute, spans[i].FromMinute);
            Assert.All(spans, s => Assert.True(s.ToMinute > s.FromMinute));
        }
    }

    // ── The calendar of one state ─────────────────────────────────────────────────

    [Fact]
    public void The_calendar_returns_a_national_holiday_for_every_state_and_a_state_holiday_only_for_its_state()
    {
        var calendar = new HolidayCalendar(new[]
        {
            Day(new DateOnly(2026, 12, 25), null, "Christmas Day"),
            Day(Mon, "NSW", "Labour Day"),
        });

        Assert.Equal("Christmas Day", Assert.Single(calendar.On(new DateOnly(2026, 12, 25), "VIC")).Name);
        Assert.Equal("Labour Day", Assert.Single(calendar.On(Mon, "NSW")).Name);
        Assert.Empty(calendar.On(Mon, "VIC"));
        Assert.Empty(calendar.On(Mon.AddDays(1), "NSW"));
    }

    [Theory]
    [InlineData("nsw")]
    [InlineData("NSW")]
    [InlineData(" Nsw ")]
    public void The_state_is_matched_in_any_case_and_ignoring_spaces(string state)
    {
        var calendar = new HolidayCalendar(new[] { Day(Mon, "NSW", "Labour Day") });

        Assert.Single(calendar.On(Mon, state));
    }

    [Fact]
    public void A_feed_row_and_an_override_for_the_same_date_are_both_kept_in_a_stable_order()
    {
        var feed = Day(new DateOnly(2026, 12, 26), "NSW", "Boxing Day", "Nager.Date feed");
        var over = Day(new DateOnly(2026, 12, 26), "NSW", "Boxing Day", "override");

        var a = new HolidayCalendar(new[] { feed, over }).On(new DateOnly(2026, 12, 26), "NSW");
        var b = new HolidayCalendar(new[] { over, feed }).On(new DateOnly(2026, 12, 26), "NSW");

        Assert.Equal(2, a.Count);
        Assert.Equal(a, b);
    }

    [Fact]
    public void An_empty_calendar_has_no_holidays()
    {
        Assert.Empty(new HolidayCalendar(Array.Empty<HolidayEntry>()).On(Mon, "NSW"));
    }
}
