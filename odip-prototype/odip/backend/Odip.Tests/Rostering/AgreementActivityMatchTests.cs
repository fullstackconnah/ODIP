using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.Rostering;

public class AgreementActivityMatchTests
{
    private static AgreementBlock Block(DayOfWeek day, int startH, int endH, bool next = false) => new(day, new TimeOnly(startH, 0), new TimeOnly(endH, 0), next);
    private static string? Check(AgreementBlock[] blocks, DayOfWeek day, TimeOnly start, TimeOnly end, bool next = false) => AgreementActivityMatch.Check(blocks, day, start, end, next);
    private static TimeOnly T(int h, int m = 0) => new(h, m);

    [Fact] public void NoBlockThatWeekday_NoBlock() =>
        Assert.Equal(RosterConflictService.ActivityAgreementNoBlock, Check([Block(DayOfWeek.Tuesday, 9, 13)], DayOfWeek.Monday, T(10), T(12)));

    [Fact] public void InsideBlock_Match() => Assert.Null(Check([Block(DayOfWeek.Monday, 9, 13)], DayOfWeek.Monday, T(10), T(12)));

    [Fact] public void EqualToBlock_Match() => Assert.Null(Check([Block(DayOfWeek.Monday, 9, 13)], DayOfWeek.Monday, T(9), T(13)));

    [Fact] public void OneMinuteBeforeStart_Time() =>
        Assert.Equal(RosterConflictService.ActivityAgreementTime, Check([Block(DayOfWeek.Monday, 9, 13)], DayOfWeek.Monday, T(8, 59), T(12)));

    [Fact] public void OneMinuteAfterEnd_Time() =>
        Assert.Equal(RosterConflictService.ActivityAgreementTime, Check([Block(DayOfWeek.Monday, 9, 13)], DayOfWeek.Monday, T(10), T(13, 1)));

    [Fact] public void OvernightBlock_ActivityInsideEvening_Match() =>
        Assert.Null(Check([Block(DayOfWeek.Monday, 18, 2, next: true)], DayOfWeek.Monday, T(19), T(23)));

    [Fact] public void OvernightBlock_ActivityRunsPastMidnightInsideBlock_Match() =>
        Assert.Null(Check([Block(DayOfWeek.Monday, 18, 2, next: true)], DayOfWeek.Monday, T(19), T(1), true));

    [Fact] public void ActivityEndsNextDay_BlockSameDay_Time() =>
        Assert.Equal(RosterConflictService.ActivityAgreementTime, Check([Block(DayOfWeek.Monday, 9, 13)], DayOfWeek.Monday, T(10), T(2), true));

    [Fact] public void TwoBlocksSameDay_EitherContains_Match() =>
        Assert.Null(Check([Block(DayOfWeek.Monday, 9, 11), Block(DayOfWeek.Monday, 14, 18)], DayOfWeek.Monday, T(15), T(17)));

    [Fact] public void EmptyBlocks_NoBlock() =>
        Assert.Equal(RosterConflictService.ActivityAgreementNoBlock, Check([], DayOfWeek.Monday, T(10), T(12)));

    [Theory]
    [InlineData(9, 11, 10, 12, true)]    // partial overlap
    [InlineData(9, 11, 11, 13, false)]   // touching ends do not overlap
    [InlineData(11, 13, 9, 11, false)]
    [InlineData(9, 13, 10, 12, true)]    // one inside the other
    public void Overlaps_HalfOpenIntervals(int aStart, int aEnd, int bStart, int bEnd, bool expected) =>
        Assert.Equal(expected, AgreementActivityMatch.Overlaps(T(aStart), T(aEnd), false, T(bStart), T(bEnd), false));

    [Fact] public void Overlaps_NextDayEndsAreUnrolled() =>
        Assert.True(AgreementActivityMatch.Overlaps(T(22), T(2), true, T(23), T(23, 30), false));
}
