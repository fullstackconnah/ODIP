using Microsoft.Extensions.Logging;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;

namespace Odip.Infrastructure.Notifications;

/// <summary>What became of one intake invite email. <see cref="ErrorCode"/> is what ParticipantInquiry.IntakeInviteError stores.</summary>
public sealed record IntakeSendOutcome(bool Sent, string? ErrorCode)
{
    public const string NotConfigured = "NotConfigured";
    public const string Failed = "Failed";
}

/// <summary>
/// Sends an intake email to the enquiry's contact straight through the email channel, synchronously, as EarlyAccessNotifier does (the outbox can
/// only address users). It never throws: the booking is saved before the send, so every failure becomes an outcome the row stores and the
/// coordinator sees. No SMTP host (live ODIP today) is NotConfigured; anything else that stops the email, including a server slower than
/// <see cref="Timeout"/>, is Failed. The SMTP error text is logged, never stored, because it can carry configuration.
/// </summary>
public sealed class IntakeInviteSender
{
    private readonly IEnumerable<INotificationChannel> _channels;
    private readonly ILogger<IntakeInviteSender> _logger;

    public IntakeInviteSender(IEnumerable<INotificationChannel> channels, ILogger<IntakeInviteSender> logger)
    {
        _channels = channels;
        _logger = logger;
    }

    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);

    public async Task<IntakeSendOutcome> SendAsync(NotificationMessage message, CancellationToken ct)
    {
        var channel = _channels.FirstOrDefault(c => c.Kind == NotificationChannelKind.Email);
        if (channel is null) return new(false, IntakeSendOutcome.NotConfigured);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(Timeout);
        try
        {
            var result = await channel.SendAsync(message, timeout.Token);
            if (result.Outcome == ChannelSendOutcome.Sent) return new(true, null);
            _logger.LogWarning("Intake email not sent: {Outcome} ({Reason})", result.Outcome, result.Reason);
            return new(false, result.Outcome == ChannelSendOutcome.Skipped ? IntakeSendOutcome.NotConfigured : IntakeSendOutcome.Failed);
        }
        catch (Exception ex)
        {
            // A timeout, a request aborted mid-send, or anything the channel did not catch. The booking is already saved, so the row says the email did not go.
            _logger.LogWarning(ex, "Intake email not sent");
            return new(false, IntakeSendOutcome.Failed);
        }
    }
}
