using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>AvailableDays.For: the whole days a person marked Available or Preferred and no leave or unavailability touches (staff picker's "Available that day").</summary>
public class AvailableDaysTests
{
    private static readonly Guid Sam = Guid.NewGuid();
    private static readonly DateOnly Mon = new(2026, 8, 24);   // a Monday

    private static DateTime At(DateOnly d, int h = 0, int m = 0, int s = 0) => d.ToDateTime(new TimeOnly(h, m, s));
    private static StaffAvailability Row(AvailabilityType type, DateTime start, DateTime end) =>
        new() { Id = Guid.NewGuid(), UserId = Sam, AvailabilityType = type, StartDateTime = start, EndDateTime = end };
    private static StaffAvailability WholeDays(AvailabilityType type, DateOnly from, DateOnly to) => Row(type, At(from), At(to, 23, 59, 59));
    private static UnavailabilityWindow Window(UnavailabilityKind kind, DateTime start, DateTime end) => new(Sam, start, end, kind);

    private static IReadOnlyList<StaffAvailableDay> Run(StaffAvailability[] rows, UnavailabilityWindow[]? windows = null, int days = 7) =>
        AvailableDays.For(rows, windows ?? [], Mon, Mon.AddDays(days - 1));

    [Fact]
    public void AnAvailableRow_GivesEveryDayItCoversWhole()
    {
        var result = Run([WholeDays(AvailabilityType.Available, Mon, Mon.AddDays(2))]);
        Assert.Equal(new[] { Mon, Mon.AddDays(1), Mon.AddDays(2) }, result.Select(d => d.Date));
        Assert.All(result, d => Assert.False(d.Preferred));
    }

    [Fact]
    public void APreferredRow_MakesItsDayPreferred()
    {
        var tue = Mon.AddDays(1);
        var result = Run([WholeDays(AvailabilityType.Available, Mon, Mon.AddDays(2)), WholeDays(AvailabilityType.Preferred, tue, tue)]);
        Assert.Equal(new[] { false, true, false }, result.Select(d => d.Preferred));
    }

    [Fact]
    public void AnyUnavailabilityWindow_DropsTheDay()
    {
        var tue = Mon.AddDays(1); var wed = Mon.AddDays(2);
        var result = Run(
            [WholeDays(AvailabilityType.Available, Mon, wed)],
            [Window(UnavailabilityKind.RecurringRule, At(tue, 9), At(tue, 12)), Window(UnavailabilityKind.PendingLeave, At(wed), At(wed.AddDays(1)))]);
        Assert.Equal(new[] { Mon }, result.Select(d => d.Date));
    }

    [Fact]
    public void APartDayRow_GivesNothing() =>
        Assert.Empty(Run([Row(AvailabilityType.Available, At(Mon, 9), At(Mon, 17))]));

    [Theory]
    [InlineData(AvailabilityType.Tentative)]
    [InlineData(AvailabilityType.Unavailable)]
    public void OtherTypes_GiveNothing(AvailabilityType type) =>
        Assert.Empty(Run([WholeDays(type, Mon, Mon.AddDays(6))]));

    [Fact]
    public void ARowRunningPastSunday_GivesEightDays_WhenTheEdgeDayIsAsked()
    {
        var result = Run([WholeDays(AvailabilityType.Available, Mon, Mon.AddDays(7))], days: 8);
        Assert.Equal(8, result.Count);
    }

    [Fact]
    public void LeaveEndingSunday_DoesNotDropMonday()
    {
        var sun = Mon.AddDays(6); var nextMon = Mon.AddDays(7);
        var result = Run([WholeDays(AvailabilityType.Available, sun, nextMon)], [Window(UnavailabilityKind.ApprovedLeave, At(sun), At(nextMon))], days: 8);
        Assert.Equal(new[] { nextMon }, result.Select(d => d.Date));
    }
}
