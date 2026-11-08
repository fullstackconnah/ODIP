using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// A text field longer than its EF column cap must be refused by the DTO (a 400) instead of reaching SaveChanges (a 500). Hunt 58, H58-1/2/3/6
/// and the DTOs its OPEN list named. A value at the cap passes; cap + 1 carries the StringLength message.
/// </summary>
public class DtoLengthLimitTests
{
    public static IEnumerable<object[]> Caps()
    {
        foreach (var t in new[]
        {
            typeof(CreateShiftDto), typeof(AssignShiftDto), typeof(MoveStaffDto), typeof(UpdateGroupActivityDto), typeof(ConvertShiftDto),
            typeof(AttachShiftsDto), typeof(AddGroupStaffDto), typeof(UpdateGroupStaffDto), typeof(CreateStaffAssignmentDto),
            typeof(UpdateStaffAssignmentDto), typeof(CreateVehicleAssignmentDto), typeof(UpdateVehicleAssignmentDto),
        })
            yield return new object[] { t, "OverrideReason", 2000 };

        foreach (var t in new[] { typeof(CreateVehicleDto), typeof(UpdateVehicleDto) }) yield return new object[] { t, "VehicleName", 100 };
        foreach (var t in new[] { typeof(CreateTripDto), typeof(UpdateTripDto) }) yield return new object[] { t, "TripCode", 20 };

        foreach (var t in new[] { typeof(CreateAdminUserDto), typeof(UpdateAdminUserDto) })
        {
            yield return new object[] { t, "FirstName", 100 };
            yield return new object[] { t, "LastName", 100 };
            yield return new object[] { t, "Email", 200 };
            yield return new object[] { t, "Username", 100 };
            yield return new object[] { t, "WorkerScreeningNumber", 50 };
            yield return new object[] { t, "Notes", 2000 };
        }
        yield return new object[] { typeof(CreateAdminUserDto), "Region", 100 };

        yield return new object[] { typeof(CreateScheduledActivityDto), "Title", 200 };
        yield return new object[] { typeof(UpdateScheduledActivityDto), "Title", 200 };
        yield return new object[] { typeof(UpdateScheduledActivityDto), "BookingReference", 200 };
        yield return new object[] { typeof(UpdateScheduledActivityDto), "ProviderName", 200 };
        yield return new object[] { typeof(UpdateScheduledActivityDto), "ProviderPhone", 50 };
        yield return new object[] { typeof(UpdateScheduledActivityDto), "ProviderEmail", 200 };
        yield return new object[] { typeof(UpdateScheduledActivityDto), "ProviderWebsite", 500 };
        foreach (var t in new[] { typeof(CreateActivityDto), typeof(UpdateActivityDto) }) yield return new object[] { t, "Location", 200 };
    }

    [Theory]
    [MemberData(nameof(Caps))]
    public void A_value_at_the_cap_passes_and_one_over_is_refused(Type type, string property, int cap)
    {
        Assert.DoesNotContain(LengthErrors(type, property, new string('x', cap)), e => e.Contains("maximum length"));
        Assert.Contains(LengthErrors(type, property, new string('x', cap + 1)), e => e.Contains($"maximum length of {cap}"));
    }

    // Controller-level 400: [ApiController] turns the invalid body into a 400 before the action runs, so the over-long reason never reaches SaveChanges.
    [Fact]
    public void Create_shift_binds_a_validated_body_under_ApiController()
    {
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(RosteringController), typeof(ApiControllerAttribute)));
        var action = typeof(RosteringController).GetMethod(nameof(RosteringController.CreateShift))!;
        Assert.Contains(action.GetParameters(), p => p.ParameterType == typeof(CreateShiftDto));
        Assert.NotEmpty(LengthErrors(typeof(CreateShiftDto), "OverrideReason", new string('x', 2001)));
    }

    private static List<string> LengthErrors(Type type, string property, string value)
    {
        var dto = Activator.CreateInstance(type)!;
        type.GetProperty(property)!.SetValue(dto, value); // init-only: reflection still sets it
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results.Where(r => r.MemberNames.Contains(property)).Select(r => r.ErrorMessage!).ToList();
    }
}
