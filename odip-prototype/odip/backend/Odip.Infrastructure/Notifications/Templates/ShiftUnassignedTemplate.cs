using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>Sent to the staff member taken off a Published shift: unassigned, replaced, moved or swapped off it (roster drag and drop, 2026-10-14). A Draft change sends nothing.</summary>
public record ShiftUnassignedPayload(
    string RecipientEmail, string ParticipantName, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime);

public static class ShiftUnassignedTemplate
{
    public static NotificationMessage Render(ShiftUnassignedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Shift change: {p.ParticipantName} on {Html.Date(p.ServiceDate)}",
        PlainTextBody: $"You've been taken off {p.ParticipantName}, {Html.Date(p.ServiceDate)} {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}." +
                       $"\n\nView your shifts: {baseUrl}/portal",
        HtmlBody: $"<p>You've been taken off {Html.E(p.ParticipantName)}, {Html.Date(p.ServiceDate)} {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.</p>" +
                  $"<p><a href=\"{Html.Attr(baseUrl)}/portal\">View your shifts</a></p>");
}
