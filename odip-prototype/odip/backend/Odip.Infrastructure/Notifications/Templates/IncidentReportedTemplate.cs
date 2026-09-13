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
    public static NotificationMessage Render(IncidentReportedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Incident reported: {p.IncidentType} ({p.Severity})",
        PlainTextBody: $"{p.ReportedByName} reported a {p.Severity} {p.IncidentType} incident.\n\n" +
                       $"Review it: {baseUrl}/incidents",
        HtmlBody: $"<p>{p.ReportedByName} reported a {p.Severity} {p.IncidentType} incident.</p>" +
                  $"<p><a href=\"{baseUrl}/incidents\">Review it</a></p>");
}
