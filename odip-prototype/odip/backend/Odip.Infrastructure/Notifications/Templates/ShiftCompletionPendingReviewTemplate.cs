using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to coordinators/admins when a worker's Finish lands a shift in PendingReview. Deep link
/// assumption: the coordinator roster surface (`/rostering`) — the shift-completion design spec
/// doesn't name a dedicated review-queue route, so this points at the same surface
/// ShiftAssignedTemplate's recipient works from.
/// </summary>
public record ShiftCompletionPendingReviewPayload(
    string RecipientEmail, string WorkerName, string ParticipantName, DateOnly ServiceDate);

public static class ShiftCompletionPendingReviewTemplate
{
    public static NotificationMessage Render(ShiftCompletionPendingReviewPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Shift ready for review: {p.WorkerName} / {p.ParticipantName}",
        PlainTextBody: $"{p.WorkerName}'s shift with {p.ParticipantName} on {Html.Date(p.ServiceDate)} " +
                       $"has been submitted and is awaiting review.\n\nReview it: {baseUrl}/rostering",
        HtmlBody: $"<p>{Html.E(p.WorkerName)}'s shift with {Html.E(p.ParticipantName)} on {Html.Date(p.ServiceDate)} " +
                  $"has been submitted and is awaiting review.</p>" +
                  $"<p><a href=\"{Html.Attr(baseUrl)}/rostering\">Review it</a></p>");
}
