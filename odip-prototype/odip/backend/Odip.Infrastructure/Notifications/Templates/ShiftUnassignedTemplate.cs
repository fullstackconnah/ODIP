using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the staff member taken off a Published shift: unassigned, replaced, moved or swapped off it (roster drag and drop, 2026-10-14). A Draft change sends nothing.
/// <paramref name="Cancelled"/> (2026-10-28) is a Published shift cancelled with its worker kept; it defaults to false so outbox rows written before it still read "taken off". There is no cancel reason: Notes stay internal.
/// <paramref name="StillTheirs"/> is false when the same save also gave the shift to someone else: the old worker can no longer open it, so the bell links to My shifts.
/// </summary>
public record ShiftUnassignedPayload(
    string RecipientEmail, string ParticipantName, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool Cancelled = false, bool StillTheirs = true);

public static class ShiftUnassignedTemplate
{
    public static NotificationMessage Render(ShiftUnassignedPayload p, string baseUrl)
    {
        var when = $"{Html.Date(p.ServiceDate)} {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}";
        var (subject, plain, html) = p.Cancelled
            ? ($"Shift cancelled: {p.ParticipantName} on {Html.Date(p.ServiceDate)}",
               $"Your shift with {p.ParticipantName}, {when} has been cancelled.",
               $"Your shift with {Html.E(p.ParticipantName)}, {when} has been cancelled.")
            : ($"Shift change: {p.ParticipantName} on {Html.Date(p.ServiceDate)}",
               $"You've been taken off {p.ParticipantName}, {when}.",
               $"You've been taken off {Html.E(p.ParticipantName)}, {when}.");
        return new(
            RecipientAddress: p.RecipientEmail,
            Subject: subject,
            PlainTextBody: plain + $"\n\nView your shifts: {baseUrl}/portal",
            HtmlBody: $"<p>{html}</p><p><a href=\"{Html.Attr(baseUrl)}/portal\">View your shifts</a></p>");
    }
}
