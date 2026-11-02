using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>The fixed Monday fortnights the casual-hours warning counts in (R6): counted from Monday 5 January 2026.</summary>
public class RosterFortnightTests
{
    private static readonly DateOnly Anchor = new(2026, 1, 5);

    [Fact]
    public void The_anchor_day_and_the_13_days_after_it_share_a_fortnight()
    {
        Assert.Equal(Anchor, RosterFortnight.StartOf(Anchor));
        Assert.Equal(Anchor, RosterFortnight.StartOf(Anchor.AddDays(13)));
        Assert.Equal(Anchor.AddDays(13), RosterFortnight.EndOf(Anchor));
    }

    [Fact]
    public void The_day_14_days_on_starts_the_next_fortnight()
    {
        Assert.Equal(Anchor.AddDays(14), RosterFortnight.StartOf(Anchor.AddDays(14)));
    }

    [Fact]
    public void A_date_before_the_anchor_floors_into_the_previous_fortnight()
    {
        Assert.Equal(Anchor.AddDays(-14), RosterFortnight.StartOf(Anchor.AddDays(-1)));
        Assert.Equal(Anchor.AddDays(-1), RosterFortnight.EndOf(Anchor.AddDays(-1)));
    }

    [Fact]
    public void Monday_2_November_2026_is_in_the_fortnight_26_October_to_8_November()
    {
        Assert.Equal(new DateOnly(2026, 10, 26), RosterFortnight.StartOf(new DateOnly(2026, 11, 2)));
        Assert.Equal(new DateOnly(2026, 11, 8), RosterFortnight.EndOf(new DateOnly(2026, 11, 2)));
    }
}
