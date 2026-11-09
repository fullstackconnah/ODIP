using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>The headcount floor of a group claim (<see cref="GroupHeadcount.Floor"/>): ceil(people in the group / workers), where the group is the people on a group ratio who are not cancelled or were cancelled at short notice.</summary>
public class GroupSeatCountTests
{
    private static readonly Guid Activity = Guid.NewGuid();
    private static readonly DateOnly Day = new(2026, 10, 12);
    private static readonly TimeZoneInfo Sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");

    private static GroupSeat Seat(SupportRatio ratio = SupportRatio.OneToThree, Guid? person = null, ShiftStatus status = ShiftStatus.Completed, DateTime? cancelledAt = null) =>
        new(Activity, person ?? Guid.NewGuid(), ratio, status, Day, cancelledAt);

    private static List<GroupSeat> Seats(int count, SupportRatio ratio = SupportRatio.OneToThree) => Enumerable.Range(0, count).Select(_ => Seat(ratio)).ToList();

    // 01:00 UTC is 12:00 in Sydney in October (UTC+11): the day of the shift, no notice.
    private static DateTime OnTheDay => new(2026, 10, 12, 1, 0, 0, DateTimeKind.Utc);
    private static DateTime DaysBefore(int days) => OnTheDay.AddDays(-days);

    [Theory]
    [InlineData(6, 1, 6)]
    [InlineData(6, 2, 3)]
    [InlineData(7, 2, 4)]    // rounds up: 7 x 17.50 stays within two workers
    [InlineData(5, 1, 5)]
    [InlineData(0, 1, 0)]
    [InlineData(3, 0, 3)]    // no staff rows: one worker is assumed
    public void Floor_IsPeopleOverWorkers_RoundedUp(int people, int rows, int expected) =>
        Assert.Equal(expected, GroupHeadcount.Floor(Seats(people), rows, Sydney));

    [Fact]
    public void Floor_TwoToOneSiblings_CountAsOnePerson()
    {
        var person = Guid.NewGuid();
        var seats = new List<GroupSeat> { Seat(SupportRatio.OneToThree, person), Seat(SupportRatio.OneToThree, person), Seat(SupportRatio.OneToThree) };

        Assert.Equal(2, GroupHeadcount.Floor(seats, 1, Sydney));
    }

    [Fact]
    public void Floor_OneToOneAndTwoToOne_TakeTheirOwnWorkers_AndAreNotInTheGroup()
    {
        var mixed = Seats(3).Append(Seat(SupportRatio.OneToOne)).ToList();
        var twoToOne = Seats(6).Append(Seat(SupportRatio.TwoToOne, Guid.NewGuid())).ToList();

        Assert.Equal(3, GroupHeadcount.Floor(mixed, 2, Sydney));   // 2 rows - 1 for the 1:1 = 1 worker for 3 people
        Assert.Equal(6, GroupHeadcount.Floor(twoToOne, 3, Sydney)); // 3 rows - 2 for the 2:1 = 1 worker for 6
    }

    [Fact]
    public void Floor_WhenTheOtherRatiosTakeEveryWorker_IsClaimedAsIfOneCoveredIt()
    {
        // Main does the same today; pinned so the floor at one worker is a decision, not an accident (GCH-C2).
        var seats = Seats(3).Concat([Seat(SupportRatio.OneToOne), Seat(SupportRatio.OneToOne)]).ToList();

        Assert.Equal(3, GroupHeadcount.Floor(seats, 2, Sydney));
    }

    [Fact]
    public void Floor_SharedSupportAndOtherRatios()
    {
        var seats = Seats(8, SupportRatio.SharedSupport).Concat(Seats(2, SupportRatio.Other)).ToList();

        Assert.Equal(8, GroupHeadcount.Floor(seats, 1, Sydney));   // Other is nobody's share
    }

    [Fact]
    public void Floor_CancelledSeat_CountsOnlyWhenCancelledAtShortNotice()
    {
        var live = Seats(2);
        Assert.Equal(3, GroupHeadcount.Floor(live.Append(Seat(status: ShiftStatus.Cancelled, cancelledAt: OnTheDay)).ToList(), 1, Sydney));         // on the day: a didn't-attend
        Assert.Equal(3, GroupHeadcount.Floor(live.Append(Seat(status: ShiftStatus.Cancelled, cancelledAt: DaysBefore(6))).ToList(), 1, Sydney));    // 6 days ahead: short notice
        Assert.Equal(2, GroupHeadcount.Floor(live.Append(Seat(status: ShiftStatus.Cancelled, cancelledAt: DaysBefore(7))).ToList(), 1, Sydney));    // 7 days ahead: out of the group
        Assert.Equal(2, GroupHeadcount.Floor(live.Append(Seat(status: ShiftStatus.Cancelled, cancelledAt: null)).ToList(), 1, Sydney));             // no time: not short notice, as the claim has it
    }

    [Fact]
    public void Floor_NoticeIsCountedInTheShiftsOwnZone()
    {
        // 14:30 UTC on 5 Oct is 01:30 on the 6th in Sydney (UTC+11): 6 days ahead, short notice. In Perth (UTC+8) it is 22:30 on the 5th: 7 days ahead, out of the group.
        var perth = TimeZoneInfo.FindSystemTimeZoneById("Australia/Perth");
        var at = new DateTime(2026, 10, 5, 14, 30, 0, DateTimeKind.Utc);
        var seats = Seats(2).Append(Seat(status: ShiftStatus.Cancelled, cancelledAt: at)).ToList();

        Assert.Equal(3, GroupHeadcount.Floor(seats, 1, Sydney));
        Assert.Equal(2, GroupHeadcount.Floor(seats, 1, perth));
    }

    // The G1 invariant, now with N from the count: the lines of a group never add up to more than its workers x the rate.
    [Fact]
    public void Invariant_TheLinesOfAGroupNeverExceedWorkersTimesTheRate()
    {
        foreach (var rate in new[] { 70.01m, 70.23m, 193.99m })
            foreach (var workers in new[] { 1, 2, 3, 4 })
                for (var people = 1; people <= 60; people++)
                {
                    var n = Math.Max(3, GroupHeadcount.Floor(Seats(people), workers, Sydney));
                    var unit = Math.Floor(rate * 100m / n) / 100m;

                    Assert.True(people * unit <= workers * rate, $"{rate} {people} people {workers} workers");
                }
    }
}
