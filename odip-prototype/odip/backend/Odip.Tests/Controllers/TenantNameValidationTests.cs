using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The organisation name is a trust boundary: blank, whitespace and over-column names are refused by the DTO rules, and a good one is saved trimmed.</summary>
public class TenantNameValidationTests
{
    private static List<ValidationResult> Check(object dto)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results;
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ABlankName_IsRefused_OnCreateAndUpdate(string name)
    {
        Assert.Equal("Enter the organisation name.", Assert.Single(Check(new CreateTenantDto(name, null))).ErrorMessage);
        Assert.Equal("Enter the organisation name.", Assert.Single(Check(new UpdateTenantDto(name, null, true))).ErrorMessage);
    }

    [Fact]
    public void AnOver200Name_IsRefused_AndExactly200Passes()
    {
        Assert.NotEmpty(Check(new CreateTenantDto(new string('a', 201), null)));
        Assert.NotEmpty(Check(new UpdateTenantDto(new string('a', 201), null, true)));
        Assert.Empty(Check(new CreateTenantDto(new string('a', 200), null)));
    }

    [Fact]
    public async Task ANameWithSpaces_IsSavedTrimmed_OnCreateAndUpdate()
    {
        using var db = TestDb.Create();
        var controller = new TenantsController(db, new Mock<IFirebaseUserService>().Object);

        await controller.Create(new CreateTenantDto("  Jo Care  ", null));
        var tenant = await db.Tenants.SingleAsync();
        Assert.Equal("Jo Care", tenant.Name);

        await controller.Update(tenant.Id, new UpdateTenantDto("  Jo Care Co ", null, true));
        Assert.Equal("Jo Care Co", (await db.Tenants.SingleAsync()).Name);
    }
}
