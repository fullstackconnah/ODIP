namespace Odip.Application.Common;

/// <summary>
/// The floor for a password an admin types for someone else. An account the app creates is verified from the start, so a typed password is
/// a working credential on an address that is easy to find, and Firebase's own floor of 6 characters is not enough for that. A person who
/// sets their own password from the emailed link is held to Firebase's rules, not to this one.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 12;

    /// <summary>The refusal for a password that was given and is too short; null when it is long enough or none was given.</summary>
    public static string? Check(string? password) =>
        string.IsNullOrEmpty(password) || password.Length >= MinLength ? null : $"A password must be at least {MinLength} characters.";
}
