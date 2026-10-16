using System.Globalization;
using System.Net.Mail;
using System.Text;
using Odip.Application.DTOs;

namespace Odip.Application.EarlyAccess;

/// <summary>
/// Field rules for the public early-access form's seven fields, and the normalisation the stored values rely on:
/// every value is trimmed, and the email is lower-cased with the invariant culture so
/// the unique index on <c>EarlyAccessRequests.Email</c> matches the same person however they type it.
/// Organisation size, role, phone and message are optional (blank is null). The two free-text rules differ on
/// purpose: a control or bidi character in the one-line role is refused, while the message is cleaned of them.
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
    public const string RoleField = "role";
    public const string PhoneField = "phone";
    public const string OrganisationSizeField = "organisationSize";
    public const string MessageField = "message";

    public const int MaxNameLength = 100;
    public const int MaxOrganisationLength = 150;
    public const int MaxRoleLength = 100;
    public const int MaxPhoneLength = 30;
    public const int MaxMessageLength = 1000;

    /// <summary>The landing form's size bands, as stored (exact and case-sensitive after trimming).</summary>
    public static readonly IReadOnlyList<string> OrganisationSizes = ["under-10", "10-49", "50-199", "200-plus"];

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

        var role = Optional(request?.Role);
        if (role is not null)
        {
            if (role.Length > MaxRoleLength)
                errors[RoleField] = new[] { $"Role must be {MaxRoleLength.ToString(CultureInfo.InvariantCulture)} characters or fewer." };
            else if (role.Any(IsDisallowedInOneLineText))
                errors[RoleField] = new[] { "Role contains characters that are not allowed." };
        }

        var phone = Optional(request?.Phone);
        if (phone is not null)
        {
            if (phone.Length > MaxPhoneLength)
                errors[PhoneField] = new[] { $"Phone must be {MaxPhoneLength.ToString(CultureInfo.InvariantCulture)} characters or fewer." };
            else if (!phone.All(IsPhoneCharacter))
                errors[PhoneField] = new[] { "Use digits, spaces and + ( ) - only." };
            else if (!HasPhoneDigits(phone))
                errors[PhoneField] = new[] { "Enter a phone number with 8 to 15 digits." };
        }

        var organisationSize = Optional(request?.OrganisationSize);
        // Optional in PR 1 (expand): the live /welcome form sends none. PR 2 makes it required, with the form that asks for it.
        if (organisationSize is not null && !OrganisationSizes.Contains(organisationSize, StringComparer.Ordinal))
            errors[OrganisationSizeField] = new[] { "Choose one of the listed sizes." };

        var message = CleanMessage(request?.Message);
        if (message is not null && message.Length > MaxMessageLength)
            errors[MessageField] = new[] { "Message must be 1,000 characters or fewer." };

        return new EarlyAccessValidationResult(
            name, organisation, email.ToLowerInvariant(), role, phone, organisationSize, message, errors);
    }

    private static string Clean(string? value) => (value ?? string.Empty).Trim();

    private static string? Optional(string? value) => Clean(value) is { Length: > 0 } v ? v : null;

    /// <summary>8 to 15 digits (E.164 allows 15), and a + only as the first character: "---" and "1+2345678" are not numbers.</summary>
    private static bool HasPhoneDigits(string phone) => phone.LastIndexOf('+') <= 0 && phone.Count(char.IsAsciiDigit) is >= 8 and <= 15;

    // ASCII only: char.IsDigit also accepts Arabic-Indic, fullwidth and other scripts' digits.
    private static bool IsPhoneCharacter(char c) => c is (>= '0' and <= '9') or ' ' or '+' or '(' or ')' or '-';

    /// <summary>
    /// The message is several lines of free text that the SuperAdmin list renders as plain text. Line breaks are kept (CRLF, CR and the
    /// Unicode line/paragraph separators become LF), a tab becomes a space, and every other character IsDisallowedInOneLineText rejects
    /// (controls, bidi overrides and isolates) is dropped rather than refused: a visitor pasting from a document should not get a 400.
    /// Blank after cleaning is null. The length limit applies to the cleaned text, so it never refuses what the form's count allowed.
    /// </summary>
    private static string? CleanMessage(string? value)
    {
        if (value is null) return null;
        var text = value.Replace("\r\n", "\n");
        var cleaned = new StringBuilder(text.Length);
        foreach (var c in text)
        {
            if (c is '\n' or '\r' or '\u2028' or '\u2029') cleaned.Append('\n');
            else if (c == '\t') cleaned.Append(' ');
            else if (!IsDisallowedInOneLineText(c)) cleaned.Append(c);
        }
        return Optional(cleaned.ToString());
    }

    private static void CheckText(
        Dictionary<string, string[]> errors, string field, string label, string missingMessage, string value, int maxLength)
    {
        // A value with no letter or digit at all (only spaces, punctuation, zero-width marks) is as good as empty.
        if (value.Length == 0 || !value.Any(char.IsLetterOrDigit))
            errors[field] = new[] { missingMessage };
        else if (value.Length > maxLength)
            errors[field] = new[] { $"{label} must be {maxLength.ToString(CultureInfo.InvariantCulture)} characters or fewer." };
        else if (value.Any(IsDisallowedInOneLineText))
            // CR/LF/tab and friends have no business in a one-line name, and would ride into the
            // operator notification email and any export of the stored rows.
            errors[field] = new[] { $"{label} contains characters that are not allowed." };
    }

    /// <summary>
    /// Control characters, the Unicode line and paragraph separators (U+2028/U+2029) and the bidirectional
    /// override/isolate marks (U+202A-202E, U+2066-2069): each can fake a new line or reorder text in the PLAIN-TEXT
    /// operator email. Other format characters (ZWJ/ZWNJ, needed by some scripts' names) are allowed.
    /// </summary>
    private static bool IsDisallowedInOneLineText(char c) =>
        char.IsControl(c)
        || c is '\u2028' or '\u2029'
        || (c >= '\u202A' && c <= '\u202E')
        || (c >= '\u2066' && c <= '\u2069');

    /// <summary>
    /// Deliberately conservative: one <c>@</c>, a dotted domain, no whitespace, no quoted local part and
    /// no IP-literal domain. <see cref="MailAddress"/> does the heavy parsing; requiring it to hand back
    /// exactly the input rejects display-name, angle-bracket and comment forms ("Jane &lt;j@x.com&gt;").
    /// </summary>
    private static bool IsValidEmail(string email)
    {
        // Whitespace, controls, line/paragraph separators and bidi marks: the address goes raw into the PLAIN-TEXT email body.
        if (email.Any(c => char.IsWhiteSpace(c) || IsDisallowedInOneLineText(c)))
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
    string? Role,
    string? Phone,
    string? OrganisationSize,
    string? Message,
    Dictionary<string, string[]> Errors)
{
    public bool IsValid => Errors.Count == 0;
}
