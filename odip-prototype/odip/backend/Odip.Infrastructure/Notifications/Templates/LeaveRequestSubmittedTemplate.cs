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
                       $"{Html.Date(p.StartDate)} to {Html.Date(p.EndDate)}.\n\nReview it: {baseUrl}/rostering/leave",
        HtmlBody: $"<p>{Html.E(p.RequesterName)} has requested {Html.E(p.LeaveType)} leave from " +
                  $"{Html.Date(p.StartDate)} to {Html.Date(p.EndDate)}.</p>" +
                  $"<p><a href=\"{Html.Attr(baseUrl)}/rostering/leave\">Review it</a></p>");
}
