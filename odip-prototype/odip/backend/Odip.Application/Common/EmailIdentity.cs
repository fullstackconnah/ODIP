namespace Odip.Application.Common;

/// <summary>
/// The one form an email address is stored and compared in: trimmed and lower-cased with the invariant culture (a Turkish-locale
/// server must not turn "I" into a dotless "ı").
///
/// Firebase lower-cases every address, so a sign-in token always carries the lower-case form. A user row stored as typed
/// ("Jane.Smith@acme.com.au") could never be matched by an exact comparison, and its owner got a 401 after setting a password.
/// Every place that writes <c>User.Email</c> stores this form, passes the same value to Firebase, and checks uniqueness against it;
/// the exchange compares <c>u.Email.ToLower()</c> to it, which also finds rows stored in another case before this rule existed.
/// </summary>
public static class EmailIdentity
{
    public static string Normalise(string email) => email.Trim().ToLowerInvariant();

    /// <summary>
    /// The one form a tenant's email domain is stored and compared in: trimmed, any leading "@" stripped (people type "@acme.com.au" for "acme.com.au"),
    /// lower-case with the invariant culture. An address's own domain (the part after its "@") is already in this form once the address is normalised.
    /// </summary>
    public static string NormaliseDomain(string domain) => domain.Trim().TrimStart('@').Trim().ToLowerInvariant();
}
