using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>Behaviour support plan due dates and state: interim 1 month, comprehensive 6 months after first use; due soon inside 7 days; the due date itself is not overdue.</summary>
public class BspTimelineTests
{
    [Theory]
    [InlineData("2026-01-15", "2026-02-15", "2026-07-15")]
    [InlineData("2026-08-31", "2026-09-30", "2027-02-28")]
    [InlineData("2026-01-31", "2026-02-28", "2026-07-31")]
    public void DueDates(string first, string interim, string comprehensive)
    {
        var f = DateOnly.Parse(first);
        Assert.Equal(DateOnly.Parse(interim), BspTimeline.InterimDue(f));
        Assert.Equal(DateOnly.Parse(comprehensive), BspTimeline.ComprehensiveDue(f));
    }

    [Theory]
    [InlineData("2026-10-30", BspPlanState.Due)]
    [InlineData("2026-10-31", BspPlanState.DueSoon)]
    [InlineData("2026-11-07", BspPlanState.DueSoon)]
    [InlineData("2026-11-08", BspPlanState.Overdue)]
    public void State_FollowsTheDueDate(string today, BspPlanState expected) =>
        Assert.Equal(expected, BspTimeline.State(new DateOnly(2026, 11, 7), null, DateOnly.Parse(today)));

    [Fact]
    public void State_InPlaceWhenRecorded_AtAnyDate() =>
        Assert.Equal(BspPlanState.InPlace, BspTimeline.State(new DateOnly(2026, 11, 7), new DateOnly(2026, 11, 1), new DateOnly(2027, 5, 1)));

    [Fact]
    public void State_NotStartedWithoutDue() => Assert.Equal(BspPlanState.NotStarted, BspTimeline.State(null, null, new DateOnly(2026, 11, 7)));

    // The interim plan counts as in place when either plan date is recorded (a comprehensive plan supersedes it).
    [Fact]
    public void Interim_InPlace_WhenOnlyComprehensiveRecorded() =>
        Assert.Equal(BspPlanState.InPlace, BspTimeline.InterimState(new DateOnly(2026, 11, 7), null, new DateOnly(2026, 12, 1), new DateOnly(2026, 11, 20)));
}
