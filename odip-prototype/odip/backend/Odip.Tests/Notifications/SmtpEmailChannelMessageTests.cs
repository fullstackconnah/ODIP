using System.Net.Mail;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Application.Interfaces;
using Odip.Infrastructure.Notifications;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>The MailMessage the SMTP channel sends: unchanged without an invite, with a text/calendar view and a Reply-To when asked.</summary>
public class SmtpEmailChannelMessageTests
{
    private const string From = "no-reply@odip.test";

    [Fact]
    public void A_message_without_ics_or_reply_to_is_built_as_before()
    {
        using var mail = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("to@example.com", "Subject", "Plain", "<p>Html</p>"), From);

        Assert.Equal("Plain", mail.Body);
        Assert.Equal("Subject", mail.Subject);
        Assert.Equal(From, mail.From!.Address);
        Assert.Equal("to@example.com", Assert.Single(mail.To).Address);
        var html = Assert.Single(mail.AlternateViews);
        Assert.Equal("text/html", html.ContentType.MediaType);
        Assert.Empty(mail.ReplyToList);
    }

    [Theory]
    [InlineData("REQUEST")]
    [InlineData("CANCEL")]
    public void An_ics_becomes_a_text_calendar_view_carrying_its_method(string method)
    {
        var ics = new IcsCalendar(method, $"BEGIN:VCALENDAR\r\nMETHOD:{method}\r\nEND:VCALENDAR\r\n");

        using var mail = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("to@example.com", "S", "P", "<p>H</p>", Ics: ics), From);

        Assert.Equal(2, mail.AlternateViews.Count);
        Assert.Equal("text/html", mail.AlternateViews[0].ContentType.MediaType);
        var calendar = mail.AlternateViews[1];
        Assert.Equal("text/calendar", calendar.ContentType.MediaType);
        Assert.Equal(method, calendar.ContentType.Parameters["method"]);
        using var reader = new StreamReader(calendar.ContentStream);
        Assert.Equal(ics.Content, reader.ReadToEnd());
    }

    [Fact]
    public void A_valid_reply_to_is_added()
    {
        using var mail = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("to@example.com", "S", "P", "<p>H</p>", ReplyTo: "dana@provider.example"), From);

        Assert.Equal("dana@provider.example", Assert.Single(mail.ReplyToList).Address);
    }

    // Fix round 1, S1: MailMessage refuses a line break in a header. A send must report that as a failure the outbox backs off from, never throw
    // out of the dispatcher's tick (which would leave the rest of the batch unsaved and re-send it every 30 s).
    [Theory]
    [InlineData("Noah\r\nFitzgerald")]
    [InlineData("Noah\nFitzgerald")]
    public async Task A_subject_with_a_line_break_is_a_transient_failure_not_an_exception(string subject)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Notifications:Smtp:Host"] = "127.0.0.1", ["Notifications:Smtp:Port"] = "1" }).Build();
        var channel = new SmtpEmailChannel(config, NullLogger<SmtpEmailChannel>.Instance);

        var result = await channel.SendAsync(new NotificationMessage("to@example.com", subject, "P", "<p>H</p>"), CancellationToken.None);

        Assert.Equal(ChannelSendOutcome.TransientFailure, result.Outcome);
    }

    // User.Email can be "" (the entity's own default). A bad Reply-To must never throw: the booking is already saved when the invite goes.
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not an address")]
    public void A_blank_or_malformed_reply_to_is_left_out_instead_of_throwing(string replyTo)
    {
        using var mail = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("to@example.com", "S", "P", "<p>H</p>", ReplyTo: replyTo), From);

        Assert.Empty(mail.ReplyToList);
    }
}
