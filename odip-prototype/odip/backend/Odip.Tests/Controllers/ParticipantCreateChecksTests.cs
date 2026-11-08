using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>H47-1 / PB39-N1: a participant create holds the NDIS number, date of birth, plan dates and new contact persons to the rules the enquiry form and the Persons page already apply.</summary>
public class ParticipantCreateChecksTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static ParticipantsController Controller(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    private static CreateParticipantDto Dto() => new()
    {
        FirstName = "Sophie", LastName = "Brown", PlanType = PlanType.SelfManaged,
        OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
    };

    private static async Task<string> RefusedAsync(CreateParticipantDto dto, OdipDbContext db)
    {
        var result = await Controller(db).Create(dto, CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<ParticipantDetailDto>>(bad.Value).Errors![0];
    }

    [Theory]
    [InlineData("12345678", "Enter the 9-digit NDIS number, like 430 123 456.")]
    [InlineData("430 123 45A", "Enter the 9-digit NDIS number, like 430 123 456.")]
    public async Task Create_BadNdisNumber_IsRefusedAndSavesNothing(string ndis, string message)
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        Assert.Equal(message, await RefusedAsync(Dto() with { NdisNumber = ndis }, db));
        Assert.Empty(db.Participants);
    }

    [Fact]
    public async Task Create_FutureDateOfBirth_IsRefusedAndSavesNothing()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        Assert.Equal("The date of birth can't be in the future.", await RefusedAsync(Dto() with { DateOfBirth = Today.AddDays(2) }, db));
        Assert.Empty(db.Participants);
    }

    [Fact]
    public async Task Create_DateOfBirthOver120YearsBack_IsRefusedAndSavesNothing()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        Assert.Equal("Check the year: that's more than 120 years ago.", await RefusedAsync(Dto() with { DateOfBirth = Today.AddYears(-121) }, db));
        Assert.Empty(db.Participants);
    }

    [Fact]
    public async Task Create_PlanEndBeforeStart_IsRefusedAndSavesNothing()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var dto = Dto() with { PlanStartDate = Today, PlanEndDate = Today.AddDays(-1) };
        Assert.Equal("The plan end can't be before the plan start.", await RefusedAsync(dto, db));
        Assert.Empty(db.Participants);
    }

    [Fact]
    public async Task Create_ValidAndBlankFields_AreSaved()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var valid = Dto() with { NdisNumber = "430 123 456", DateOfBirth = Today.AddYears(-30), PlanStartDate = Today, PlanEndDate = Today.AddYears(1) };
        Assert.IsType<CreatedAtActionResult>((await Controller(db).Create(valid, CancellationToken.None)).Result);
        Assert.IsType<CreatedAtActionResult>((await Controller(db).Create(Dto() with { FirstName = "Blank", NdisNumber = "  " }, CancellationToken.None)).Result);
        Assert.Equal(2, await db.Participants.CountAsync());
    }

    private static CreateParticipantDto WithNewPerson(string? email, DateOnly? dob) => Dto() with
    {
        ContactRoles = new()
        {
            new CreateParticipantContactRoleDto
            {
                NewPersonFirstName = "Karen", NewPersonLastName = "Johnson", NewPersonEmail = email, NewPersonDateOfBirth = dob,
                RoleType = ContactRoleType.NextOfKin,
            },
        },
    };

    [Theory]
    [InlineData("not-an-email", "Enter an email address like name@example.com.")]
    [InlineData(null, "Choose a date of birth that isn't in the future.")]
    public async Task Create_NewContactPersonWithBadEmailOrDob_IsRefusedAndSavesNothing(string? email, string message)
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var dto = WithNewPerson(email, email is null ? Today.AddDays(3) : null);
        Assert.Equal(message, await RefusedAsync(dto, db));
        Assert.Empty(db.Participants);
        Assert.Empty(db.People);
    }

    [Fact]
    public async Task Create_NewContactPersonWithValidOrBlankEmail_IsSaved()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        Assert.IsType<CreatedAtActionResult>((await Controller(db).Create(WithNewPerson("karen@example.com", Today.AddYears(-50)), CancellationToken.None)).Result);
        Assert.IsType<CreatedAtActionResult>((await Controller(db).Create(WithNewPerson(null, null) with { FirstName = "Second" }, CancellationToken.None)).Result);
        Assert.Equal(2, await db.People.CountAsync());
    }
}
