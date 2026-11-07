using System.ComponentModel.DataAnnotations;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>Staff Notes (2000) and worker screening number (50) caps. [ApiController] turns a failed attribute into a 400, so the DTO check is the 400.</summary>
public class StaffTextCapTests
{
    private static CreateStaffDto Staff(string? notes = null, string? screening = null) => new()
    {
        FirstName = "Sam", LastName = "Synthetic", Email = "sam@example.com", Notes = notes, WorkerScreeningNumber = screening,
    };

    private static bool Valid(CreateStaffDto dto) => Validator.TryValidateObject(dto, new ValidationContext(dto), null, true);

    [Theory]
    [InlineData(2000, true)]
    [InlineData(2001, false)]
    [InlineData(0, true)]
    public void Notes_cap_is_2000_on_create_and_update(int length, bool valid)
    {
        var notes = new string('n', length);
        Assert.Equal(valid, Valid(Staff(notes: notes)));
        Assert.Equal(valid, Valid(new UpdateStaffDto { FirstName = "Sam", LastName = "Synthetic", Email = "sam@example.com", Notes = notes }));
    }

    [Theory]
    [InlineData(50, true)]
    [InlineData(51, false)]
    [InlineData(0, true)]
    public void Screening_number_cap_is_50_on_create_and_update(int length, bool valid)
    {
        var number = new string('1', length);
        Assert.Equal(valid, Valid(Staff(screening: number)));
        Assert.Equal(valid, Valid(new UpdateStaffDto { FirstName = "Sam", LastName = "Synthetic", Email = "sam@example.com", WorkerScreeningNumber = number }));
    }

    [Fact]
    public void Blank_and_null_stay_allowed() => Assert.True(Valid(Staff()));
}
