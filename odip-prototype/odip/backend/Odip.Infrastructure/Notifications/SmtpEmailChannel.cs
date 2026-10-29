using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Notifications.Templates;

namespace Odip.Infrastructure.Notifications;

/// <summary>
/// Sends email via SMTP.
///
/// IMPLEMENTATION NOTE: the approved design (docs/specs/2026-09-08-notifications-design.md §3)
/// names MailKit/MimeKit. This sandbox's NuGet access proved unreliable — `dotnet add
/// Odip.Infrastructure package MailKit` failed twice (BouncyCastle.Cryptography transitive
/// dependency download errors), so this channel is built on the built-in
/// <see cref="System.Net.Mail.SmtpClient"/> instead, behind the same <see cref="INotificationChannel"/>
/// interface. All config keys below match the spec exactly, so swapping to MailKit later is a
/// one-file change (this file only) — no interface, DI registration, or config change needed.
///
/// Reads config via direct <see cref="IConfiguration"/> lookups — the same idiom
/// HolidaySyncBackgroundService uses, no IOptions&lt;T&gt; binding anywhere in this codebase.
/// No-ops (logs + returns Skipped) when <c>Notifications:Smtp:Host</c> isn't configured, so
/// dev/test environments never attempt a real send.
/// </summary>
public sealed class SmtpEmailChannel : INotificationChannel
{
    private readonly IConfiguration _config;
    private readonly ILogger<SmtpEmailChannel> _logger;

    public SmtpEmailChannel(IConfiguration config, ILogger<SmtpEmailChannel> logger)
    {
        _config = config;
        _logger = logger;
    }

    public NotificationChannelKind Kind => NotificationChannelKind.Email;

    public async Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct)
    {
        var host = _config.GetValue<string>("Notifications:Smtp:Host");
        if (string.IsNullOrWhiteSpace(host))
        {
            _logger.LogInformation(
                "SMTP not configured (Notifications:Smtp:Host missing) — skipping send to {Recipient}",
                message.RecipientAddress);
            return new ChannelSendResult(ChannelSendOutcome.Skipped, null, "SMTP is not configured");
        }

        // A malformed address can never succeed: fail it now rather than as a transient error the outbox retries.
        if (!MailAddress.TryCreate(message.RecipientAddress, out _))
        {
            _logger.LogWarning("Recipient address {Recipient} is not a valid email address — not sent", message.RecipientAddress);
            return new ChannelSendResult(ChannelSendOutcome.PermanentFailure, null, $"{message.RecipientAddress} isn't a valid email address");
        }

        var port = _config.GetValue("Notifications:Smtp:Port", 587);
        var user = _config.GetValue<string>("Notifications:Smtp:User");
        var password = _config.GetValue<string>("Notifications:Smtp:Password");
        var from = _config.GetValue<string>("Notifications:Smtp:From") ?? user ?? "no-reply@odip.local";
        var enableSsl = _config.GetValue("Notifications:Smtp:EnableSsl", true);

        using var client = new SmtpClient(host, port) { EnableSsl = enableSsl };
        if (!string.IsNullOrEmpty(user))
            client.Credentials = new NetworkCredential(user, password);

        try
        {
            // Built inside the try: MailMessage throws on a line break in a header, and that must be a failed send, not a throw out of the tick.
            using var mail = BuildMailMessage(message, from);
            await client.SendMailAsync(mail, ct);
            return new ChannelSendResult(ChannelSendOutcome.Sent, null, null);
        }
        catch (SmtpFailedRecipientException ex)
        {
            // The recipient's mailbox itself rejected the message (bad address, mailbox
            // unavailable) — a 4xx-shaped failure the spec classifies PermanentFailure since
            // retrying won't help.
            _logger.LogWarning(ex, "SMTP permanent failure sending to {Recipient}", message.RecipientAddress);
            return new ChannelSendResult(ChannelSendOutcome.PermanentFailure, null, ex.Message);
        }
        catch (SmtpException ex)
        {
            // Any other SMTP-protocol failure (connection refused, auth failure, generic 5xx) —
            // classified TransientFailure conservatively per the spec, so a config problem
            // surfaces as repeated visible failures rather than a single silent drop.
            _logger.LogWarning(ex, "SMTP transient failure sending to {Recipient}", message.RecipientAddress);
            return new ChannelSendResult(ChannelSendOutcome.TransientFailure, null, ex.Message);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Bad host, TLS negotiation, unexpected socket errors — same conservative
            // TransientFailure classification as above.
            _logger.LogWarning(ex, "Unexpected error sending email to {Recipient}", message.RecipientAddress);
            return new ChannelSendResult(ChannelSendOutcome.TransientFailure, null, ex.Message);
        }
    }

    /// <summary>
    /// The message as sent: the plain-text body, an HTML alternate view and, when the message carries one, a <c>text/calendar</c> view whose
    /// <c>method</c> parameter matches the calendar's METHOD (mail apps show it as an invite card). A Reply-To goes in only when it parses as an
    /// address, so a blank or malformed coordinator email can never turn a send into an exception. Public so tests can read the views.
    /// A bare From address goes out as "Bunya Support", and the HTML view opens with the wordmark header (<see cref="EmailLayout"/>).
    /// </summary>
    public static MailMessage BuildMailMessage(NotificationMessage message, string from)
    {
        var mail = new MailMessage(from, message.RecipientAddress, message.Subject, message.PlainTextBody);
        if (mail.From!.DisplayName.Length == 0) mail.From = new MailAddress(mail.From.Address, EmailLayout.SenderName);
        var html = AlternateView.CreateAlternateViewFromString(EmailLayout.WithHeader(message.HtmlBody, message.OrganisationName), null, "text/html");
        html.LinkedResources.Add(EmailLayout.WordmarkImage());
        mail.AlternateViews.Add(html);
        if (message.Ics is { } ics)
            mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(ics.Content, new ContentType($"text/calendar; method={ics.Method}; charset=UTF-8")));
        if (MailAddress.TryCreate(message.ReplyTo, out var replyTo))
            mail.ReplyToList.Add(replyTo);
        return mail;
    }
}
