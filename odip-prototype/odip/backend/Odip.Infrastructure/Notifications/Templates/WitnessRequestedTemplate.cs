using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>Sent to the nominated witness for a high-risk medication administration.</summary>
public record WitnessRequestedPayload(string RecipientEmail, string AdministeringStaffName, string ParticipantName);

public static class WitnessRequestedTemplate
{
    public static NotificationMessage Render(WitnessRequestedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Witness needed: {p.ParticipantName}'s medication",
        PlainTextBody: $"{p.AdministeringStaffName} needs you to witness a medication administration " +
                       $"for {p.ParticipantName}.\n\nReview it: {baseUrl}/portal/witness-approvals",
        HtmlBody: $"<p>{Html.E(p.AdministeringStaffName)} needs you to witness a medication administration " +
                  $"for {Html.E(p.ParticipantName)}.</p><p><a href=\"{Html.Attr(baseUrl)}/portal/witness-approvals\">Review it</a></p>");
}
