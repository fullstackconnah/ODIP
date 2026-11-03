using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to tenant Admin/Coordinator users when an incident is reported. Ruling (design spec §4):
/// carries NO participant name/identity — type/severity/participant identity together are more
/// re-identifying than any single field, so this is the one v1 template that omits it entirely.
/// The reporter's own name is fine (staff data, not participant data).
/// </summary>
public record IncidentReportedPayload(string RecipientEmail, string ReportedByName, string IncidentType, string Severity);

public static class IncidentReportedTemplate
{
    // The payload carries the enum name; the email reads it in words ("sexual abuse", not "SexualAbuse"), as the in-app text does.
    public static NotificationMessage Render(IncidentReportedPayload p, string baseUrl)
    {
        var type = InAppNotificationText.Words(p.IncidentType);
        return new(
            RecipientAddress: p.RecipientEmail,
            Subject: $"Incident reported: {type} ({p.Severity})",
            PlainTextBody: $"{p.ReportedByName} reported a {p.Severity} {type} incident.\n\n" +
                           $"Review it: {baseUrl}/incidents",
            HtmlBody: $"<p>{Html.E(p.ReportedByName)} reported a {Html.E(p.Severity)} {Html.E(type)} incident.</p>" +
                      $"<p><a href=\"{Html.Attr(baseUrl)}/incidents\">Review it</a></p>");
    }
}
