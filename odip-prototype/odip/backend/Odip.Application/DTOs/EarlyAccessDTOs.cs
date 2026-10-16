namespace Odip.Application.DTOs;

/// <summary>
/// Body of <c>POST /api/public/early-access</c> (the landing-page form).
///
/// Every property is nullable on purpose. MVC would otherwise add an implicit <c>[Required]</c> to
/// each non-nullable reference type and answer a missing field with its own 400 — with its own
/// key casing and wording — before the action even runs, and before the honeypot is checked.
/// The controller reports missing/invalid fields itself, with stable camelCase keys, through
/// <see cref="EarlyAccess.EarlyAccessRequestValidator"/>.
/// </summary>
public class EarlyAccessRequestDto
{
    public string? Name { get; set; }

    public string? Organisation { get; set; }

    public string? Email { get; set; }

    /// <summary>One of <see cref="EarlyAccess.EarlyAccessRequestValidator.OrganisationSizes"/>; optional until the new form ships.</summary>
    public string? OrganisationSize { get; set; }

    /// <summary>Optional free text, one line.</summary>
    public string? Role { get; set; }

    /// <summary>Optional: ASCII digits, spaces and + ( ) - only.</summary>
    public string? Phone { get; set; }

    /// <summary>Optional free text; the server keeps line breaks and drops control and bidi characters.</summary>
    public string? Message { get; set; }

    /// <summary>
    /// Honeypot. The form renders this input hidden from people and from assistive technology, so a
    /// real visitor never fills it in; a bot that fills every input does. A non-empty value gets the
    /// normal 202 and is silently dropped.
    /// </summary>
    public string? Website { get; set; }
}

/// <summary>
/// 202 body for a request the API accepted. It deliberately says nothing about whether the address
/// was new, already known, or discarded as a bot.
/// </summary>
public record EarlyAccessReceivedDto(string Status)
{
    public static EarlyAccessReceivedDto Received { get; } = new("received");
}
