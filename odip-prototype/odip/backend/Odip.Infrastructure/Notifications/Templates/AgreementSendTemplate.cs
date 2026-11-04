using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the person a service agreement is shared with: a link to read it and a note on where to reply. Every user string goes through the
/// <see cref="EmailBody"/> encoder; the subject is one line. Reply-To is the organisation's own contact email.
/// </summary>
public record AgreementSendPayload(
    string RecipientEmail, string RecipientName, string ParticipantName, string ProviderName, string Url, DateOnly ExpiresOn,
    string? ContactEmail, string? ContactPhone);

public static class AgreementSendTemplate
{
    public static NotificationMessage Render(AgreementSendPayload p)
    {
        var subject = IntakeWording.OneLine($"{p.ProviderName} has sent the service agreement for {p.ParticipantName}");
        var reply = p.ContactEmail is { Length: > 0 } email
            ? $"If you have questions, reply to this email{(p.ContactPhone is { Length: > 0 } ? " or call " + p.ContactPhone : "")}."
            : $"If you have questions, call {p.ContactPhone}.";
        var body = new EmailBody()
            .Para(p.RecipientName is { Length: > 0 } name ? $"Hello {name}," : "Hello,")
            .Para($"{p.ProviderName} has sent the service agreement for {p.ParticipantName}. You can read it and download a copy from this link.")
            .Link("Read the agreement", p.Url)
            .Para($"The link works until {IntakeWording.LongDay(p.ExpiresOn.ToDateTime(TimeOnly.MinValue))}. Anyone with the link can read the agreement, so please don't forward this email.")
            .Para(reply)
            .Lines(p.ProviderName);
        return new NotificationMessage(p.RecipientEmail, subject, body.PlainText, body.HtmlText, null, p.ContactEmail, p.ProviderName);
    }
}
