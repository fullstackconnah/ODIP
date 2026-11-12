using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>M1112: a trip day's start and finish on the roster bar, derived from its activities and the trip's departure and return.</summary>
public class TripDayTimesTests
{
    private static readonly DateOnly D1 = new(2026, 11, 9);
    private static readonly DateOnly D2 = new(2026, 11, 10);
    private static readonly DateOnly D3 = new(2026, 11, 11);

    private static TripInstance Trip(TimeOnly? dep = null, TimeOnly? ret = null) =>
        new() { StartDate = D1, DurationDays = 3, DepartureTime = dep, ReturnTime = ret };

    private static TripDayTimes.ActivityTime Act(DateOnly d, int? sh, int? eh, ScheduledActivityStatus st = ScheduledActivityStatus.Planned) =>
        new(d, sh is null ? null : new TimeOnly(sh.Value, 0), eh is null ? null : new TimeOnly(eh.Value, 0), st);

    private static List<TripDayTimes.Day> Run(TripInstance t, params TripDayTimes.ActivityTime[] a) => TripDayTimes.For(t, a, D1, D3);

    [Fact]
    public void Departure_counts_on_first_day_and_return_on_last()
    {
        var days = Run(Trip(new TimeOnly(7, 30), new TimeOnly(18, 0)), Act(D1, 9, 12), Act(D3, 10, 11));
        Assert.Equal(new TimeOnly(7, 30), days.Single(d => d.Date == D1).Start);
        Assert.Equal(new TimeOnly(12, 0), days.Single(d => d.Date == D1).Finish);
        Assert.Equal(new TimeOnly(10, 0), days.Single(d => d.Date == D3).Start);
        Assert.Equal(new TimeOnly(18, 0), days.Single(d => d.Date == D3).Finish);
    }

    [Fact]
    public void Departure_does_not_count_on_a_middle_day()
    {
        var days = Run(Trip(new TimeOnly(7, 30)), Act(D2, 9, 12));
        Assert.Equal(new TimeOnly(9, 0), days.Single(d => d.Date == D2).Start);
    }

    [Fact]
    public void Start_only_has_no_finish()
    {
        var d = Run(Trip(), Act(D2, 9, null)).Single();
        Assert.Equal(new TimeOnly(9, 0), d.Start);
        Assert.Null(d.Finish);
    }

    [Fact]
    public void Finish_only_has_no_start()
    {
        var d = Run(Trip(), Act(D2, null, 17)).Single();
        Assert.Null(d.Start);
        Assert.Equal(new TimeOnly(17, 0), d.Finish);
    }

    [Fact]
    public void Finish_before_start_drops_the_finish()
    {
        var d = Run(Trip(null, new TimeOnly(8, 0)), Act(D3, 9, null)).Single();
        Assert.Equal(new TimeOnly(9, 0), d.Start);
        Assert.Null(d.Finish);
    }

    [Fact]
    public void Cancelled_activity_is_ignored()
    {
        var days = Run(Trip(), Act(D2, 6, 23, ScheduledActivityStatus.Cancelled), Act(D2, 9, 12));
        var d = days.Single();
        Assert.Equal(new TimeOnly(9, 0), d.Start);
        Assert.Equal(new TimeOnly(12, 0), d.Finish);
    }

    [Fact]
    public void Day_with_no_times_has_no_entry_and_dates_outside_the_range_are_dropped()
    {
        var days = TripDayTimes.For(Trip(), new[] { Act(D1, null, null), Act(D2, 9, 10) }, D1, D1);
        Assert.Empty(days);
    }
}
