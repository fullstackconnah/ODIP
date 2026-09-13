using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>Sent to the staff member whose leave it is (not the coordinator who decided it).</summary>
public record LeaveRequestDecidedPayload(
    string RecipientEmail, string LeaveType, DateOnly StartDate, DateOnly EndDate,
    bool Approved, string? DecisionNote);

public static class LeaveRequestDecidedTemplate
{
    public static NotificationMessage Render(LeaveRequestDecidedPayload p, string baseUrl)
    {
        var outcome = p.Approved ? "approved" : "declined";
        var noteText = string.IsNullOrWhiteSpace(p.DecisionNote) ? string.Empty : $"\n\nNote: {p.DecisionNote}";
        var noteHtml = string.IsNullOrWhiteSpace(p.DecisionNote) ? string.Empty : $"<p>Note: {p.DecisionNote}</p>";
        return new(
            RecipientAddress: p.RecipientEmail,
            Subject: $"Your {p.LeaveType} leave request was {outcome}",
            PlainTextBody: $"Your {p.LeaveType} leave request from {p.StartDate:d MMM yyyy} to " +
                           $"{p.EndDate:d MMM yyyy} was {outcome}.{noteText}\n\nView it: {baseUrl}/portal/leave",
            HtmlBody: $"<p>Your {p.LeaveType} leave request from {p.StartDate:d MMM yyyy} to " +
                      $"{p.EndDate:d MMM yyyy} was {outcome}.</p>{noteHtml}" +
                      $"<p><a href=\"{baseUrl}/portal/leave\">View it</a></p>");
    }
}
