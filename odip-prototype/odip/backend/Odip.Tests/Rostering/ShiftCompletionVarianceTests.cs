using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>Variance calc against rostered times (design spec §3), incl. an EndsNextDay
/// sleepover shift crossing midnight, and the state→timezone map.</summary>
public class ShiftCompletionVarianceTests
{
    [Fact]
    public void ResolveRosteredTimesUtc_SimpleDayShift_ConvertsSydneyLocalToUtc()
    {
        var shift = new Shift
        {
            ServiceDate = new DateOnly(2026, 9, 8), // AEST (no DST — starts 4 Oct 2026)
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
        };

        var (start, end) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, "Australia/Sydney");

        Assert.Equal(new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), start);
        Assert.Equal(new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc), end);
    }

    [Fact]
    public void ResolveRosteredTimesUtc_SleepoverShiftEndsNextDay_RollsEndDateForward()
    {
        var shift = new Shift
        {
            ServiceDate = new DateOnly(2026, 9, 8),
            StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0), EndsNextDay = true,
        };

        var (start, end) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, "Australia/Sydney");

        Assert.Equal(new DateTime(2026, 9, 8, 12, 0, 0, DateTimeKind.Utc), start); // 22:00 AEST 8 Sep
        Assert.Equal(new DateTime(2026, 9, 8, 20, 0, 0, DateTimeKind.Utc), end);   // 06:00 AEST 9 Sep
    }

    [Fact]
    public void ResolveRosteredTimesUtc_SpringForwardGap_DoesNotThrow()
    {
        // Sydney DST starts 2026-10-04 02:00 -> 03:00 local (spring forward); a sleepover shift
        // whose rostered end falls at 02:30 local on that date lands inside the skipped hour.
        var shift = new Shift
        {
            ServiceDate = new DateOnly(2026, 10, 3),
            StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(2, 30), EndsNextDay = true,
        };

        var (_, end) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, "Australia/Sydney");

        Assert.Equal(new DateTime(2026, 10, 3, 16, 30, 0, DateTimeKind.Utc), end); // 03:30 AEDT
    }

    [Fact]
    public void ResolveRosteredTimesUtc_UnknownTimeZoneId_FallsBackToSydney()
    {
        var shift = new Shift
        {
            ServiceDate = new DateOnly(2026, 9, 8),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
        };

        var (start, end) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, "Not/A/Real/Zone");

        Assert.Equal(new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), start);
        Assert.Equal(new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc), end);
    }

    [Fact]
    public void VarianceMinutes_ActualLaterThanRostered_ReturnsPositiveMinutes()
    {
        var rostered = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc);
        Assert.Equal(12, ShiftVarianceCalculator.VarianceMinutes(rostered.AddMinutes(12), rostered));
    }

    [Fact]
    public void VarianceMinutes_ActualEarlierThanRostered_ReturnsNegativeMinutes()
    {
        var rostered = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc);
        Assert.Equal(-5, ShiftVarianceCalculator.VarianceMinutes(rostered.AddMinutes(-5), rostered));
    }

    [Theory]
    [InlineData("VIC", "Australia/Sydney")]
    [InlineData("NSW", "Australia/Sydney")]
    [InlineData("ACT", "Australia/Sydney")]
    [InlineData("TAS", "Australia/Sydney")]
    [InlineData("QLD", "Australia/Brisbane")]
    [InlineData("SA", "Australia/Adelaide")]
    [InlineData("WA", "Australia/Perth")]
    [InlineData("NT", "Australia/Darwin")]
    [InlineData(null, "Australia/Sydney")]
    [InlineData("XX", "Australia/Sydney")]
    public void Resolve_MapsEveryAustralianStateAndFallsBackForUnknown(string? state, string expectedZone)
    {
        Assert.Equal(expectedZone, StateTimeZoneMap.Resolve(state));
    }
}
