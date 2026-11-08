using System.ComponentModel.DataAnnotations;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>Shift Notes cap (2000, the column length). [ApiController] turns a failed attribute into a 400, so the DTO check is the 400 and nothing is saved.</summary>
public class ShiftNotesCapTests
{
    private static bool Valid(CreateShiftDto dto) => Validator.TryValidateObject(dto, new ValidationContext(dto), null, true);

    [Theory]
    [InlineData(2000, true)]
    [InlineData(2001, false)]
    [InlineData(0, true)]
    public void Notes_cap_is_2000_on_create_and_update(int length, bool valid)
    {
        var notes = new string('n', length);
        Assert.Equal(valid, Valid(new CreateShiftDto { Notes = notes }));
        Assert.Equal(valid, Valid(new UpdateShiftDto { Notes = notes }));
    }

    [Fact]
    public void Null_notes_stay_allowed() => Assert.True(Valid(new CreateShiftDto()));
}
