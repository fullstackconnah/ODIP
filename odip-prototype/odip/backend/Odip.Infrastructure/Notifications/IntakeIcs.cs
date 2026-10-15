using System.Globalization;
using System.Net.Mail;
using System.Text;
using Odip.Application.Interfaces;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Notifications;

/// <summary>
/// One intake visit as an iCalendar VEVENT. The UID is stable for the booking and SEQUENCE grows with each revision, so a calendar replaces the
/// event on an update (REQUEST) and removes it on a CANCEL. Times are UTC instants written with a trailing Z. ORGANIZER is the coordinator who
/// booked it (left out when their email does not parse); ATTENDEE is this email's own recipient, so the contact's copy never names a staff address.
/// </summary>
public sealed record IntakeIcsEvent(
    string Uid, int Sequence, DateTime StartsAtUtc, DateTime EndsAtUtc, string Summary, string Location, string Description,
    string? OrganizerName, string? OrganizerEmail, string AttendeeName, string AttendeeEmail, DateTime StampUtc);

public static class IntakeIcs
{
    public const string Request = "REQUEST";
    public const string Cancel = "CANCEL";

    private static readonly string Slash = new('\u005C', 1);

    public static IcsCalendar Build(string method, IntakeIcsEvent e)
    {
        var lines = new List<string>
        {
            "BEGIN:VCALENDAR", "PRODID:-//ODIP//Intake visit//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", $"METHOD:{method}",
            "BEGIN:VEVENT",
            $"UID:{e.Uid}",
            $"SEQUENCE:{e.Sequence.ToString(CultureInfo.InvariantCulture)}",
            $"DTSTAMP:{Utc(e.StampUtc)}",
            $"DTSTART:{Utc(e.StartsAtUtc)}",
            $"DTEND:{Utc(e.EndsAtUtc)}",
            $"SUMMARY:{Text(e.Summary)}",
            $"LOCATION:{Text(e.Location)}",
            $"DESCRIPTION:{Text(e.Description)}",
            method == Cancel ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
        };
        if (MailAddress.TryCreate(e.OrganizerEmail, out var organizer))
            lines.Add($"ORGANIZER;CN={Param(e.OrganizerName ?? organizer.Address)}:mailto:{organizer.Address}");
        var attendee = MailAddress.TryCreate(e.AttendeeEmail, out var parsed) ? parsed.Address : e.AttendeeEmail.Replace("\r", "").Replace("\n", "");
        lines.Add($"ATTENDEE;CN={Param(e.AttendeeName)};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:{attendee}");
        lines.Add("END:VEVENT");
        lines.Add("END:VCALENDAR");

        var content = new StringBuilder();
        foreach (var line in lines) content.Append(Fold(line)).Append("\r\n");
        return new IcsCalendar(method, content.ToString());
    }

    private static string Utc(DateTime instant) => ProviderLocalTime.AsUtc(instant).ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

    // RFC 5545 3.3.11: a backslash, a semicolon and a comma are escaped with a backslash, and a line break becomes backslash-n.
    private static string Text(string? value) => (value ?? string.Empty)
        .Replace(Slash, Slash + Slash).Replace(";", Slash + ";").Replace(",", Slash + ",")
        .Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", Slash + "n");

    // A parameter value is quoted, and may hold no double quote or line break (RFC 5545 3.2).
    private static string Param(string value) => "\"" + value.Replace("\"", "'").Replace("\r", " ").Replace("\n", " ") + "\"";

    // RFC 5545 3.1: no line over 75 octets. A longer one carries on after CRLF and one space, never inside a UTF-8 sequence.
    private static string Fold(string line)
    {
        var folded = new StringBuilder();
        var octets = 0;
        foreach (var rune in line.EnumerateRunes())
        {
            if (octets + rune.Utf8SequenceLength > 75)
            {
                folded.Append("\r\n ");
                octets = 1;
            }
            folded.Append(rune.ToString());
            octets += rune.Utf8SequenceLength;
        }
        return folded.ToString();
    }
}
