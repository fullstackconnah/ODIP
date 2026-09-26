using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Billing;

public class ShiftRateCalculatorTests
{
    private static readonly Guid GroupId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly ShiftRateTimeBands Bands = new(new TimeOnly(6, 0), new TimeOnly(12, 0), new TimeOnly(20, 0));
    private readonly ShiftRateCalculator _calculator = new();

    [Fact]
    public void Calculate_WeekdayAmPmBoundary_SplitsAndPreservesDecimalProvenance()
    {
        var keyAm = new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Am);
        var keyPm = new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Pm);
        var request = Request(new DateTime(2026, 8, 24, 11, 30, 0), new DateTime(2026, 8, 24, 12, 30, 0),
            Rows((keyAm, "AM", 10.25m, "v-am"), (keyPm, "PM", 20.50m, "v-pm")),
            Map(keyAm, "AM", keyPm, "PM"));

        var quote = _calculator.Calculate(request);

        Assert.Equal(2, quote.Segments.Count);
        Assert.Equal(ShiftTimeBand.Am, quote.Segments[0].TimeBand);
        Assert.Equal("AM", quote.Segments[0].SupportItemCode);
        Assert.Equal("v-am", quote.Segments[0].CatalogueVersion);
        Assert.Equal(0.5m, quote.Segments[0].Hours);
        Assert.Equal(ShiftTimeBand.Pm, quote.Segments[1].TimeBand);
        Assert.Equal(15.375m, quote.TotalAmount);
    }

    [Fact]
    public void Calculate_Overnight_SplitsAtEveningMidnightAndAmBoundaries()
    {
        var keys = new[]
        {
            new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Pm),
            new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Evening),
            new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Night),
            new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Am)
        };
        var request = Request(new DateTime(2026, 8, 24, 19, 0, 0), new DateTime(2026, 8, 25, 7, 0, 0),
            Rows((keys[0], "PM", 10m, "v1"), (keys[1], "EVE", 10m, "v1"),
                 (keys[2], "NIGHT", 10m, "v1"), (keys[3], "AM", 10m, "v1")),
            Map(keys[0], "PM", keys[1], "EVE", keys[2], "NIGHT", keys[3], "AM"));

        var quote = _calculator.Calculate(request);

        Assert.Equal(4, quote.Segments.Count);
        Assert.Equal(new[] { ShiftTimeBand.Pm, ShiftTimeBand.Evening, ShiftTimeBand.Night, ShiftTimeBand.Am },
            quote.Segments.Select(s => s.TimeBand));
        Assert.Equal(new DateOnly(2026, 8, 24), quote.Segments[0].ServiceDate);
        Assert.Equal(new DateOnly(2026, 8, 25), quote.Segments[2].ServiceDate);
        Assert.Equal(12m, quote.Segments.Sum(s => s.Hours));
        Assert.Equal(120m, quote.TotalAmount);
    }

    [Theory]
    [InlineData(2026, 8, 29, ClaimDayType.Saturday)]
    [InlineData(2026, 8, 30, ClaimDayType.Sunday)]
    public void Calculate_Weekend_UsesItsExplicitDayTypeMapping(int year, int month, int day, ClaimDayType expectedDayType)
    {
        var key = new ShiftRateBandKey(expectedDayType, ShiftTimeBand.Am);
        var request = Request(new DateTime(year, month, day, 7, 0, 0), new DateTime(year, month, day, 8, 0, 0),
            Rows((key, expectedDayType.ToString(), 15m, "weekend-v")), Map(key, expectedDayType.ToString()));

        var quote = _calculator.Calculate(request);

        Assert.Single(quote.Segments);
        Assert.Equal(expectedDayType, quote.Segments[0].DayType);
    }

    [Fact]
    public void Calculate_PublicHoliday_TakesPrecedenceOverWeekend()
    {
        var holiday = new DateOnly(2026, 8, 29);
        var key = new ShiftRateBandKey(ClaimDayType.PublicHoliday, ShiftTimeBand.Am);
        var request = Request(new DateTime(2026, 8, 29, 7, 0, 0), new DateTime(2026, 8, 29, 8, 0, 0),
            Rows((key, "HOL", 30m, "holiday-v")), Map(key, "HOL"), holidays: new HashSet<DateOnly> { holiday });

        var quote = _calculator.Calculate(request);

        Assert.Equal(ClaimDayType.PublicHoliday, quote.Segments.Single().DayType);
    }

    [Fact]
    public void Calculate_EffectiveDateBoundary_UsesTheRowEffectiveForEachSegmentDate()
    {
        var nightKey = new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Night);
        var eveningKey = new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Evening);
        var rows = new[]
        {
            Row(nightKey, "NIGHT", 10m, "old", new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 24)),
            Row(nightKey, "NIGHT", 20m, "new", new DateOnly(2026, 8, 25), null)
        };
        var request = Request(new DateTime(2026, 8, 24, 23, 0, 0), new DateTime(2026, 8, 25, 1, 0, 0), rows,
            Map(eveningKey, "NIGHT", nightKey, "NIGHT"));

        var quote = _calculator.Calculate(request);

        Assert.Equal(new[] { "old", "new" }, quote.Segments.Select(s => s.CatalogueVersion));
        Assert.Equal(30m, quote.TotalAmount);
    }

    [Fact]
    public void Calculate_FailsClosedForAmbiguousMissingAndExpiredCatalogueRows()
    {
        var key = new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Am);
        var start = new DateTime(2026, 8, 24, 7, 0, 0);
        var end = start.AddHours(1);

        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(Request(start, end,
            Rows((key, "CODE", 10m, "a"), (key, "CODE", 11m, "b")), Map(key, "CODE"))));
        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(Request(start, end,
            Array.Empty<SupportCatalogueItem>(), Map(key, "CODE"))));
        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(Request(start, end,
            new[] { Row(key, "CODE", 10m, "expired", new DateOnly(2026, 1, 1), new DateOnly(2026, 8, 23)) }, Map(key, "CODE"))));
    }

    [Fact]
    public void Calculate_FailsClosedForInvalidIntervalStateMappingBoundariesAndUnavailableRate()
    {
        var key = new ShiftRateBandKey(ClaimDayType.Weekday, ShiftTimeBand.Am);
        var start = new DateTime(2026, 8, 24, 7, 0, 0);
        var rows = Rows((key, "CODE", 10m, "v1"));

        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(Request(start, start, rows, Map(key, "CODE"))));
        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(Request(start.AddHours(1), start, rows, Map(key, "CODE"))));
        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(Request(start, start.AddHours(1), rows, Map(key, "CODE"), state: "XX")));
        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(Request(start, start.AddHours(1), rows,
            new Dictionary<ShiftRateBandKey, SupportItemMapping> { [key] = new(GroupId, " ") })));
        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(new ShiftRateRequest(
            start, start.AddHours(1), "VIC", new HashSet<DateOnly>(), null, Map(key, "CODE"), rows)));
        Assert.Throws<ShiftRateCalculationException>(() => _calculator.Calculate(Request(start, start.AddHours(1),
            Rows((key, "CODE", 0m, "zero")), Map(key, "CODE"))));
    }

    private static ShiftRateRequest Request(DateTime start, DateTime end, IReadOnlyCollection<SupportCatalogueItem> rows,
        IReadOnlyDictionary<ShiftRateBandKey, SupportItemMapping> mappings, string state = "VIC",
        IReadOnlySet<DateOnly>? holidays = null, ShiftRateTimeBands? bands = null) =>
        new(start, end, state, holidays ?? new HashSet<DateOnly>(), bands ?? Bands, mappings, rows);

    private static IReadOnlyDictionary<ShiftRateBandKey, SupportItemMapping> Map(params object[] values)
    {
        var result = new Dictionary<ShiftRateBandKey, SupportItemMapping>();
        for (var index = 0; index < values.Length; index += 2)
            result[(ShiftRateBandKey)values[index]] = new SupportItemMapping(GroupId, (string)values[index + 1]);
        return result;
    }

    private static IReadOnlyCollection<SupportCatalogueItem> Rows(params (ShiftRateBandKey Key, string Code, decimal Rate, string Version)[] rows) =>
        rows.Select(row => Row(row.Key, row.Code, row.Rate, row.Version, new DateOnly(2026, 1, 1), null)).ToList();

    private static SupportCatalogueItem Row(ShiftRateBandKey key, string code, decimal rate, string version, DateOnly from, DateOnly? to) =>
        new()
        {
            Id = Guid.NewGuid(),
            ActivityGroupId = GroupId,
            ItemNumber = code,
            DayType = key.DayType,
            CatalogueVersion = version,
            EffectiveFrom = from,
            EffectiveTo = to,
            IsActive = true,
            PriceLimit_VIC = rate
        };
}
