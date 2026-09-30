using System.Globalization;
using System.Net.Mail;
using Odip.Application.DTOs;

namespace Odip.Application.EarlyAccess;

/// <summary>
/// Field rules for the public early-access form, and the normalisation the stored values rely on:
/// name/organisation/email are trimmed, and the email is lower-cased with the invariant culture so
/// the unique index on <c>EarlyAccessRequests.Email</c> matches the same person however they type it.
///
/// Error keys are the camelCase JSON property names of <see cref="EarlyAccessRequestDto"/>; the
/// landing page keys its inline messages on them, so treat them as part of the API contract.
/// The honeypot (<c>website</c>) is not validated here — the controller checks it first.
/// </summary>
public static class EarlyAccessRequestValidator
{
    public const string NameField = "name";
    public const string OrganisationField = "organisation";
    public const string EmailField = "email";

    public const int MaxNameLength = 100;
    public const int MaxOrganisationLength = 150;

    /// <summary>The longest valid address (RFC 5321: 256-octet path, less the angle brackets).</summary>
    public const int MaxEmailLength = 254;

    private const int MaxEmailLocalPartLength = 64;

    public static EarlyAccessValidationResult Validate(EarlyAccessRequestDto? request)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);

        var name = Clean(request?.Name);
        CheckText(errors, NameField, "Name", "Enter your name.", name, MaxNameLength);

        var organisation = Clean(request?.Organisation);
        CheckText(errors, OrganisationField, "Organisation", "Enter your organisation.", organisation, MaxOrganisationLength);

        var email = Clean(request?.Email);
        if (email.Length == 0)
            errors[EmailField] = new[] { "Enter your email address." };
        else if (email.Length > MaxEmailLength)
            errors[EmailField] = new[] { $"Email must be {MaxEmailLength.ToString(CultureInfo.InvariantCulture)} characters or fewer." };
        else if (!IsValidEmail(email))
            errors[EmailField] = new[] { "Enter a valid email address." };

        return new EarlyAccessValidationResult(name, organisation, email.ToLowerInvariant(), errors);
    }

    private static string Clean(string? value) => (value ?? string.Empty).Trim();

    private static void CheckText(
        Dictionary<string, string[]> errors, string field, string label, string missingMessage, string value, int maxLength)
    {
        if (value.Length == 0)
            errors[field] = new[] { missingMessage };
        else if (value.Length > maxLength)
            errors[field] = new[] { $"{label} must be {maxLength.ToString(CultureInfo.InvariantCulture)} characters or fewer." };
        else if (value.Any(char.IsControl))
            // CR/LF/tab and friends have no business in a one-line name, and would ride into the
            // operator notification email and any export of the stored rows.
            errors[field] = new[] { $"{label} contains characters that are not allowed." };
    }

    /// <summary>
    /// Deliberately conservative: one <c>@</c>, a dotted domain, no whitespace, no quoted local part and
    /// no IP-literal domain. <see cref="MailAddress"/> does the heavy parsing; requiring it to hand back
    /// exactly the input rejects display-name, angle-bracket and comment forms ("Jane &lt;j@x.com&gt;").
    /// </summary>
    private static bool IsValidEmail(string email)
    {
        if (email.Any(c => char.IsWhiteSpace(c) || char.IsControl(c)))
            return false;

        var at = email.IndexOf('@');
        if (at <= 0 || at != email.LastIndexOf('@') || at == email.Length - 1)
            return false;

        var local = email[..at];
        var domain = email[(at + 1)..];

        if (local.Length > MaxEmailLocalPartLength || local.StartsWith('"') || domain.StartsWith('['))
            return false;

        if (!domain.Contains('.') || domain.StartsWith('.') || domain.EndsWith('.') || domain.Contains(".."))
            return false;

        // Last label (the TLD) must be at least two characters: "jane@example.c" is a typo, not an address.
        if (domain[(domain.LastIndexOf('.') + 1)..].Length < 2)
            return false;

        return MailAddress.TryCreate(email, out var parsed)
            && string.Equals(parsed.Address, email, StringComparison.Ordinal);
    }
}

/// <summary>
/// Outcome of <see cref="EarlyAccessRequestValidator.Validate"/>: the cleaned values (safe to store
/// when <see cref="IsValid"/>) and per-field messages keyed by camelCase field name.
/// </summary>
public sealed record EarlyAccessValidationResult(
    string Name,
    string Organisation,
    string Email,
    Dictionary<string, string[]> Errors)
{
    public bool IsValid => Errors.Count == 0;
}
