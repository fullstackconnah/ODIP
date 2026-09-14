using Odip.Application.Interfaces;
using Odip.Domain.Notifications;

namespace Odip.Infrastructure.Notifications;

/// <summary>
/// Permanent v1 stub (product ruling 1) — no SMS provider is implemented. Registered so the
/// dispatcher can resolve *a* channel for an SMS-preference row and get a clean Skipped result
/// rather than a missing-implementation exception. Preference rows and UI already exist for
/// when a provider is added later.
/// </summary>
public sealed class SmsChannel : INotificationChannel
{
    public NotificationChannelKind Kind => NotificationChannelKind.Sms;

    public Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct) =>
        Task.FromResult(new ChannelSendResult(ChannelSendOutcome.NotSupported, null, "SMS is not implemented"));
}
