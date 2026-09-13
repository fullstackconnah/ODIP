namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// HTML-encoding helper for notification email templates. Every payload field that originates
/// from user input or a DB string (names, free-text notes/reasons, labels) must be routed
/// through <see cref="E"/> before landing in an <c>HtmlBody</c> — otherwise a display name or
/// note containing markup renders live in the recipient's mail client (HTML injection).
/// </summary>
internal static class Html
{
    /// <summary>Encode a value for HTML element/text content.</summary>
    public static string E(string? s) => System.Net.WebUtility.HtmlEncode(s ?? string.Empty);

    /// <summary>
    /// Encode a value for a double-quoted HTML attribute (e.g. <c>href</c>).
    /// <see cref="System.Net.WebUtility.HtmlEncode(string?)"/> also escapes <c>"</c>, which is
    /// sufficient for double-quoted attribute values.
    /// </summary>
    public static string Attr(string? s) => System.Net.WebUtility.HtmlEncode(s ?? string.Empty);
}
