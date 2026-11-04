using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>Location check PR2: the pure Start check. The phone's fix is compared with the service location's pin and radius; only the answer and the distance come out.</summary>
public class LocationCheckTests
{
    private const decimal PinLat = -33.8688m;
    private const decimal PinLon = 151.2093m;
    private const decimal MetresNorth200 = 0.0017987m;   // about 200 m of latitude
    private const decimal MetresNorth250 = 0.0022483m;   // about 250 m of latitude

    private static ServiceLocation Place(int radius = 200) => new() { Name = "Southside Library", Latitude = PinLat, Longitude = PinLon, RadiusMetres = radius };

    [Fact]
    public void Two_points_a_thousandth_of_a_degree_of_latitude_apart_are_about_111_metres()
    {
        var result = LocationCheck.Evaluate(Place(radius: 50), PinLat + 0.001m, PinLon, null, declined: false, queued: false);

        Assert.InRange(result.DistanceMetres!.Value, 110, 112);
        Assert.Equal(LocationCheckStatus.NotAtLocation, result.Status);
    }

    [Fact]
    public void A_fix_exactly_at_the_radius_is_at_the_location()
    {
        var result = LocationCheck.Evaluate(Place(), PinLat + MetresNorth200, PinLon, null, declined: false, queued: false);

        Assert.Equal(200, result.DistanceMetres);
        Assert.Equal(LocationCheckStatus.AtLocation, result.Status);
    }

    [Fact]
    public void Accuracy_counts_in_the_workers_favour_250_m_away_with_60_m_accuracy_is_at_the_location()
    {
        var result = LocationCheck.Evaluate(Place(), PinLat + MetresNorth250, PinLon, 60d, declined: false, queued: false);

        Assert.Equal(LocationCheckStatus.AtLocation, result.Status);
        Assert.Equal(250, result.DistanceMetres);
        Assert.Equal(60, result.AccuracyMetres);
    }

    [Fact]
    public void Accuracy_does_not_rescue_250_m_away_with_40_m_accuracy()
    {
        var result = LocationCheck.Evaluate(Place(), PinLat + MetresNorth250, PinLon, 40d, declined: false, queued: false);

        Assert.Equal(LocationCheckStatus.NotAtLocation, result.Status);
        Assert.Equal(250, result.DistanceMetres);
    }

    [Fact]
    public void No_place_is_NoLocationSet_and_ignores_the_coordinates()
    {
        var result = LocationCheck.Evaluate(null, PinLat, PinLon, 10d, declined: false, queued: false);

        Assert.Equal(new LocationCheckResult(LocationCheckStatus.NoLocationSet, null, null, null), result);
    }

    [Fact]
    public void Declined_is_Unavailable()
    {
        var result = LocationCheck.Evaluate(Place(), null, null, null, declined: true, queued: false);

        Assert.Equal(new LocationCheckResult(LocationCheckStatus.Unavailable, null, null, null), result);
    }

    [Fact]
    public void A_missing_coordinate_is_Unavailable_even_when_not_declined()
    {
        Assert.Equal(LocationCheckStatus.Unavailable, LocationCheck.Evaluate(Place(), PinLat, null, null, declined: false, queued: false).Status);
        Assert.Equal(LocationCheckStatus.Unavailable, LocationCheck.Evaluate(Place(), null, PinLon, null, declined: false, queued: false).Status);
    }

    [Fact]
    public void A_queued_tap_is_Unavailable_with_Started_offline_and_ignores_the_coordinates()
    {
        var result = LocationCheck.Evaluate(Place(), PinLat, PinLon, 5d, declined: false, queued: true);

        Assert.Equal(new LocationCheckResult(LocationCheckStatus.Unavailable, null, null, "Started offline"), result);
    }

    [Fact]
    public void Accuracy_is_clamped_to_zero_and_one_hundred_thousand_metres()
    {
        Assert.Equal(100000, LocationCheck.Evaluate(Place(), PinLat, PinLon, 1e12, declined: false, queued: false).AccuracyMetres);
        Assert.Equal(0, LocationCheck.Evaluate(Place(), PinLat, PinLon, -5d, declined: false, queued: false).AccuracyMetres);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("   ", null)]
    [InlineData("  Road closed  ", "Road closed")]
    public void CleanReason_trims_and_empty_is_none(string? typed, string? expected) => Assert.Equal(expected, LocationCheck.CleanReason(typed));

    [Fact]
    public void CleanReason_cuts_to_the_column_length()
    {
        Assert.Equal(300, LocationCheck.CleanReason(new string('x', 500))!.Length);
    }
}
