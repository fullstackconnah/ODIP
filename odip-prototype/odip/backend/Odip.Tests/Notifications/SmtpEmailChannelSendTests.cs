using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Application.Interfaces;
using Odip.Infrastructure.Notifications;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>A malformed recipient is a permanent failure on the first attempt; nothing reaches the SMTP host.</summary>
public class SmtpEmailChannelSendTests
{
    // Port 1 on loopback refuses at once, so a well-formed send fails fast and nothing is ever delivered.
    private static SmtpEmailChannel ConfiguredChannel() => new(
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Notifications:Smtp:Host"] = "127.0.0.1", ["Notifications:Smtp:Port"] = "1" }).Build(),
        NullLogger<SmtpEmailChannel>.Instance);

    [Theory]
    [InlineData("not an email")]
    [InlineData("jane@")]
    public async Task A_malformed_recipient_is_a_permanent_failure_naming_the_address(string recipient)
    {
        var result = await ConfiguredChannel().SendAsync(new NotificationMessage(recipient, "S", "P", "<p>H</p>"), CancellationToken.None);

        Assert.Equal(ChannelSendOutcome.PermanentFailure, result.Outcome);
        Assert.Equal($"{recipient} isn't a valid email address", result.Reason);
    }

    [Fact]
    public async Task A_well_formed_recipient_that_cannot_connect_is_still_a_transient_failure()
    {
        var result = await ConfiguredChannel().SendAsync(new NotificationMessage("to@example.com", "S", "P", "<p>H</p>"), CancellationToken.None);

        Assert.Equal(ChannelSendOutcome.TransientFailure, result.Outcome);
    }

    [Fact]
    public async Task A_malformed_recipient_with_no_host_configured_is_still_skipped()
    {
        var channel = new SmtpEmailChannel(new ConfigurationBuilder().Build(), NullLogger<SmtpEmailChannel>.Instance);

        var result = await channel.SendAsync(new NotificationMessage("not an email", "S", "P", "<p>H</p>"), CancellationToken.None);

        Assert.Equal(ChannelSendOutcome.Skipped, result.Outcome);
    }
}
