using System.Globalization;
using System.Text.RegularExpressions;
using Odip.Application.ProblemReports;
using Odip.Domain.Entities;
using Xunit;

namespace Odip.Tests.ProblemReports;

public class ProblemReportCardTests
{
    internal static ProblemReport Report(Action<ProblemReport>? edit = null)
    {
        var r = new ProblemReport
        {
            Id = Guid.Parse("3f2a9c01-1111-4222-8333-444455556666"),
            TenantId = Guid.NewGuid(),
            ReporterUserId = Guid.NewGuid(),
            ReporterName = "Sam Sample",
            ReporterRole = "Coordinator",
            OrganisationName = "Sample Support Co",
            Text = "The roster will not save.",
            PagePath = "/schedule",
            AppVersion = "1.2.3 (abc1234)",
            ApiVersion = "1.0.0",
            UserAgent = "Mozilla/5.0 (Test)",
            CreatedAt = new DateTime(2026, 11, 3, 2, 30, 0, DateTimeKind.Utc),
        };
        edit?.Invoke(r);
        return r;
    }

    [Theory]
    [InlineData("/participants/3f2a9c01-1111-4222-8333-444455556666", "/participants/:id")]
    [InlineData("/participants/3F2A9C01-1111-4222-8333-444455556666/plan", "/participants/:id/plan")]
    [InlineData("/trips/42/bookings/7", "/trips/:n/bookings/:n")]
    [InlineData("/schedule?week=2026-11-02#top", "/schedule")]
    [InlineData("/schedule#x", "/schedule")]
    [InlineData("/trips/", "/trips")]
    [InlineData("/", "/")]
    [InlineData("", "/")]
    [InlineData(null, "/")]
    [InlineData("/staff/2026-11", "/staff/2026-11")]
    public void Sanitise_StripsIdsQueryAndHash(string? input, string expected) =>
        Assert.Equal(expected, ProblemReportPath.Sanitise(input));

    [Fact]
    public void Sanitise_CapsAt200()
    {
        var result = ProblemReportPath.Sanitise("/" + new string('a', 500));
        Assert.True(result.Length <= 200);
    }

    [Fact]
    public void Title_HasOrgStartOfTextAndRef()
    {
        var title = ProblemReportCard.CardTitle(Report());
        Assert.Equal("Sample Support Co: The roster will not save. [R-3f2a9c01]", title);
    }

    [Fact]
    public void Title_IsOneLine_WithoutControlOrLineSeparators()
    {
        var title = ProblemReportCard.CardTitle(Report(r =>
        {
            r.Text = "line one\nline two\r\nthree four five\tsix";
            r.OrganisationName = "Org\nName";
        }));
        Assert.DoesNotContain('\n', title);
        Assert.DoesNotContain('\r', title);
        Assert.DoesNotContain(' ', title);
        Assert.DoesNotContain(' ', title);
        Assert.DoesNotContain('\t', title);
        Assert.StartsWith("Org Name: line one line two three four five six", title);
    }

    [Fact]
    public void Title_CutsAt70TextElements_NeverInsideASurrogatePair()
    {
        var title = ProblemReportCard.CardTitle(Report(r => r.Text = string.Concat(Enumerable.Repeat("\U0001F600", 100))));
        var body = title["Sample Support Co: ".Length..title.LastIndexOf(" [R-", StringComparison.Ordinal)];
        Assert.Equal(70, new StringInfo(body).LengthInTextElements);
        Assert.Equal(140, body.Length); // 70 whole pairs, none cut in half
    }

    private static readonly string[] Labels =
        { "Problem", "Page", "Organisation", "Reporter", "Reported", "App version", "API version", "Browser", "Report ref" };

    [Fact]
    public void Html_HasExactlyTheNineLabelledLines_InOrder()
    {
        var html = ProblemReportCard.CardHtml(Report());
        var found = Regex.Matches(html, "<p><strong>([^<]+):</strong>").Select(m => m.Groups[1].Value).ToArray();
        Assert.Equal(Labels, found);
        Assert.Equal(9, Regex.Matches(html, "<p>").Count);
        Assert.Contains("<strong>Page:</strong> /schedule</p>", html);
        Assert.Contains("<strong>Reporter:</strong> Sam Sample (Coordinator)</p>", html);
        Assert.Contains("3f2a9c01-1111-4222-8333-444455556666", html);
        // 02:30 UTC on 3 Nov 2026 is 13:30 in Sydney (daylight time).
        Assert.Contains("13:30", html);
    }

    [Fact]
    public void Html_EncodesEveryValue_AndKeepsLineBreaks()
    {
        const string script = "<script>alert(1)</script>";
        const string img = "<img src=x onerror=alert(1)>";
        var html = ProblemReportCard.CardHtml(Report(r =>
        {
            r.Text = $"{script}\n{img} & &amp; \"quoted\" 'single'\r\nlast";
            r.UserAgent = $"UA {script}\n{img}";
            r.OrganisationName = $"Org {img}\nSecond";
            r.ReporterName = script;
            r.PagePath = "/a<b>";
            r.AppVersion = img;
        }));

        Assert.DoesNotContain("<script", html);
        Assert.DoesNotContain("<img", html);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;<br>&lt;img src=x onerror=alert(1)&gt;", html);
        Assert.Contains("&amp; &amp;amp;", html);
        Assert.Contains("&quot;quoted&quot;", html);
        Assert.Contains("last</p>", html);
        Assert.DoesNotContain('\n', html);
        Assert.DoesNotContain('\r', html);

        var stripped = Regex.Replace(html, "</?(p|strong)>|<br>", "");
        Assert.DoesNotContain('<', stripped);
        Assert.DoesNotContain('>', stripped);
    }
}
