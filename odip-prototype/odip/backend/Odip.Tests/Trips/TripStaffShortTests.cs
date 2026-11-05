using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Trips;

/// <summary>How many staff a trip is short of: the one rule behind the shortfall warning on the roster board and the schedule.</summary>
public class TripStaffShortTests
{
    private static TripInstance Trip(decimal calculated = 0, int? min = null, TripStatus status = TripStatus.Confirmed) =>
        new() { CalculatedStaffRequired = calculated, MinStaffRequired = min, Status = status };

    [Fact]
    public void Short_is_need_minus_assigned() => Assert.Equal(2, TripStaffing.StaffShort(Trip(3m), 1));

    [Fact]
    public void Zero_when_enough_or_more() => Assert.Equal(0, TripStaffing.StaffShort(Trip(2m), 3));

    [Fact]
    public void Zero_when_no_target() => Assert.Equal(0, TripStaffing.StaffShort(Trip(), 0));

    [Fact]
    public void Minimum_floor_with_no_participants() => Assert.Equal(2, TripStaffing.StaffShort(Trip(0m, min: 2), 0));

    [Fact]
    public void Fraction_rounds_up() => Assert.Equal(1, TripStaffing.StaffShort(Trip(1.5m), 1));

    [Theory]
    [InlineData(TripStatus.Cancelled)]
    [InlineData(TripStatus.Archived)]
    [InlineData(TripStatus.Completed)]
    public void Zero_for_cancelled_archived_completed(TripStatus status) => Assert.Equal(0, TripStaffing.StaffShort(Trip(3m, status: status), 0));
}
