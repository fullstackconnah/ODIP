using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to an organisation's Admins once per new integration problem (the Employment Hero connection failing, or staff needing attention).
/// It names no staff member: the Integrations card lists them.
/// </summary>
public record IntegrationDegradedPayload(string RecipientEmail, string Integration, string Problem);

public static class IntegrationDegradedTemplate
{
    public static NotificationMessage Render(IntegrationDegradedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"{p.Integration} needs attention",
        PlainTextBody: $"{p.Problem}\n\nOpen it: {baseUrl}/settings?tab=integrations",
        HtmlBody: $"<p>{Html.E(p.Problem)}</p>" +
                  $"<p><a href=\"{Html.Attr(baseUrl)}/settings?tab=integrations\">Open it</a></p>");
}
