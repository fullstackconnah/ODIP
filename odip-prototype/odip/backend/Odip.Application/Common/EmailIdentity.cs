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
}
