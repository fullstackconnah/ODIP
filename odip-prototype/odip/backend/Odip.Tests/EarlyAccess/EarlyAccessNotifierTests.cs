using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.EarlyAccess;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// The operator email is opt-in: it goes out only when BOTH EarlyAccess:NotifyEmail and Notifications:Smtp:Host
/// are configured, through the existing email channel. Everything else stores the request and logs one masked
/// Information line.
/// </summary>
public class EarlyAccessNotifierTests
{
    private const string Payload = "<script>alert(1)</script>\"><img src=x>";

    private static readonly EarlyAccessNotification Sample =
        new("Jane Citizen", "Sample Support Co", "jane.citizen@example.com", new DateTime(2026, 9, 15, 13, 5, 0, DateTimeKind.Utc));

    private sealed class RecordingChannel : INotificationChannel
    {
        private readonly TaskCompletionSource<NotificationMessage> _first = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _calls;

        public NotificationChannelKind Kind { get; init; } = NotificationChannelKind.Email;
        public Func<NotificationMessage, ChannelSendResult> Respond { get; init; } =
            _ => new ChannelSendResult(ChannelSendOutcome.Sent, null, null);
        public int Calls => Volatile.Read(ref _calls);
        public Task<NotificationMessage> FirstMessage => _first.Task;

        public Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct)
        {
            Interlocked.Increment(ref _calls);
            _first.TrySetResult(message);
            return Task.FromResult(Respond(message));
        }
    }

    private static (EarlyAccessNotifier notifier, CapturingLogger<EarlyAccessNotifier> log) Build(
        Dictionary<string, string?> config, params INotificationChannel[] channels)
    {
        var services = new ServiceCollection();
        foreach (var channel in channels)
            services.AddScoped(_ => channel);
        var provider = services.BuildServiceProvider();

        var log = new CapturingLogger<EarlyAccessNotifier>();
        var notifier = new EarlyAccessNotifier(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new ConfigurationBuilder().AddInMemoryCollection(config).Build(),
            log);
        return (notifier, log);
    }

    private static Dictionary<string, string?> Configured(string? notifyEmail = "ops@example.com", string? smtpHost = "smtp.example.com") => new()
    {
        ["EarlyAccess:NotifyEmail"] = notifyEmail,
        ["Notifications:Smtp:Host"] = smtpHost,
    };

    // ── Sent only when configured ──────────────────────────────

    [Fact]
    public async Task NotConfigured_QueuesNothing_SendsNothing_AndLogsOneMaskedInfoLine()
    {
        var channel = new RecordingChannel();
        var (notifier, log) = Build(new Dictionary<string, string?>(), channel);

        notifier.NotifyNewRequest(Sample);
        await RunUntilDrained(notifier);

        Assert.Equal(0, notifier.PendingCount);
        Assert.Equal(0, channel.Calls);
        var line = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("j***@example.com", line.Message);
        Assert.DoesNotContain("jane.citizen@example.com", line.Message);
        Assert.DoesNotContain("Jane Citizen", line.Message);
        Assert.Contains("EarlyAccess:NotifyEmail", line.Message);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task BlankNotifyEmail_CountsAsNotConfigured(string? blank)
    {
        var channel = new RecordingChannel();
        var (notifier, _) = Build(Configured(notifyEmail: blank), channel);

        notifier.NotifyNewRequest(Sample);
        await RunUntilDrained(notifier);

        Assert.Equal(0, notifier.PendingCount);
        Assert.Equal(0, channel.Calls);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData(null)]
    public async Task NotifyEmailSet_ButSmtpNotConfigured_SendsNothing(string? smtpHost)
    {
        var channel = new RecordingChannel();
        var (notifier, log) = Build(Configured(smtpHost: smtpHost), channel);

        notifier.NotifyNewRequest(Sample);
        await RunUntilDrained(notifier);

        Assert.Equal(0, notifier.PendingCount);
        Assert.Equal(0, channel.Calls);
        var line = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("SMTP is not configured", line.Message);
        Assert.Contains("j***@example.com", line.Message);
        Assert.DoesNotContain("jane.citizen@example.com", line.Message);
    }

    [Fact]
    public async Task Configured_SendsOneEmail_ThroughTheEmailChannel_WithTheFixedSubject()
    {
        var email = new RecordingChannel();
        var sms = new RecordingChannel { Kind = NotificationChannelKind.Sms };
        var (notifier, log) = Build(Configured(notifyEmail: " ops@example.com "), sms, email);

        notifier.NotifyNewRequest(Sample);
        Assert.Equal(1, notifier.PendingCount);          // queued, not sent inline
        Assert.Equal(0, email.Calls);

        var message = await RunUntilFirstSend(notifier, email);

        Assert.Equal(1, email.Calls);
        Assert.Equal(0, sms.Calls);
        Assert.Equal("ops@example.com", message.RecipientAddress);
        Assert.Equal("New Odip early-access request", message.Subject);
        Assert.Contains("Jane Citizen", message.PlainTextBody);
        Assert.Contains("Sample Support Co", message.PlainTextBody);
        Assert.Contains("jane.citizen@example.com", message.PlainTextBody);
        Assert.Contains("15 Sep 2026 1:05 PM UTC", message.PlainTextBody);
        Assert.Contains("Jane Citizen", message.HtmlBody);
        Assert.DoesNotContain(log.Entries, e => e.Level >= LogLevel.Warning);
    }

    [Fact]
    public async Task Configured_TwoRequests_SendTwoEmails_InOrder()
    {
        var channel = new RecordingChannel();
        var (notifier, _) = Build(Configured(), channel);

        notifier.NotifyNewRequest(Sample);
        notifier.NotifyNewRequest(Sample with { Email = "second@example.com" });
        await RunUntilDrained(notifier);

        Assert.Equal(2, channel.Calls);
    }

    // ── Failure is contained ───────────────────────────────────

    [Theory]
    [InlineData(ChannelSendOutcome.Skipped)]
    [InlineData(ChannelSendOutcome.TransientFailure)]
    [InlineData(ChannelSendOutcome.PermanentFailure)]
    public async Task ChannelReportsNotSent_IsLoggedAsAWarning_NotThrown(ChannelSendOutcome outcome)
    {
        var channel = new RecordingChannel { Respond = _ => new ChannelSendResult(outcome, null, "boom") };
        var (notifier, log) = Build(Configured(), channel);

        notifier.NotifyNewRequest(Sample);
        await RunUntilDrained(notifier);

        Assert.Equal(1, channel.Calls);
        Assert.Contains(log.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("j***@example.com"));
    }

    [Fact]
    public async Task ChannelThrows_IsSwallowed_AndLaterNotificationsStillSend()
    {
        var calls = 0;
        var channel = new RecordingChannel
        {
            Respond = _ => ++calls == 1 ? throw new InvalidOperationException("smtp exploded") : new ChannelSendResult(ChannelSendOutcome.Sent, null, null),
        };
        var (notifier, log) = Build(Configured(), channel);

        notifier.NotifyNewRequest(Sample);
        notifier.NotifyNewRequest(Sample with { Email = "second@example.com" });
        await RunUntilDrained(notifier);

        Assert.Equal(2, channel.Calls);
        Assert.Contains(log.Entries, e => e.Level == LogLevel.Warning);
    }

    [Fact]
    public async Task NoEmailChannelRegistered_IsLogged_NotThrown()
    {
        var (notifier, log) = Build(Configured(), new RecordingChannel { Kind = NotificationChannelKind.Sms });

        notifier.NotifyNewRequest(Sample);
        await RunUntilDrained(notifier);

        Assert.Contains(log.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("No email notification channel"));
    }

    [Fact]
    public void FullQueue_DropsTheNewest_WithAWarning_AndNeverThrows()
    {
        var (notifier, log) = Build(Configured(), new RecordingChannel());

        for (var i = 0; i < 80; i++)
            notifier.NotifyNewRequest(Sample with { Email = $"person{i}@example.com" });

        Assert.Equal(50, notifier.PendingCount);
        Assert.Contains(log.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("queue is full"));
    }

    // ── The email body is built from visitor text ──────────────

    [Fact]
    public async Task VisitorTextInTheEmail_IsHtmlEncoded_AndNeverReachesTheSubject()
    {
        var channel = new RecordingChannel();
        var (notifier, _) = Build(Configured(), channel);

        notifier.NotifyNewRequest(new EarlyAccessNotification(Payload, Payload, "a" + Payload.Replace(" ", "") + "@example.com", DateTime.UtcNow));
        var message = await RunUntilFirstSend(notifier, channel);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.DoesNotContain("<img", message.HtmlBody);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x&gt;", message.HtmlBody);
        Assert.Equal(EarlyAccessRequestTemplate.Subject, message.Subject);
    }

    // ── Helpers ────────────────────────────────────────────────

    /// <summary>Starts the hosted service, waits for the queue to be drained, then stops it (which waits for the send in progress).</summary>
    private static async Task RunUntilDrained(EarlyAccessNotifier notifier)
    {
        await notifier.StartAsync(CancellationToken.None);
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (notifier.PendingCount > 0 && DateTime.UtcNow < deadline)
            await Task.Delay(10);
        // Everything is dequeued. StopAsync waits for the loop to finish its current iteration, so the last send
        // (and its logging) is complete when it returns; cancellation is only observed between iterations.
        await notifier.StopAsync(CancellationToken.None);
    }

    private static async Task<NotificationMessage> RunUntilFirstSend(EarlyAccessNotifier notifier, RecordingChannel channel)
    {
        await notifier.StartAsync(CancellationToken.None);
        try
        {
            return await channel.FirstMessage.WaitAsync(TimeSpan.FromSeconds(10));
        }
        finally
        {
            await notifier.StopAsync(CancellationToken.None);
        }
    }
}

public class EarlyAccessRequestTemplateTests
{
    private const string Payload = "<script>alert(1)</script>\"><img src=x>";
    private const string Encoded = "&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x&gt;";

    [Fact]
    public void Render_EncodesEveryVisitorField_InTheHtmlBody()
    {
        var message = EarlyAccessRequestTemplate.Render(new EarlyAccessRequestPayload(
            "ops@example.com", Payload, Payload, Payload, new DateTime(2026, 9, 15, 13, 5, 0, DateTimeKind.Utc)));

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.DoesNotContain("<img", message.HtmlBody);
        // One encoded copy per user-controlled field: name, organisation, email.
        Assert.Equal(3, message.HtmlBody.Split(Encoded).Length - 1);
    }

    [Fact]
    public void Render_UsesAFixedSubject_AndTheConfiguredRecipient()
    {
        var message = EarlyAccessRequestTemplate.Render(new EarlyAccessRequestPayload(
            "ops@example.com", Payload, Payload, "a@example.com", DateTime.UtcNow));

        Assert.Equal("New Odip early-access request", message.Subject);
        Assert.Equal("ops@example.com", message.RecipientAddress);
        Assert.DoesNotContain("script", message.Subject);
    }

    // SkippableFact: under the deploy image's invariant globalization a non-invariant culture cannot be created.
    [SkippableFact]
    public void Render_FormatsTheTimestampCultureInvariantly()
    {
        System.Globalization.CultureInfo? french = null;
        try { french = new System.Globalization.CultureInfo("fr-FR"); }
        catch (System.Globalization.CultureNotFoundException) { }
        Skip.If(french is null, "fr-FR is not available under invariant globalization");

        var original = Thread.CurrentThread.CurrentCulture;
        try
        {
            // French renders September as "sept."; the deploy image's invariant globalization renders "Sep".
            Thread.CurrentThread.CurrentCulture = french!;
            var message = EarlyAccessRequestTemplate.Render(new EarlyAccessRequestPayload(
                "ops@example.com", "Jane", "Org", "jane@example.com", new DateTime(2026, 9, 15, 13, 5, 0, DateTimeKind.Utc)));

            Assert.Contains("15 Sep 2026 1:05 PM UTC", message.PlainTextBody);
            Assert.Contains("15 Sep 2026 1:05 PM UTC", message.HtmlBody);
        }
        finally
        {
            Thread.CurrentThread.CurrentCulture = original;
        }
    }
}
