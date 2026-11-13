using System.Security.Claims;
using Odip.Api.Services;
using Xunit;

namespace Odip.Tests.Common;

/// <summary>ClaimsPrincipalExtensions.TryGetUserId: the one parse of the NameIdentifier claim every controller shares.</summary>
public class ClaimsPrincipalExtensionsTests
{
    private static ClaimsPrincipal With(params string[] nameIdentifiers) =>
        new(new ClaimsIdentity(nameIdentifiers.Select(v => new Claim(ClaimTypes.NameIdentifier, v)), "test"));

    [Fact]
    public void NullPrincipal_ReturnsNull() => Assert.Null(((ClaimsPrincipal?)null).TryGetUserId());

    [Fact]
    public void NoNameIdentifierClaim_ReturnsNull() =>
        Assert.Null(new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("sub", Guid.NewGuid().ToString()) }, "test")).TryGetUserId());

    [Fact]
    public void ClaimThatIsNotAGuid_ReturnsNull() => Assert.Null(With("not-a-guid").TryGetUserId());

    [Fact]
    public void ValidGuidClaim_ReturnsThatGuid()
    {
        var id = Guid.NewGuid();
        Assert.Equal(id, With(id.ToString()).TryGetUserId());
    }

    [Fact]
    public void TwoClaims_ReturnsTheFirst()
    {
        var first = Guid.NewGuid();
        Assert.Equal(first, With(first.ToString(), Guid.NewGuid().ToString()).TryGetUserId());
    }
}
