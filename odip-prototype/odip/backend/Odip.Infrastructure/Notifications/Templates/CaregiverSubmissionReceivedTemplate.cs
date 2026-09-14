using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>Sent to tenant Admin/Coordinator users when a caregiver submits their profile form.</summary>
public record CaregiverSubmissionReceivedPayload(string RecipientEmail, string CaregiverName, string ParticipantName);

public static class CaregiverSubmissionReceivedTemplate
{
    public static NotificationMessage Render(CaregiverSubmissionReceivedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Caregiver submission received: {p.ParticipantName}",
        PlainTextBody: $"{p.CaregiverName} has submitted a profile update for {p.ParticipantName}.\n\n" +
                       $"Review it: {baseUrl}/caregiver-submissions",
        HtmlBody: $"<p>{Html.E(p.CaregiverName)} has submitted a profile update for {Html.E(p.ParticipantName)}.</p>" +
                  $"<p><a href=\"{Html.Attr(baseUrl)}/caregiver-submissions\">Review it</a></p>");
}
