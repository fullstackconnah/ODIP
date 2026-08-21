using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.Rostering;

public class ShiftPatternExpanderTests
{
    private static ShiftPattern Pattern(
        DayOfWeek dayOfWeek,
        DateOnly effectiveFrom,
        DateOnly? effectiveTo = null,
        bool isActive = true) => new()
    {
        Id = Guid.NewGuid(),
        TenantId = Guid.NewGuid(),
        ParticipantId = Guid.NewGuid(),
        DayOfWeek = dayOfWeek,
        StartTime = new TimeOnly(9, 0),
        EndTime = new TimeOnly(17, 0),
        EffectiveFrom = effectiveFrom,
        EffectiveTo = effectiveTo,
        IsActive = isActive,
    };

    [Fact]
    public void Inactive_pattern_yields_no_occurrences()
    {
        var pattern = Pattern(DayOfWeek.Wednesday, new DateOnly(2026, 8, 1), isActive: false);

        var occurrences = new ShiftPatternExpander().Occurrences(
            pattern, new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 31));

        Assert.Empty(occurrences);
    }

    [Fact]
    public void Effective_to_is_respected_as_inclusive()
    {
        // Wednesdays in August 2026: 5, 12, 19, 26.
        var pattern = Pattern(
            DayOfWeek.Wednesday,
            effectiveFrom: new DateOnly(2026, 8, 1),
            effectiveTo: new DateOnly(2026, 8, 19));

        var occurrences = new ShiftPatternExpander().Occurrences(
            pattern, new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 31));

        Assert.Contains(new DateOnly(2026, 8, 19), occurrences); // on the boundary - included
        Assert.DoesNotContain(new DateOnly(2026, 8, 26), occurrences); // past the boundary - excluded
    }

    [Fact]
    public void A_range_shorter_than_a_week_yields_at_most_one_occurrence()
    {
        var pattern = Pattern(DayOfWeek.Wednesday, new DateOnly(2026, 1, 1));

        // Monday 24th to Wednesday 26th August 2026 - three days, contains exactly one Wednesday.
        var containingRange = new ShiftPatternExpander().Occurrences(
            pattern, new DateOnly(2026, 8, 24), new DateOnly(2026, 8, 26));
        Assert.Single(containingRange);
        Assert.Equal(new DateOnly(2026, 8, 26), containingRange[0]);

        // Monday 24th to Tuesday 25th August 2026 - two days, contains no Wednesday.
        var emptyRange = new ShiftPatternExpander().Occurrences(
            pattern, new DateOnly(2026, 8, 24), new DateOnly(2026, 8, 25));
        Assert.Empty(emptyRange);
    }

    [Fact]
    public void Every_returned_date_matches_the_patterns_day_of_week()
    {
        var pattern = Pattern(DayOfWeek.Friday, new DateOnly(2026, 1, 1));

        var occurrences = new ShiftPatternExpander().Occurrences(
            pattern, new DateOnly(2026, 8, 1), new DateOnly(2026, 9, 30));

        Assert.NotEmpty(occurrences);
        Assert.All(occurrences, d => Assert.Equal(DayOfWeek.Friday, d.DayOfWeek));
    }
}
