namespace Odip.Application.Common;

/// <summary>
/// The domains of the common personal-mail providers: an address at one of them is a normal thing to give a member of staff (their own mailbox),
/// so entering one needs no second look. Every OTHER domain that is not the tenant's own is unusual, and <see cref="AddressConfirmation"/> asks for a
/// confirmation before an account is made for it.
///
/// This is the ONE list. It lives here, and the screens never hold a copy: they learn that a confirmation is needed from the server's answer
/// (<see cref="AddressConfirmation.Code"/>), so there is nothing on the other side to drift out of step with it.
/// </summary>
public static class CommonEmailProviders
{
    public static readonly IReadOnlyList<string> Domains =
    [
        "gmail.com", "googlemail.com",
        "outlook.com", "hotmail.com", "live.com", "msn.com",
        "icloud.com", "me.com",
        "yahoo.com", "yahoo.com.au",
        "bigpond.com", "bigpond.net.au", "optusnet.com.au", "iinet.net.au", "tpg.com.au",
        "proton.me", "protonmail.com",
    ];

    /// <summary>True when <paramref name="domain"/> (already lower-case) is one of the common providers.</summary>
    public static bool Covers(string domain) => Domains.Contains(domain, StringComparer.Ordinal);
}

/// <summary>
/// An address is the whole of someone's sign-in: the link goes to whoever owns it, and the row it is on decides their tenant and role. A typo
/// ("jane@gmial.com") or another organisation's address is therefore a live login for a stranger, and nothing about the address says so. So when the
/// address is at neither the tenant's own domain nor a common email provider, the server refuses (400, <see cref="Code"/>) until the request
/// carries an explicit confirmation, and the screen asks the admin to check the address first. The rule is the server's, so it cannot be skipped by
/// calling the API directly.
/// </summary>
public static class AddressConfirmation
{
    /// <summary>The machine-readable code of the 400, so a screen can ask for the confirmation instead of showing an error.</summary>
    public const string Code = "AddressNeedsConfirmation";

    /// <summary>
    /// Whether this address needs a confirmation. <paramref name="normalisedEmail"/> is in the stored form (see <see cref="EmailIdentity"/>).
    /// <paramref name="tenantEmailDomain"/> is the tenant's own domain; none known (a blank) means only the common providers pass. An address with
    /// no domain at all is not this rule's concern: the other checks refuse it.
    /// </summary>
    public static bool Needed(string normalisedEmail, string? tenantEmailDomain)
    {
        var at = normalisedEmail.LastIndexOf('@');
        if (at < 0 || at == normalisedEmail.Length - 1) return false;

        var domain = normalisedEmail[(at + 1)..];
        var own = tenantEmailDomain?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(own) && domain == own) return false;
        return !CommonEmailProviders.Covers(domain);
    }

    /// <summary>What to ask the admin to check.</summary>
    public static string Message(string normalisedEmail, string? tenantEmailDomain) =>
        $"{normalisedEmail} is not at {(string.IsNullOrWhiteSpace(tenantEmailDomain) ? "this organisation's domain" : tenantEmailDomain.Trim().ToLowerInvariant())} " +
        "or a common email provider. The sign-in link goes to whoever owns this address. Check it is right.";
}
