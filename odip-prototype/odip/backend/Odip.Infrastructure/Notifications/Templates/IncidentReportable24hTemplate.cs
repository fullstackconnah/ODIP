using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the incident's tenant Admin and Coordinator users once, when the incident becomes reportable to the NDIS Commission within 24 hours (IC6, 2026-11-04).
/// Like <see cref="IncidentReportedPayload"/> it carries NO participant name. <paramref name="DueLocal"/> is the deadline in the provider's zone, already worded ("Wed 5 Nov, 2:15 pm").
/// </summary>
public record IncidentReportable24hPayload(string RecipientEmail, string ReportedByName, string IncidentType, string Severity, string DueLocal, Guid IncidentId);

public static class IncidentReportable24hTemplate
{
    public static NotificationMessage Render(IncidentReportable24hPayload p, string baseUrl)
    {
        var type = InAppNotificationText.Words(p.IncidentType);
        var link = $"{baseUrl}/incidents/{p.IncidentId}";
        return new(
            RecipientAddress: p.RecipientEmail,
            Subject: $"Urgent: report this incident to the NDIS Commission by {p.DueLocal}",
            PlainTextBody: $"{p.ReportedByName} reported a {p.Severity} {type} incident. It must be reported to the NDIS Commission within 24 hours, by {p.DueLocal}.\n\n" +
                           $"Open the incident: {link}",
            HtmlBody: $"<p>{Html.E(p.ReportedByName)} reported a {Html.E(p.Severity)} {Html.E(type)} incident. It must be reported to the NDIS Commission within 24 hours, by {Html.E(p.DueLocal)}.</p>" +
                      $"<p><a href=\"{Html.Attr(link)}\">Open the incident</a></p>");
    }
}
