using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>Sent to the staff member a shift was assigned to.</summary>
public record ShiftAssignedPayload(
    string RecipientEmail, string ParticipantName, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime);

public static class ShiftAssignedTemplate
{
    public static NotificationMessage Render(ShiftAssignedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"New shift: {p.ParticipantName} on {p.ServiceDate:d MMM yyyy}",
        PlainTextBody: $"You've been assigned a shift with {p.ParticipantName} on {p.ServiceDate:d MMM yyyy} " +
                       $"from {p.StartTime:h:mm tt} to {p.EndTime:h:mm tt}.\n\nView it: {baseUrl}/portal",
        HtmlBody: $"<p>You've been assigned a shift with {p.ParticipantName} on {p.ServiceDate:d MMM yyyy} " +
                  $"from {p.StartTime:h:mm tt} to {p.EndTime:h:mm tt}.</p>" +
                  $"<p><a href=\"{baseUrl}/portal\">View it</a></p>");
}
