using System.ComponentModel.DataAnnotations;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Security;

/// <summary>
/// Admins and Coordinators write the activity library, so a request must carry a name that fits the column. [ApiController] answers a failed validation with 400 before the action runs,
/// so a blank name never becomes a row and an oversized one never reaches the database (where it would be a 500).
/// </summary>
public class ActivityDtoValidationTests
{
    private static bool Valid(object dto) => Validator.TryValidateObject(dto, new ValidationContext(dto), new List<ValidationResult>(), validateAllProperties: true);

    public static TheoryData<string?> RejectedNames => new() { null, "", new string('x', 201) };
    public static TheoryData<string> AcceptedNames => new() { "x", new string('x', 200) };

    [Theory, MemberData(nameof(RejectedNames))]
    public void ABlankOrOversizedName_IsRejected_OnCreateAndOnUpdate(string? name)
    {
        Assert.False(Valid(new CreateActivityDto { ActivityName = name! }));
        Assert.False(Valid(new UpdateActivityDto { ActivityName = name! }));
    }

    [Theory, MemberData(nameof(AcceptedNames))]
    public void ANameOfOneToTwoHundredCharacters_IsAccepted_OnCreateAndOnUpdate(string name)
    {
        Assert.True(Valid(new CreateActivityDto { ActivityName = name }));
        Assert.True(Valid(new UpdateActivityDto { ActivityName = name }));
    }
}
