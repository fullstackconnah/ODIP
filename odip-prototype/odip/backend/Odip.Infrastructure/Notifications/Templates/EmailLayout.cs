namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// The Bunya Support brand every email carries (owner, 2026-10-16): the sender's display name, and the wordmark header above each
/// template's HTML body. The header is text, not an image: inline styles and raw hex (mail clients ignore CSS variables), a font stack
/// for clients without Plus Jakarta Sans, px letter-spacing, and the dot as a filled span (Gmail strips SVG).
/// </summary>
internal static class EmailLayout
{
    public const string SenderName = "Bunya Support";

    private const string Header =
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" bgcolor=\"#0f2000\" " +
        "style=\"background-color:#0f2000;border-radius:12px;margin:0 0 20px\"><tr>" +
        "<td style=\"padding:18px 24px;font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;line-height:1;letter-spacing:-1px;color:#fbf9f5\">" +
        "<span style=\"font-weight:500\">bunya</span> <span style=\"font-weight:800;color:#bbf37c\">support</span>" +
        "<span style=\"display:inline-block;width:7px;height:7px;margin-left:3px;border-radius:50%;background-color:#bbf37c\"></span>" +
        "</td></tr></table>";

    public static string WithHeader(string htmlBody) => Header + htmlBody;
}
