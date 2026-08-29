using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Tests for AuthController.IsEmailVerified — the guard added to Exchange to reject a
/// Firebase ID token whose email_verified claim is absent or false, closing the
/// provisioned-but-unclaimed-account window (see task-1-brief.md).
///
/// Exchange's full flow (Firebase token verification → tenant/user lookup → JWT mint) is
/// not exercised end-to-end here: it depends on the sealed, non-DI
/// FirebaseAuth.DefaultInstance.VerifyIdTokenAsync, which cannot be mocked without adding a
/// Firebase abstraction layer that is out of scope for this hardening task. IsEmailVerified
/// is deliberately public on the controller so the claim-validation logic itself — the part
/// that actually changed — can be tested directly against a constructed claims dictionary,
/// the same shape FirebaseToken.Claims exposes post-verification.
/// </summary>
public class AuthControllerTests
{
    [Fact]
    public void IsEmailVerified_ClaimTrue_ReturnsTrue()
    {
        var claims = new Dictionary<string, object>
        {
            ["email"] = "sarah.mitchell@demo.odip.com.au",
            ["email_verified"] = true,
        };

        Assert.True(AuthController.IsEmailVerified(claims));
    }

    [Fact]
    public void IsEmailVerified_ClaimFalse_ReturnsFalse()
    {
        var claims = new Dictionary<string, object>
        {
            ["email"] = "sarah.mitchell@demo.odip.com.au",
            ["email_verified"] = false,
        };

        Assert.False(AuthController.IsEmailVerified(claims));
    }

    [Fact]
    public void IsEmailVerified_ClaimMissing_ReturnsFalse()
    {
        var claims = new Dictionary<string, object>
        {
            ["email"] = "sarah.mitchell@demo.odip.com.au",
        };

        Assert.False(AuthController.IsEmailVerified(claims));
    }

    [Fact]
    public void IsEmailVerified_ClaimAsStringTrue_ReturnsTrue()
    {
        // Some Firebase Admin SDK deserialization paths box claim values as strings
        // rather than native bools — verify the string representation is honored too.
        var claims = new Dictionary<string, object>
        {
            ["email"] = "sarah.mitchell@demo.odip.com.au",
            ["email_verified"] = "true",
        };

        Assert.True(AuthController.IsEmailVerified(claims));
    }

    [Fact]
    public void IsEmailVerified_ClaimNull_ReturnsFalse()
    {
        var claims = new Dictionary<string, object>
        {
            ["email"] = "sarah.mitchell@demo.odip.com.au",
            ["email_verified"] = null!,
        };

        Assert.False(AuthController.IsEmailVerified(claims));
    }
}
