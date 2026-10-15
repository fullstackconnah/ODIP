using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Notifications;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>The intake invite's send outcome, as the enquiry row stores it: sent, NotConfigured (no SMTP, live today) or Failed. Never an exception.</summary>
public class IntakeInviteSenderTests
{
    private static readonly NotificationMessage Message = new("priya@example.com", "S", "P", "<p>H</p>");

    private sealed class FakeChannel(Func<CancellationToken, Task<ChannelSendResult>> send) : INotificationChannel
    {
        public NotificationChannelKind Kind => NotificationChannelKind.Email;
        public Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct) => send(ct);
    }

    private static IntakeInviteSender Sender(params INotificationChannel[] channels) => new(channels, NullLogger<IntakeInviteSender>.Instance);

    [Theory]
    [InlineData(ChannelSendOutcome.Sent, true, null)]
    [InlineData(ChannelSendOutcome.Skipped, false, "NotConfigured")]
    [InlineData(ChannelSendOutcome.TransientFailure, false, "Failed")]
    [InlineData(ChannelSendOutcome.PermanentFailure, false, "Failed")]
    public async Task The_channel_outcome_becomes_the_stored_code(ChannelSendOutcome outcome, bool sent, string? code)
    {
        var result = await Sender(new FakeChannel(_ => Task.FromResult(new ChannelSendResult(outcome, null, "smtp said no")))).SendAsync(Message, CancellationToken.None);

        Assert.Equal(new IntakeSendOutcome(sent, code), result);
    }

    // Live ODIP today: the real channel with no Notifications:Smtp:Host.
    [Fact]
    public async Task The_real_smtp_channel_without_a_host_is_not_configured()
    {
        var smtp = new SmtpEmailChannel(new ConfigurationBuilder().Build(), NullLogger<SmtpEmailChannel>.Instance);

        Assert.Equal(new IntakeSendOutcome(false, "NotConfigured"), await Sender(smtp, new SmsChannel()).SendAsync(Message, CancellationToken.None));
    }

    [Fact]
    public async Task No_email_channel_at_all_is_not_configured()
    {
        Assert.Equal(new IntakeSendOutcome(false, "NotConfigured"), await Sender(new SmsChannel()).SendAsync(Message, CancellationToken.None));
    }

    [Fact]
    public async Task A_channel_that_throws_is_failed_not_an_exception()
    {
        var result = await Sender(new FakeChannel(_ => throw new FormatException("bad address"))).SendAsync(Message, CancellationToken.None);

        Assert.Equal(new IntakeSendOutcome(false, "Failed"), result);
    }

    // An SMTP server that hangs rather than refusing: the request gets its answer after the timeout, with the booking saved and the email Failed.
    [Fact]
    public async Task A_hanging_server_times_out_as_failed()
    {
        var hanging = new FakeChannel(async ct => { await Task.Delay(Timeout.Infinite, ct); return new ChannelSendResult(ChannelSendOutcome.Sent, null, null); });
        var sender = new IntakeInviteSender([hanging], NullLogger<IntakeInviteSender>.Instance) { Timeout = TimeSpan.FromMilliseconds(100) };

        var started = DateTime.UtcNow;
        var result = await sender.SendAsync(Message, CancellationToken.None);

        Assert.Equal(new IntakeSendOutcome(false, "Failed"), result);
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(10));
    }
}
