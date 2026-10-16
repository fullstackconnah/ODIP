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

    // Bunya Support rebrand (owner, 2026-10-16): mail shows the product as its sender, unless the configured From already names one.
    [Fact]
    public void A_bare_from_address_is_sent_as_Bunya_Support()
    {
        using var mail = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("to@example.com", "S", "P", "<p>H</p>"), From);

        Assert.Equal("Bunya Support", mail.From!.DisplayName);
        Assert.Equal(From, mail.From.Address);
    }

    [Fact]
    public void A_from_that_names_its_sender_keeps_that_name()
    {
        using var mail = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("to@example.com", "S", "P", "<p>H</p>"), "Rostering <rosters@odip.test>");

        Assert.Equal("Rostering", mail.From!.DisplayName);
        Assert.Equal("rosters@odip.test", mail.From.Address);
    }

    [Fact]
    public void The_html_view_opens_with_the_wordmark_image_then_the_body()
    {
        using var mail = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("to@example.com", "S", "P", "<p>Body here</p>"), From);

        var view = Assert.Single(mail.AlternateViews);
        using var reader = new StreamReader(view.ContentStream);
        var html = reader.ReadToEnd();
        var img = html.IndexOf("<img src=\"cid:bunya-wordmark\"", StringComparison.Ordinal);
        Assert.True(img >= 0);
        Assert.Contains("alt=\"Bunya Support\"", html);
        Assert.Matches("<img [^>]*width=\"\\d+\" height=\"\\d+\"", html);
        Assert.True(img < html.IndexOf("<p>Body here</p>", StringComparison.Ordinal));
        Assert.Equal("P", mail.Body);
    }

    [Fact]
    public void The_wordmark_rides_along_as_a_linked_png_the_cid_names()
    {
        using var mail = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("to@example.com", "S", "P", "<p>H</p>"), From);

        var image = Assert.Single(mail.AlternateViews[0].LinkedResources);
        Assert.Equal("bunya-wordmark", image.ContentId);
        Assert.Equal("image/png", image.ContentType.MediaType);
        var signature = new byte[8];
        Assert.Equal(8, image.ContentStream.Read(signature, 0, 8));
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, signature);
    }

    [Fact]
    public void Each_message_gets_its_own_image_stream()
    {
        using var first = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("a@example.com", "S", "P", "<p>H</p>"), From);
        using var second = SmtpEmailChannel.BuildMailMessage(new NotificationMessage("b@example.com", "S", "P", "<p>H</p>"), From);

        Assert.NotSame(first.AlternateViews[0].LinkedResources[0].ContentStream, second.AlternateViews[0].LinkedResources[0].ContentStream);
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
