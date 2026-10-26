using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to each active Admin of an organisation when someone first signs in through its linked Microsoft directory and an ODIP account is
/// created for them (ms-sso spec 2026-10-26). FullName and Email come from the person's Microsoft ID token, which the directory's own admin controls,
/// so every field is HTML-encoded.
/// </summary>
public record StaffJoinedViaMicrosoftPayload(string RecipientEmail, Guid UserId, string FullName, string Email, string Role);

public static class StaffJoinedViaMicrosoftTemplate
{
    public static NotificationMessage Render(StaffJoinedViaMicrosoftPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"{Line(p.FullName)} joined with Microsoft sign-in",
        PlainTextBody: $"{p.FullName} ({p.Email}) signed in with Microsoft for the first time and was added as {p.Role}.\n\n" +
                       $"Review them: {baseUrl}/staff/{p.UserId}",
        HtmlBody: $"<p>{Html.E(p.FullName)} ({Html.E(p.Email)}) signed in with Microsoft for the first time and was added as {Html.E(p.Role)}.</p>" +
                  $"<p><a href=\"{Html.Attr(baseUrl)}/staff/{p.UserId}\">Review them</a></p>");

    /// <summary>A line break typed into a name never reaches the Subject header.</summary>
    private static string Line(string s) => s.Replace("\r", " ").Replace("\n", " ");
}
