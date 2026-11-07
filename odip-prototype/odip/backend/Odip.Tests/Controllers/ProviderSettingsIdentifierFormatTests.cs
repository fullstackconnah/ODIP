using System.ComponentModel.DataAnnotations;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>H5-2: the ABN and registration number are digits and spaces only, so a typed "=1+1" never reaches the BPR CSV.</summary>
public class ProviderSettingsIdentifierFormatTests
{
    private static List<ValidationResult> Errors(object dto)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results;
    }

    private static UpsertProviderSettingsDto Upsert(string reg, string abn) => new()
    {
        RegistrationNumber = reg, ABN = abn, OrganisationName = "Org", Address = "1 Main St",
    };

    [Theory]
    [InlineData("=1+1")]
    [InlineData("12A")]
    public void Upsert_RefusesNonDigitValues_WithTheFieldMessage(string bad)
    {
        Assert.Contains(Errors(Upsert(bad, "12 345 678 901")), e => e.ErrorMessage == "Use digits only for the registration number.");
        Assert.Contains(Errors(Upsert("4050009", bad)), e => e.ErrorMessage == "Use digits only for the ABN.");
    }

    [Fact]
    public void Upsert_AcceptsDigitsAndSpaces() =>
        Assert.Empty(Errors(Upsert("4050 009", "12 345 678 901")));

    [Theory]
    [InlineData("=1+1")]
    [InlineData("12A")]
    public void Setup_RefusesNonDigitValues_WithTheFieldMessage(string bad)
    {
        Assert.Contains(Errors(new TenantSetupProviderDto { RegistrationNumber = bad }), e => e.ErrorMessage == "Use digits only for the registration number.");
        Assert.Contains(Errors(new TenantSetupProviderDto { ABN = bad }), e => e.ErrorMessage == "Use digits only for the ABN.");
    }

    [Fact]
    public void Setup_AcceptsDigitsSpacesAndBlank()
    {
        Assert.DoesNotContain(Errors(new TenantSetupProviderDto { RegistrationNumber = "12 345 678 901", ABN = "12 345 678 901" }), e => e.ErrorMessage!.StartsWith("Use digits"));
        Assert.DoesNotContain(Errors(new TenantSetupProviderDto { RegistrationNumber = "", ABN = "" }), e => e.ErrorMessage!.StartsWith("Use digits"));
    }
}
