using Odip.Domain.Notifications;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.Notifications;

public class StaffJoinedViaMicrosoftTests
{
    private static readonly Guid UserId = Guid.Parse("11111111-2222-3333-4444-555555555555");

    [Fact]
    public void StaffJoinedViaMicrosoft_TextAndLink()
    {
        var built = InAppNotificationText.Build(NotificationEventType.StaffJoinedViaMicrosoft, UserId,
            new StaffJoinedViaMicrosoftPayload("admin@x.au", UserId, "Sam Lee", "sam@x.au", "SupportWorker"));
        Assert.Equal("Sam Lee joined with Microsoft sign-in as support worker.", built.Title);
        Assert.Equal($"/staff/{UserId}", built.LinkTo);
        Assert.DoesNotContain("@", built.Title);
    }

    [Fact]
    public void StaffJoinedViaMicrosoft_Renders()
    {
        var m = StaffJoinedViaMicrosoftTemplate.Render(new("admin@x.au", UserId, "Sam Lee", "sam@x.au", "ReadOnly"), "https://odip.test");
        Assert.Equal("admin@x.au", m.RecipientAddress);
        Assert.Contains("Sam Lee", m.Subject);
        Assert.Contains("sam@x.au", m.PlainTextBody);
        Assert.Contains($"https://odip.test/staff/{UserId}", m.HtmlBody);
    }

    [Fact]
    public void StaffJoinedViaMicrosoft_EncodesEveryUserControlledField()
    {
        const string Evil = "<script>alert(1)</script>\"";
        var m = StaffJoinedViaMicrosoftTemplate.Render(new("admin@x.au", UserId, Evil, Evil, Evil), "https://odip.test");
        Assert.DoesNotContain("<script>", m.HtmlBody);
        Assert.Contains("&lt;script&gt;", m.HtmlBody);
        Assert.Contains("&quot;", m.HtmlBody);
        Assert.DoesNotContain("\n", StaffJoinedViaMicrosoftTemplate.Render(new("a@x.au", UserId, "A\r\nBcc: x@y", "e", "r"), "https://odip.test").Subject);
    }
}
