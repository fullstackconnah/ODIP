using System.Threading.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Application.EarlyAccess;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Notifications.Templates;

namespace Odip.Infrastructure.EarlyAccess;

/// <summary>
/// Emails the operator about a first-time early-access request through the existing email channel
/// (<see cref="INotificationChannel"/> with <see cref="NotificationChannelKind.Email"/>, i.e. SmtpEmailChannel).
///
/// Opt-in. It sends only when BOTH <c>EarlyAccess:NotifyEmail</c> and <c>Notifications:Smtp:Host</c> are
/// configured; by default (nothing configured) the request is stored and one Information line with a masked
/// address is logged, nothing else. Setting <c>EarlyAccess:NotifyEmail</c> is a pre-release item.
///
/// The send happens off the request path, from a small bounded queue drained by this hosted service. A slow
/// or dead SMTP server therefore cannot slow the visitor's response, and — because a repeat submission
/// never mails and a first one only enqueues — response time cannot reveal whether an address was already
/// registered. The queue is in-memory: a notification still waiting when the process stops is lost (the
/// row itself is already stored), and a full queue drops the newest notification with a warning.
/// </summary>
public sealed class EarlyAccessNotifier : BackgroundService, IEarlyAccessNotifier
{
    public const string NotifyEmailKey = "EarlyAccess:NotifyEmail";
    public const string SmtpHostKey = "Notifications:Smtp:Host";

    private const int QueueCapacity = 50;
    private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(30);

    private readonly Channel<PendingNotification> _queue = Channel.CreateBounded<PendingNotification>(
        new BoundedChannelOptions(QueueCapacity)
        {
            // Wait, not DropWrite: with DropWrite TryWrite reports success while silently discarding the item, so a
            // full queue could not be detected. With Wait, TryWrite simply returns false when there is no room.
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
        });

    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _config;
    private readonly ILogger<EarlyAccessNotifier> _logger;

    public EarlyAccessNotifier(IServiceScopeFactory scopes, IConfiguration config, ILogger<EarlyAccessNotifier> logger)
    {
        _scopes = scopes;
        _config = config;
        _logger = logger;
    }

    /// <summary>Notifications queued and not yet picked up by the send loop.</summary>
    public int PendingCount => _queue.Reader.Count;

    public void NotifyNewRequest(EarlyAccessNotification notification)
    {
        var masked = EmailMasking.Mask(notification.Email);

        var recipient = _config[NotifyEmailKey]?.Trim();
        if (string.IsNullOrEmpty(recipient))
        {
            _logger.LogInformation(
                "Early-access request from {Email} stored; no notification sent ({Key} is not set)",
                masked, NotifyEmailKey);
            return;
        }

        if (string.IsNullOrWhiteSpace(_config[SmtpHostKey]))
        {
            _logger.LogInformation(
                "Early-access request from {Email} stored; no notification sent (SMTP is not configured: {Key} is not set)",
                masked, SmtpHostKey);
            return;
        }

        if (_queue.Writer.TryWrite(new PendingNotification(notification, recipient)))
            _logger.LogInformation("Early-access request from {Email} stored; notification queued", masked);
        else
            _logger.LogWarning("Early-access notification queue is full; notification for {Email} dropped", masked);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var pending in _queue.Reader.ReadAllAsync(stoppingToken))
                await SendAsync(pending.Notification, pending.Recipient, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Host is stopping; anything still queued is dropped (the rows are already stored).
        }
    }

    /// <summary>Sends one notification. Never throws (bar cancellation): a mail failure is logged and dropped.</summary>
    public async Task SendAsync(EarlyAccessNotification notification, string recipient, CancellationToken ct)
    {
        var masked = EmailMasking.Mask(notification.Email);
        try
        {
            using var scope = _scopes.CreateScope();
            var channel = scope.ServiceProvider.GetServices<INotificationChannel>()
                .FirstOrDefault(c => c.Kind == NotificationChannelKind.Email);
            if (channel is null)
            {
                _logger.LogWarning("No email notification channel is registered; early-access notification for {Email} not sent", masked);
                return;
            }

            var message = EarlyAccessRequestTemplate.Render(new EarlyAccessRequestPayload(
                recipient, notification.Name, notification.Organisation, notification.Email, notification.RequestedAtUtc));

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(SendTimeout);

            var result = await channel.SendAsync(message, timeout.Token);
            if (result.Outcome == ChannelSendOutcome.Sent)
                _logger.LogInformation("Early-access notification for {Email} sent", masked);
            else
                _logger.LogWarning("Early-access notification for {Email} not sent: {Outcome} ({Reason})",
                    masked, result.Outcome, result.Reason);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Early-access notification for {Email} failed", masked);
        }
    }

    private sealed record PendingNotification(EarlyAccessNotification Notification, string Recipient);
}
