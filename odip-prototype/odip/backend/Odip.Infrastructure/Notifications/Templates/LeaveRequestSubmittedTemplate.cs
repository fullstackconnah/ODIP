using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>Never participant clinical detail — names/dates/a deep link only (design spec §4).</summary>
public record LeaveRequestSubmittedPayload(
    string RecipientEmail, string RequesterName, string LeaveType, DateOnly StartDate, DateOnly EndDate);

public static class LeaveRequestSubmittedTemplate
{
    public static NotificationMessage Render(LeaveRequestSubmittedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Leave request from {p.RequesterName}",
        PlainTextBody: $"{p.RequesterName} has requested {p.LeaveType} leave from " +
                       $"{p.StartDate:d MMM yyyy} to {p.EndDate:d MMM yyyy}.\n\nReview it: {baseUrl}/rostering/leave",
        HtmlBody: $"<p>{p.RequesterName} has requested {p.LeaveType} leave from " +
                  $"{p.StartDate:d MMM yyyy} to {p.EndDate:d MMM yyyy}.</p>" +
                  $"<p><a href=\"{baseUrl}/rostering/leave\">Review it</a></p>");
}
