using System.ComponentModel.DataAnnotations;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Trips;

/// <summary>
/// The trip edit dialog is a trust boundary: [ApiController] answers a failed validation with 400 before Update runs, so a trip never saves with a missing start date
/// (a JSON body without one binds to 0001-01-01) or a duration under one day.
/// </summary>
public class TripDtoValidationTests
{
    private static bool Valid(object dto) => Validator.TryValidateObject(dto, new ValidationContext(dto), new List<ValidationResult>(), validateAllProperties: true);

    private static readonly DateOnly Start = new(2026, 11, 1);

    [Fact]
    public void AMissingStartDate_IsRejected_OnCreateAndOnUpdate()
    {
        Assert.False(Valid(new CreateTripDto { TripName = "Beach", DurationDays = 3 }));
        Assert.False(Valid(new UpdateTripDto { TripName = "Beach", DurationDays = 3 }));
    }

    [Fact]
    public void ADurationUnderOneDay_IsRejected_OnUpdate() =>
        Assert.False(Valid(new UpdateTripDto { TripName = "Beach", StartDate = Start, DurationDays = 0 }));

    [Fact]
    public void AStartDateAndAtLeastOneDay_IsAccepted_OnUpdate() =>
        Assert.True(Valid(new UpdateTripDto { TripName = "Beach", StartDate = Start, DurationDays = 1 }));
}
