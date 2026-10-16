using System.Globalization;
using System.Text;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// What the intake emails share: the three kinds of message, invariant-culture dates in the PROVIDER's zone ("Fri 16 Oct", "10:00 am"), the
/// manager's call clause, and the visit's calendar event. The .ics description never carries the coordinator's notes, because the contact's
/// email holds the same text.
/// </summary>
public static class IntakeWording
{
    public const string Booked = "Booked";
    public const string Changed = "Changed";
    public const string Cancelled = "Cancelled";

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static DateTime Local(DateTime utc, string? timeZoneId) =>
        ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(utc), ProviderLocalTime.ResolveZone(timeZoneId));

    public static string Time(DateTime local) => local.ToString("h:mm", Inv) + (local.Hour < 12 ? " am" : " pm");
    public static string ShortDay(DateTime local) => local.ToString("ddd d MMM", Inv);

    /// <summary>"10:00 am – 2:00 pm"; "9:30 – 11:00 am" when both are in the same half of the day (the screens' visitTimes, compact).</summary>
    public static string Span(DateTime fromLocal, DateTime toLocal) =>
        (fromLocal.Hour < 12) == (toLocal.Hour < 12) ? $"{fromLocal.ToString("h:mm", Inv)} – {Time(toLocal)}" : $"{Time(fromLocal)} – {Time(toLocal)}";
    public static string LongDay(DateTime local) => local.ToString("dddd d MMMM yyyy", Inv);
    public static string LongDayNoYear(DateTime local) => local.ToString("dddd d MMMM", Inv);

    /// <summary>A Subject on one line: a name typed with a line break would otherwise make the mail header invalid.</summary>
    public static string OneLine(string text) => text.Replace("\r\n", " ").Replace('\r', ' ').Replace('\n', ' ');

    public static string Duration(int minutes)
    {
        var hours = minutes / 60;
        var rest = minutes % 60;
        var parts = new List<string>();
        if (hours > 0) parts.Add(hours == 1 ? "1 hour" : $"{hours} hours");
        if (rest > 0) parts.Add(rest == 1 ? "1 minute" : $"{rest} minutes");
        return string.Join(" ", parts);
    }

    /// <summary>"call Alex Brown on 02 9000 0000" from ProviderSettings' manager, or null without a phone: the clause is then left out, never left blank.</summary>
    public static string? CallClause(string? managerName, string? managerPhone) =>
        string.IsNullOrWhiteSpace(managerPhone) ? null : $"call {(string.IsNullOrWhiteSpace(managerName) ? "us" : managerName.Trim())} on {managerPhone.Trim()}";

    /// <summary>
    /// The visit's calendar event for one recipient (that recipient is the ATTENDEE). Only the contact's copy says how to confirm: the staff
    /// member never received the invite email.
    /// </summary>
    public static IntakeIcsEvent Event(string uid, int sequence, DateTime startsAtUtc, int durationMinutes, string personFullName, string location,
        string staffFullName, string providerName, string? managerName, string? managerPhone, string? organizerName, string? organizerEmail,
        string attendeeName, string attendeeEmail, DateTime stampUtc, bool forContact = true)
    {
        var start = ProviderLocalTime.AsUtc(startsAtUtc);
        var call = CallClause(managerName, managerPhone);
        var description = forContact
            ? $"With {staffFullName}, {providerName}. To confirm, reply to the invite email{(call is null ? "" : " or " + call)}."
            : $"With {staffFullName}, {providerName}.";
        return new IntakeIcsEvent(uid, sequence, start, start.AddMinutes(durationMinutes), $"Intake visit: {personFullName}", location, description,
            organizerName, organizerEmail, attendeeName, attendeeEmail, stampUtc);
    }
}

/// <summary>The plain-text and HTML bodies written side by side, so they always say the same thing. Every value goes through Html.E.</summary>
internal sealed class EmailBody
{
    private readonly StringBuilder _plain = new();
    private readonly StringBuilder _html = new();

    public EmailBody Para(string text, string? label = null)
    {
        _plain.Append(label is null ? text : $"{label}: {text}").Append("\n\n");
        _html.Append("<p>").Append(label is null ? "" : $"<strong>{Html.E(label)}:</strong> ").Append(Html.E(text)).Append("</p>");
        return this;
    }

    public EmailBody List(string heading, IEnumerable<string> items)
    {
        var all = items.ToList();
        _plain.Append(heading).Append('\n');
        foreach (var item in all) _plain.Append("- ").Append(item).Append('\n');
        _plain.Append('\n');
        _html.Append("<p><strong>").Append(Html.E(heading)).Append("</strong></p><ul>");
        foreach (var item in all) _html.Append("<li>").Append(Html.E(item)).Append("</li>");
        _html.Append("</ul>");
        return this;
    }

    public EmailBody Link(string text, string url)
    {
        _plain.Append(text).Append('\n').Append(url).Append("\n\n");
        _html.Append("<p><a href=\"").Append(Html.Attr(url)).Append("\">").Append(Html.E(text)).Append("</a></p>");
        return this;
    }

    public EmailBody Lines(params string[] lines)
    {
        var kept = lines.Where(l => !string.IsNullOrWhiteSpace(l)).ToList();
        _plain.Append(string.Join("\n", kept)).Append("\n\n");
        _html.Append("<p>").Append(string.Join("<br>", kept.Select(Html.E))).Append("</p>");
        return this;
    }

    public string PlainText => _plain.ToString().TrimEnd();
    public string HtmlText => _html.ToString();
}
