using Odip.Api.Services;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Services;

public class EnumInputTests
{
    [Theory]
    [InlineData("Admin", UserRole.Admin)]
    [InlineData("admin", UserRole.Admin)]
    [InlineData("2", UserRole.SupportWorker)]
    public void TryParseDefined_TakesOneDefinedNameOrNumber(string text, UserRole expected)
    {
        Assert.True(EnumInput.TryParseDefined<UserRole>(text, out var value));
        Assert.Equal(expected, value);
    }

    // "Admin,Coordinator" ORs to 1 (Coordinator), a defined value, so only the comma check refuses it.
    [Theory]
    [InlineData("Admin,Coordinator")]
    [InlineData("99")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("NoSuch")]
    public void TryParseDefined_RefusesEverythingElse(string? text) =>
        Assert.False(EnumInput.TryParseDefined<UserRole>(text, out _));
}
