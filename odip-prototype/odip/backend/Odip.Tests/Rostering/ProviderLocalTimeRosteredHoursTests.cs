using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// A shift's rostered hours are its real elapsed length in the provider's zone: a 10pm to 6am shift is 9h on the night daylight saving ends
/// and 7h on the night it starts (the wall clock says 8h both times), matching what payroll and billing already count.
/// </summary>
public class ProviderLocalTimeRosteredHoursTests
{
    private static readonly TimeZoneInfo Sydney = ProviderLocalTime.ResolveZone("Australia/Sydney");
    private static readonly TimeZoneInfo Brisbane = ProviderLocalTime.ResolveZone("Australia/Brisbane");

    private static Shift Night(DateOnly date) => new()
    {
        ServiceDate = date,
        StartTime = new TimeOnly(22, 0),
        EndTime = new TimeOnly(6, 0),
        EndsNextDay = true,
    };

    [Fact]
    public void TheNightDaylightSavingEnds_AnOvernightShiftIsNineHours()
    {
        var shift = Night(new DateOnly(2027, 4, 3));

        Assert.Equal(9m, ProviderLocalTime.RosteredHours(shift, Sydney));
        Assert.Equal(8m, shift.DurationHours); // wall-clock stays for the bare-time rules
    }

    [Fact]
    public void TheNightDaylightSavingStarts_AnOvernightShiftIsSevenHours() =>
        Assert.Equal(7m, ProviderLocalTime.RosteredHours(Night(new DateOnly(2027, 10, 2)), Sydney));

    [Fact]
    public void AZoneWithNoDaylightSaving_KeepsEightHoursOnTheSameNight() =>
        Assert.Equal(8m, ProviderLocalTime.RosteredHours(Night(new DateOnly(2027, 4, 3)), Brisbane));

    [Fact]
    public void AnOrdinaryNightAndASameDayShift_EqualDurationHoursExactly()
    {
        var ordinary = Night(new DateOnly(2027, 5, 14));
        var sameDay = new Shift { ServiceDate = new DateOnly(2027, 4, 3), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 15), EndsNextDay = false };

        Assert.Equal(ordinary.DurationHours, ProviderLocalTime.RosteredHours(ordinary, Sydney));
        Assert.Equal(sameDay.DurationHours, ProviderLocalTime.RosteredHours(sameDay, Sydney));
    }

    private static Shift SameDay(DateOnly date, TimeOnly start, TimeOnly end) => new() { ServiceDate = date, StartTime = start, EndTime = end, EndsNextDay = false };

    [Theory]
    [InlineData(2, 30, 3, 0, 0)]   // starts inside the skipped hour: never negative
    [InlineData(2, 0, 3, 0, 0)]    // that hour does not exist
    [InlineData(2, 30, 4, 0, 0.5)] // 03:30 to 04:00, as before
    public void TheSpringForwardGap_NeverGivesANegativeLength(int sh, int sm, int eh, int em, double expected)
    {
        var shift = SameDay(new DateOnly(2027, 10, 3), new TimeOnly(sh, sm), new TimeOnly(eh, em));

        Assert.Equal((decimal)expected, ProviderLocalTime.RosteredHours(shift, Sydney));
    }

    [Fact]
    public void AZoneWithNoDaylightSaving_KeepsThirtyMinutesInTheSameWindow() =>
        Assert.Equal(0.5m, ProviderLocalTime.RosteredHours(SameDay(new DateOnly(2027, 10, 3), new TimeOnly(2, 30), new TimeOnly(3, 0)), Brisbane));
}
