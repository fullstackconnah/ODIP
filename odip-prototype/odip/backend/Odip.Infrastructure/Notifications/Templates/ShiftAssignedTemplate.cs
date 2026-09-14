using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>Sent to the staff member a shift was assigned to.</summary>
public record ShiftAssignedPayload(
    string RecipientEmail, string ParticipantName, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime);

public static class ShiftAssignedTemplate
{
    public static NotificationMessage Render(ShiftAssignedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"New shift: {p.ParticipantName} on {Html.Date(p.ServiceDate)}",
        PlainTextBody: $"You've been assigned a shift with {p.ParticipantName} on {Html.Date(p.ServiceDate)} " +
                       $"from {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.\n\nView it: {baseUrl}/portal",
        HtmlBody: $"<p>You've been assigned a shift with {Html.E(p.ParticipantName)} on {Html.Date(p.ServiceDate)} " +
                  $"from {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.</p>" +
                  $"<p><a href=\"{Html.Attr(baseUrl)}/portal\">View it</a></p>");
}
