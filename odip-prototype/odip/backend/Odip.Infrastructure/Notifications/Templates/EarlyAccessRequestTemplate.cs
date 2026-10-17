using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the operator address in <c>EarlyAccess:NotifyEmail</c> when a NEW address asks for early access, or a known one sends
/// the form again with different answers. Every field in it was typed by an anonymous visitor: name, organisation and email are
/// HTML-encoded in the HTML body (see <see cref="Html"/>) and the subject is a fixed string per kind with no visitor text in it.
/// The visitor's message is never included: the SuperAdmin reads it in Settings > Alpha sign-ups.
/// </summary>
public record EarlyAccessRequestPayload(
    string RecipientEmail, string Name, string Organisation, string Email, DateTime RequestedAtUtc,
    EarlyAccessNoticeKind Kind = EarlyAccessNoticeKind.NewRequest);

public static class EarlyAccessRequestTemplate
{
    public const string Subject = "New Bunya Support early-access request";
    public const string SentAgainSubject = "Bunya Support early-access form sent again";
    public const string LastKeptSubject = "Bunya Support early-access form sent again (last one kept)";
    public const string OverLimitSubject = "Bunya Support early-access form sent again (over the limit)";

    public static NotificationMessage Render(EarlyAccessRequestPayload p)
    {
        var (subject, intro) = p.Kind switch
        {
            EarlyAccessNoticeKind.SentAgain =>
                (SentAgainSubject, $"{p.Name} sent the form again. Open Settings > Alpha sign-ups to read it."),
            EarlyAccessNoticeKind.SentAgainLastKept =>
                (LastKeptSubject, $"{p.Name} sent the form again. This is the last one that will be kept for this address. Open Settings > Alpha sign-ups to read it."),
            EarlyAccessNoticeKind.SentAgainOverLimit =>
                (OverLimitSubject, $"{p.Name} sent the form again after the 10-submission limit. Only the newest one after the limit is kept, so open Settings > Alpha sign-ups to read it."),
            _ => (Subject, "Someone asked for early access to Bunya Support."),
        };

        return new(
            RecipientAddress: p.RecipientEmail,
            Subject: subject,
            PlainTextBody: $"{intro}\n\n" +
                           $"Name: {p.Name}\n" +
                           $"Organisation: {p.Organisation}\n" +
                           $"Email: {p.Email}\n" +
                           $"Requested: {Html.DateTime(p.RequestedAtUtc)} UTC",
            HtmlBody: $"<p>{Html.E(intro)}</p>" +
                      "<table>" +
                      $"<tr><th align=\"left\">Name</th><td>{Html.E(p.Name)}</td></tr>" +
                      $"<tr><th align=\"left\">Organisation</th><td>{Html.E(p.Organisation)}</td></tr>" +
                      $"<tr><th align=\"left\">Email</th><td>{Html.E(p.Email)}</td></tr>" +
                      $"<tr><th align=\"left\">Requested</th><td>{Html.E(Html.DateTime(p.RequestedAtUtc))} UTC</td></tr>" +
                      "</table>");
    }
}
