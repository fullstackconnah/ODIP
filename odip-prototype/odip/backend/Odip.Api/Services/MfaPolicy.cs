using Odip.Domain.Enums;

namespace Odip.Api.Services;

/// <summary>
/// Who must sign in with two-step verification, and whether that is enforced yet. <c>Auth:RequireMfaForAdmins</c> (env <c>Auth__RequireMfaForAdmins</c>)
/// is OFF unless set to true: the exchange then lets everyone in as ever and only logs (<c>MfaWouldRefuse</c>) the sign-ins it would refuse, so the
/// switch is flipped on evidence. Microsoft sign-in never reaches the exchange and is not covered: Entra is trusted for its own sign-ins.
/// </summary>
public static class MfaPolicy
{
    public const string ConfigKey = "Auth:RequireMfaForAdmins";

    /// <summary>The only second factor that counts (Firebase TOTP); SMS is not enabled.</summary>
    private const string Totp = "totp";

    public static bool Enforced(IConfiguration config) => config.GetValue<bool>(ConfigKey);

    public static bool RequiredFor(UserRole role) => role is UserRole.Admin or UserRole.SuperAdmin;

    /// <summary>Whether this token's sign-in verified a TOTP second factor. Ordinal: Firebase writes "totp" in lower case.</summary>
    public static bool Satisfied(IReadOnlyDictionary<string, object> claims) => SignInProviders.SecondFactor(claims) == Totp;
}
