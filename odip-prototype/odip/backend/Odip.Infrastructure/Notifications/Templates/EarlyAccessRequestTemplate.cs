using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the operator address in <c>EarlyAccess:NotifyEmail</c> when a NEW address asks for early access.
/// Every field in it was typed by an anonymous visitor: name, organisation and email are HTML-encoded in the
/// HTML body (see <see cref="Html"/>) and the subject is a fixed string with no visitor text in it.
/// </summary>
public record EarlyAccessRequestPayload(
    string RecipientEmail, string Name, string Organisation, string Email, DateTime RequestedAtUtc);

public static class EarlyAccessRequestTemplate
{
    public const string Subject = "New Odip early-access request";

    public static NotificationMessage Render(EarlyAccessRequestPayload p) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: Subject,
        PlainTextBody: "Someone asked for early access to Odip.\n\n" +
                       $"Name: {p.Name}\n" +
                       $"Organisation: {p.Organisation}\n" +
                       $"Email: {p.Email}\n" +
                       $"Requested: {Html.DateTime(p.RequestedAtUtc)} UTC",
        HtmlBody: "<p>Someone asked for early access to Odip.</p>" +
                  "<table>" +
                  $"<tr><th align=\"left\">Name</th><td>{Html.E(p.Name)}</td></tr>" +
                  $"<tr><th align=\"left\">Organisation</th><td>{Html.E(p.Organisation)}</td></tr>" +
                  $"<tr><th align=\"left\">Email</th><td>{Html.E(p.Email)}</td></tr>" +
                  $"<tr><th align=\"left\">Requested</th><td>{Html.E(Html.DateTime(p.RequestedAtUtc))} UTC</td></tr>" +
                  "</table>");
}
