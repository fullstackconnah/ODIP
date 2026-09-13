using System.Globalization;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// HTML-encoding helper for notification email templates. Every payload field that originates
/// from user input or a DB string (names, free-text notes/reasons, labels) must be routed
/// through <see cref="E"/> before landing in an <c>HtmlBody</c> — otherwise a display name or
/// note containing markup renders live in the recipient's mail client (HTML injection).
///
/// Every date/time interpolated into a template (Subject, PlainTextBody, or HtmlBody) must be
/// routed through <see cref="Date"/>, <see cref="Time"/>, or <see cref="DateTime"/> instead of a
/// raw <c>{x:...}</c> format string — formatting against the current culture is what produced the
/// "15 Sept 2026" (dev, en-AU) vs "15 Sep 2026" (container, invariant globalization) mismatch that
/// broke the deploy test gate. These helpers pin <see cref="CultureInfo.InvariantCulture"/> so
/// rendered output never depends on the host's culture.
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

    /// <summary>Culture-invariant "15 Sep 2026"-style date, matching the templates' existing pattern.</summary>
    public static string Date(DateOnly d) => d.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

    /// <summary>Culture-invariant "9:00 AM"-style time, matching the templates' existing pattern.</summary>
    public static string Time(TimeOnly t) => t.ToString("h:mm tt", CultureInfo.InvariantCulture);

    /// <summary>Culture-invariant combined date/time, for any template that comes to need one.</summary>
    public static string DateTime(System.DateTime dt) => dt.ToString("d MMM yyyy h:mm tt", CultureInfo.InvariantCulture);
}
