namespace Odip.Api.Services;

/// <summary>
/// The email domain whose addresses sign in as SuperAdmin whatever their user row's Role: <c>AuthController.Exchange</c> sends a token on
/// it past tenant resolution to a SuperAdmin session. Only a SuperAdmin should be able to enter such an address, so the tenant-scoped
/// surfaces (staff create and update, the staff sign-in-account route) refuse it for everyone else.
/// </summary>
public static class SuperAdminDomain
{
    public const string ConfigKey = "Auth:SuperAdminDomain";

    private const string Default = "odip.com.au";

    /// <summary>The configured SuperAdmin domain, lower-case; the default when none is configured (or there is no configuration).</summary>
    public static string From(IConfiguration? config) => (config?[ConfigKey] ?? Default).Trim().ToLowerInvariant();

    /// <summary>True when the address (already normalised, see <c>EmailIdentity</c>) is on <paramref name="domain"/>.</summary>
    public static bool Covers(string normalisedEmail, string domain) => normalisedEmail.EndsWith("@" + domain, StringComparison.Ordinal);

    /// <summary>The refusal shown to a caller who may not use an address on <paramref name="domain"/>.</summary>
    public static string ReservedMessage(string domain) => $"Addresses at {domain} are reserved for platform administrators.";
}
