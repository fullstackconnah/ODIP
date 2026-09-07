using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.Leave;

public class RecurringUnavailabilityExpanderTests
{
    private static RecurringUnavailability Rule(
        DayOfWeek dayOfWeek, DateOnly effectiveFrom, DateOnly? effectiveTo = null) => new()
    {
        Id = Guid.NewGuid(), UserId = Guid.NewGuid(), DayOfWeek = dayOfWeek,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
        EffectiveFrom = effectiveFrom, EffectiveTo = effectiveTo,
    };

    [Fact]
    public void Matches_every_occurrence_of_the_weekday_in_range()
    {
        var rule = Rule(DayOfWeek.Wednesday, new DateOnly(2026, 9, 1));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Equal(
            new[] { new DateOnly(2026, 9, 2), new DateOnly(2026, 9, 9), new DateOnly(2026, 9, 16), new DateOnly(2026, 9, 23), new DateOnly(2026, 9, 30) },
            occurrences);
    }

    [Fact]
    public void Clips_to_effective_from_when_the_range_starts_earlier()
    {
        var rule = Rule(DayOfWeek.Monday, new DateOnly(2026, 9, 14));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Equal(new[] { new DateOnly(2026, 9, 14), new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 28) }, occurrences);
    }

    [Fact]
    public void Clips_to_effective_to_when_set()
    {
        var rule = Rule(DayOfWeek.Friday, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 18));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Equal(new[] { new DateOnly(2026, 9, 4), new DateOnly(2026, 9, 11), new DateOnly(2026, 9, 18) }, occurrences);
    }

    [Fact]
    public void Open_ended_effective_to_does_not_clip()
    {
        var rule = Rule(DayOfWeek.Tuesday, new DateOnly(2026, 1, 1), effectiveTo: null);
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Equal(new[] { new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 8), new DateOnly(2026, 9, 15), new DateOnly(2026, 9, 22), new DateOnly(2026, 9, 29) }, occurrences);
    }

    [Fact]
    public void Range_entirely_before_effective_from_returns_nothing()
    {
        var rule = Rule(DayOfWeek.Monday, new DateOnly(2026, 10, 1));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Empty(occurrences);
    }

    [Fact]
    public void Range_entirely_after_effective_to_returns_nothing()
    {
        var rule = Rule(DayOfWeek.Monday, new DateOnly(2026, 1, 1), new DateOnly(2026, 8, 1));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        Assert.Empty(occurrences);
    }

    [Fact]
    public void From_after_to_returns_nothing()
    {
        var rule = Rule(DayOfWeek.Monday, new DateOnly(2026, 1, 1));
        var occurrences = new RecurringUnavailabilityExpander()
            .Occurrences(rule, new DateOnly(2026, 9, 30), new DateOnly(2026, 9, 1));

        Assert.Empty(occurrences);
    }
}
