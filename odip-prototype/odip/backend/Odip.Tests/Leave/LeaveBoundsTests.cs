using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Leave;

/// <summary>H41-2 and H41-3: leave and availability dates stay within 5 years of the start, and the free-text fields refuse more than their 2000-character columns.</summary>
public class LeaveBoundsTests
{
    private static readonly DateOnly Start = new(2026, 11, 10);

    [Theory]
    [InlineData(2031, 11, 10, false)]
    [InlineData(2031, 11, 11, true)]
    [InlineData(9999, 12, 31, true)]
    public void LeaveEnd_MoreThanFiveYearsAfterStart_IsRefused(int y, int m, int d, bool refused)
    {
        var error = LeaveController.ValidateLeaveDates(Start, new DateOnly(y, m, d));
        Assert.Equal(refused ? "Choose an end date within 5 years of the start." : null, error);
    }

    [Fact]
    public void RecurringEffectiveTo_MoreThanFiveYearsAfterFrom_IsRefused()
    {
        Assert.Equal("Choose an end date within 5 years of the start.",
            LeaveController.ValidateRecurringWindow(new TimeOnly(9, 0), new TimeOnly(12, 0), Start, new DateOnly(9999, 12, 31)));
        Assert.Null(LeaveController.ValidateRecurringWindow(new TimeOnly(9, 0), new TimeOnly(12, 0), Start, new DateOnly(2027, 1, 1)));
    }

    [Fact]
    public async Task CreateLeave_To9999_Is400_AndSavesNothing()
    {
        using var db = TestDb.Create();
        var user = new User { Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner", Username = "u" + Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true };
        db.Users.Add(user);
        db.SaveChanges();
        var identity = new System.Security.Claims.ClaimsIdentity([new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test");
        var controller = new LeaveController(db) { ControllerContext = new ControllerContext { HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(identity) } } };

        var result = await controller.CreateLeave(new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Start, EndDate = new DateOnly(9999, 12, 31) }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.LeaveRequests.ToListAsync());
    }

    private static bool Valid(object dto) => Validator.TryValidateObject(dto, new ValidationContext(dto), [], validateAllProperties: true);

    [Fact]
    public void FreeText_Over2000_FailsModelValidation_And2000Passes()
    {
        var ok = new string('x', 2000);
        var long2001 = new string('x', 2001);
        Assert.True(Valid(new CreateLeaveRequestDto { Reason = ok }));
        Assert.False(Valid(new CreateLeaveRequestDto { Reason = long2001 }));
        Assert.False(Valid(new UpdateLeaveRequestDto { Reason = long2001 }));
        Assert.False(Valid(new CreateRecurringUnavailabilityDto { Notes = long2001 }));
        Assert.False(Valid(new UpdateRecurringUnavailabilityDto { Notes = long2001 }));
        Assert.False(Valid(new LeaveDecisionDto { DecisionNote = long2001 }));
        Assert.True(Valid(new LeaveDecisionDto { DecisionNote = ok }));
    }
}
