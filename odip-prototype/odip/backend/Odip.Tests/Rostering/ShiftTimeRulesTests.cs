using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

public class ShiftTimeRulesTests
{
    [Theory]
    [InlineData(0, false)] [InlineData(5, false)] [InlineData(-5, false)] [InlineData(6, true)] [InlineData(-6, true)]
    public void IsOffRoster_Boundaries(int variance, bool expected) => Assert.Equal(expected, ShiftTimeRules.IsOffRoster(variance));

    [Theory]
    [InlineData(null, null)] [InlineData("", null)] [InlineData("   ", null)] [InlineData("  Bus was early  ", "Bus was early")]
    public void CleanReason_TrimsAndEmptyIsNone(string? input, string? expected) => Assert.Equal(expected, ShiftTimeRules.CleanReason(input));

    [Fact]
    public void CleanReason_CutsToTheColumnLength() => Assert.Equal(500, ShiftTimeRules.CleanReason("  " + new string('x', 600) + "  ")!.Length);
}
