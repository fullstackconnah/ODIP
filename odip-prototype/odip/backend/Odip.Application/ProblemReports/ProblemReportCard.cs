using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;

namespace Odip.Application.ProblemReports;

/// <summary>What a problem report looks like as a Work Board card: a one-line title and an HTML description.</summary>
public static class ProblemReportCard
{
    public const int TitleTextElements = 70;

    private static readonly Regex Whitespace = new(@"[\s\p{Cc}  ]+", RegexOptions.Compiled);

    /// <summary>"Org: first 70 text elements of the text [R-xxxxxxxx]". One line, no control characters; cut by text element so an emoji is never split.</summary>
    public static string CardTitle(ProblemReport r)
    {
        var text = OneLine(r.Text);
        var cut = new StringBuilder();
        var elements = StringInfo.GetTextElementEnumerator(text);
        for (var i = 0; i < TitleTextElements && elements.MoveNext(); i++)
            cut.Append(elements.GetTextElement());
        return $"{OneLine(r.OrganisationName)}: {cut.ToString().TrimEnd()} {Ref(r)}";
    }

    /// <summary>The short reference in the title, which the retry searches for to find a card it may already have made.</summary>
    public static string Ref(ProblemReport r) => $"[R-{r.Id.ToString("D")[..8]}]";

    /// <summary>Nine labelled lines. Every value is HTML-encoded first, then newlines become &lt;br&gt;, so no value can add a tag.</summary>
    public static string CardHtml(ProblemReport r)
    {
        var sydney = ProviderLocalTime.UtcToLocal(DateTime.SpecifyKind(r.CreatedAt, DateTimeKind.Utc), ProviderLocalTime.ResolveZone("Australia/Sydney"));
        var lines = new (string Label, string Value)[]
        {
            ("Problem", r.Text),
            ("Page", r.PagePath),
            ("Organisation", r.OrganisationName),
            ("Reporter", $"{r.ReporterName} ({r.ReporterRole})"),
            ("Reported", sydney.ToString("d MMM yyyy, HH:mm", CultureInfo.InvariantCulture) + " Sydney time"),
            ("App version", r.AppVersion),
            ("API version", r.ApiVersion),
            ("Browser", r.UserAgent),
            ("Report ref", r.Id.ToString("D")),
        };
        return string.Concat(lines.Select(l => $"<p><strong>{l.Label}:</strong> {Encode(l.Value)}</p>"));
    }

    private static string Encode(string value) =>
        WebUtility.HtmlEncode(value).Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", "<br>");

    private static string OneLine(string value) => Whitespace.Replace(value, " ").Trim();
}
