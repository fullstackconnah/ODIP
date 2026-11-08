using System.ComponentModel.DataAnnotations;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The full create/update participant DTO caps the four About Me texts at 2000, as the PATCH DTO already does (H43-3).</summary>
public class ParticipantAboutMeCapTests
{
    [Theory]
    [InlineData(nameof(CreateParticipantDto.Goals))]
    [InlineData(nameof(CreateParticipantDto.SupportAreas))]
    [InlineData(nameof(CreateParticipantDto.StrengthsFears))]
    [InlineData(nameof(CreateParticipantDto.ThingsToKnow))]
    public void Create_and_update_refuse_over_2000_and_accept_2000(string property)
    {
        foreach (var type in new[] { typeof(CreateParticipantDto), typeof(UpdateParticipantDto) })
        {
            var over = Validate(type, property, new string('x', 2001));
            Assert.Contains($"The field {property} must be a string with a maximum length of 2000.", over);
            Assert.Empty(Validate(type, property, new string('x', 2000)));
            Assert.Empty(Validate(type, property, null));
        }
    }

    private static List<string> Validate(Type type, string property, string? value)
    {
        var dto = Activator.CreateInstance(type)!;
        type.GetProperty(property)!.SetValue(dto, value); // init-only: reflection still sets it
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results.Where(r => r.MemberNames.Contains(property)).Select(r => r.ErrorMessage!).ToList();
    }
}
