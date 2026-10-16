using System.Net.Mail;
using System.Net.Mime;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// The Bunya Support brand every email carries (owner, 2026-10-16): the sender's display name, and the wordmark header above each
/// template's HTML body. The wordmark is a PNG (email-wordmark.png, rendered once from the board in Plus Jakarta Sans at 2x on the
/// header's #0f2000) sent inline by Content-ID: mail clients load no web fonts, drop SVG and invert text colours in dark mode, but leave
/// an image alone. With images blocked, the alt text shows in light ink on the same dark band.
/// </summary>
internal static class EmailLayout
{
    public const string SenderName = "Bunya Support";
    public const string WordmarkContentId = "bunya-wordmark";

    private const string Font = "font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#fbf9f5";

    private const string Header =
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" bgcolor=\"#0f2000\" " +
        "style=\"background-color:#0f2000;border-radius:12px;margin:0 0 20px\"><tr>" +
        $"<td style=\"padding:16px 22px;{Font}\">" +
        $"<img src=\"cid:{WordmarkContentId}\" width=\"243\" height=\"51\" alt=\"Bunya Support\" style=\"display:block;border:0;{Font}\">" +
        "</td></tr></table>";

    public static string WithHeader(string htmlBody) => Header + htmlBody;

    /// <summary>A fresh stream per message: a MailMessage disposes its linked resources' streams.</summary>
    public static LinkedResource WordmarkImage() =>
        new(typeof(EmailLayout).Assembly.GetManifestResourceStream("Odip.EmailWordmark.png")!, MediaTypeNames.Image.Png)
        {
            ContentId = WordmarkContentId,
            TransferEncoding = TransferEncoding.Base64,
        };
}
