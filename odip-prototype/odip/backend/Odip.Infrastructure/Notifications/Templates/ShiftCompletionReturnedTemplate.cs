using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the worker when a coordinator returns their shift completion for correction. Deep
/// link assumption: the worker's own portal (`/portal`) — same surface ShiftAssignedTemplate
/// points at, since that's where the worker re-submits from.
/// </summary>
public record ShiftCompletionReturnedPayload(
    string RecipientEmail, string ParticipantName, DateOnly ServiceDate, string ReturnReason);

public static class ShiftCompletionReturnedTemplate
{
    public static NotificationMessage Render(ShiftCompletionReturnedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Shift returned for correction: {p.ParticipantName} on {p.ServiceDate:d MMM yyyy}",
        PlainTextBody: $"Your shift with {p.ParticipantName} on {p.ServiceDate:d MMM yyyy} was returned " +
                       $"for correction.\n\nReason: {p.ReturnReason}\n\nView it: {baseUrl}/portal",
        HtmlBody: $"<p>Your shift with {p.ParticipantName} on {p.ServiceDate:d MMM yyyy} was returned " +
                  $"for correction.</p><p>Reason: {p.ReturnReason}</p>" +
                  $"<p><a href=\"{baseUrl}/portal\">View it</a></p>");
}
