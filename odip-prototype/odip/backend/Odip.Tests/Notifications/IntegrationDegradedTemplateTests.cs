using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>The integration alert: the problem in words, a link to the card, every DB-sourced value HTML-encoded.</summary>
public class IntegrationDegradedTemplateTests
{
    private const string BaseUrl = "https://odip.test";
    private const string Payload = "<script>alert(1)</script>\"><img src=x>";

    [Fact]
    public void Renders_the_problem_and_links_to_the_integrations_tab()
    {
        var message = IntegrationDegradedTemplate.Render(new IntegrationDegradedPayload("ada@acme.org.au", "Employment Hero", "2 staff members need attention after the Employment Hero sync."), BaseUrl);

        Assert.Equal("ada@acme.org.au", message.RecipientAddress);
        Assert.Equal("Employment Hero needs attention", message.Subject);
        Assert.Contains("2 staff members need attention after the Employment Hero sync.", message.PlainTextBody);
        Assert.Contains("https://odip.test/settings?section=integrations", message.PlainTextBody);
        Assert.Contains("href=\"https://odip.test/settings?section=integrations\"", message.HtmlBody);
    }

    [Fact]
    public void Encodes_the_problem_in_the_html_body()
    {
        var message = IntegrationDegradedTemplate.Render(new IntegrationDegradedPayload("ada@acme.org.au", "Employment Hero", Payload), BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x&gt;", message.HtmlBody);
    }
}
