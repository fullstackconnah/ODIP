using System.ComponentModel.DataAnnotations;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>User.Mobile is a 20-character column: a longer mobile on any DTO that saves to it is a 400 before the database, not a 500 from it.</summary>
public class StaffMobileLengthTests
{
    private static List<string> MobileErrors(object dto, string? mobile)
    {
        dto.GetType().GetProperty("Mobile")!.SetValue(dto, mobile); // init-only: reflection still sets it
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results.Where(r => r.MemberNames.Contains("Mobile")).Select(r => r.ErrorMessage!).ToList();
    }

    public static IEnumerable<object[]> Dtos() =>
    [
        [typeof(CreateStaffDto)],
        [typeof(UpdateStaffDto)],
        [typeof(CreateAdminUserDto)],
    ];

    [Theory]
    [MemberData(nameof(Dtos))]
    public void TwentyOneCharacters_IsRefusedWithTheMessage(Type dto) =>
        Assert.Equal("Mobile can be up to 20 characters.", Assert.Single(MobileErrors(Activator.CreateInstance(dto)!, new string('1', 21))));

    [Theory]
    [MemberData(nameof(Dtos))]
    public void TwentyCharactersBlankAndMissing_AreAccepted(Type dto)
    {
        Assert.Empty(MobileErrors(Activator.CreateInstance(dto)!, new string('1', 20)));
        Assert.Empty(MobileErrors(Activator.CreateInstance(dto)!, ""));
        Assert.Empty(MobileErrors(Activator.CreateInstance(dto)!, null));
    }
}
