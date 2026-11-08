using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to coordinators/admins when a worker's Finish lands a shift in PendingReview. Deep link
/// assumption: the coordinator roster surface (`/rostering`) — the shift-completion design spec
/// doesn't name a dedicated review-queue route, so this points at the same surface
/// ShiftAssignedTemplate's recipient works from.
/// </summary>
public record ShiftCompletionPendingReviewPayload(
    string RecipientEmail, string WorkerName, string ParticipantName, DateOnly ServiceDate, string? ActivityTitle = null);

public static class ShiftCompletionPendingReviewTemplate
{
    public static NotificationMessage Render(ShiftCompletionPendingReviewPayload p, string baseUrl) => p.ActivityTitle is { } title
        ? new(
            RecipientAddress: p.RecipientEmail,
            Subject: $"Group activity ready for review: {p.WorkerName} / {title}",
            PlainTextBody: $"{p.WorkerName}'s hours for {title} on {Html.Date(p.ServiceDate)} " +
                           $"have been submitted and are awaiting review.

Review it: {baseUrl}/rostering/completions",
            HtmlBody: $"<p>{Html.E(p.WorkerName)}'s hours for {Html.E(title)} on {Html.Date(p.ServiceDate)} " +
                      $"have been submitted and are awaiting review.</p>" +
                      $"<p><a href=\"{Html.Attr(baseUrl)}/rostering/completions\">Review it</a></p>")
        : new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Shift ready for review: {p.WorkerName} / {p.ParticipantName}",
        PlainTextBody: $"{p.WorkerName}'s shift with {p.ParticipantName} on {Html.Date(p.ServiceDate)} " +
                       $"has been submitted and is awaiting review.\n\nReview it: {baseUrl}/rostering",
        HtmlBody: $"<p>{Html.E(p.WorkerName)}'s shift with {Html.E(p.ParticipantName)} on {Html.Date(p.ServiceDate)} " +
                  $"has been submitted and is awaiting review.</p>" +
                  $"<p><a href=\"{Html.Attr(baseUrl)}/rostering\">Review it</a></p>");
}
