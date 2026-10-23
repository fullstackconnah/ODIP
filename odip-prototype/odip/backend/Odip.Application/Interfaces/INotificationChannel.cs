using Odip.Domain.Notifications;

namespace Odip.Application.Interfaces;

public enum ChannelSendOutcome { Sent, Skipped, TransientFailure, PermanentFailure, NotSupported }

public record ChannelSendResult(ChannelSendOutcome Outcome, string? ProviderMessageId, string? Reason);

/// <summary>A calendar invite (RFC 5545 text) sent as a <c>text/calendar</c> alternate view. <see cref="Method"/> is the iTIP method its METHOD line declares: REQUEST or CANCEL.</summary>
public record IcsCalendar(string Method, string Content);

/// <summary>One email. <see cref="Ics"/> and <see cref="ReplyTo"/> are optional; without them the message is sent exactly as before.</summary>
public record NotificationMessage(string RecipientAddress, string Subject, string PlainTextBody, string HtmlBody, IcsCalendar? Ics = null, string? ReplyTo = null,
    string? OrganisationName = null);

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
