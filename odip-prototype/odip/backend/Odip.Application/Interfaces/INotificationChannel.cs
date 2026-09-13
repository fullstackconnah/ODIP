using Odip.Domain.Notifications;

namespace Odip.Application.Interfaces;

public enum ChannelSendOutcome { Sent, Skipped, TransientFailure, PermanentFailure, NotSupported }

public record ChannelSendResult(ChannelSendOutcome Outcome, string? ProviderMessageId, string? Reason);

public record NotificationMessage(string RecipientAddress, string Subject, string PlainTextBody, string HtmlBody);

/// <summary>
/// One delivery channel (email, SMS, ...). <see cref="Odip.Infrastructure.Notifications.SmtpEmailChannel"/>
/// and <see cref="Odip.Infrastructure.Notifications.SmsChannel"/> (a permanent v1 stub) are the
/// two v1 implementations — see docs/specs/2026-09-08-notifications-design.md §3.
/// </summary>
public interface INotificationChannel
{
    NotificationChannelKind Kind { get; }
    Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct);
}
