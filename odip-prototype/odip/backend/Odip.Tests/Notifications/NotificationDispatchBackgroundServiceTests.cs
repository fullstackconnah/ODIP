using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Notifications;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Notifications;

/// <summary>
/// NotificationDispatchBackgroundService per-tick algorithm (design spec §3): preference gate,
/// kill switch, backoff schedule, dead-lettering after 5 attempts, permanent-failure handling.
/// </summary>
public class NotificationDispatchBackgroundServiceTests
{
    private static OdipDbContext SeedDb(string dbName) => TestDb.Create(dbName);

    private static User SeedUser(OdipDbContext db, Guid tenantId, string email = "")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = string.IsNullOrEmpty(email) ? $"{Guid.NewGuid()}@example.com" : email,
            Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static NotificationOutbox SeedOutboxRow(OdipDbContext db, Guid tenantId, Guid recipientId, int attempts = 0)
    {
        var payload = new ShiftAssignedPayload("irrelevant@example.com", "Alice Participant", new DateOnly(2026, 9, 10), new TimeOnly(9, 0), new TimeOnly(17, 0));
        var row = new NotificationOutbox
        {
            Id = Guid.NewGuid(), TenantId = tenantId, EventType = NotificationEventType.ShiftAssigned,
            EntityType = "Shift", EntityId = Guid.NewGuid(), RecipientUserId = recipientId,
            PayloadJson = System.Text.Json.JsonSerializer.Serialize(payload),
            Status = NotificationOutboxStatus.Pending, Attempts = attempts, NextAttemptAt = DateTime.UtcNow.AddMinutes(-1),
            CreatedAt = DateTime.UtcNow.AddMinutes(-1),
        };
        db.NotificationOutbox.Add(row);
        db.SaveChanges();
        return row;
    }

    private static NotificationDispatchBackgroundService BuildService(
        string dbName, INotificationChannel emailChannel, Dictionary<string, string?> configValues)
    {
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(dbName));
        services.AddSingleton<INotificationChannel>(emailChannel);
        services.AddSingleton<INotificationChannel>(new SmsChannel());
        var provider = services.BuildServiceProvider();
        var scopeFactory = provider.GetRequiredService<IServiceScopeFactory>();

        var config = new ConfigurationBuilder().AddInMemoryCollection(configValues).Build();
        return new NotificationDispatchBackgroundService(scopeFactory, config, NullLogger<NotificationDispatchBackgroundService>.Instance);
    }

    private static Dictionary<string, string?> BaseConfig() => new()
    {
        ["Notifications:Enabled"] = "true",
        ["Notifications:BatchSize"] = "50",
        ["Notifications:PublicBaseUrl"] = "https://odip.test",
    };

    [Fact]
    public async Task DisabledPreference_SkipsWithoutCallingSendAsync()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId);
            SeedOutboxRow(db, tenantId, user.Id);
            db.NotificationPreferences.Add(new NotificationPreference
            {
                Id = Guid.NewGuid(), TenantId = tenantId, UserId = user.Id,
                EventType = NotificationEventType.ShiftAssigned, Channel = NotificationChannelKind.Email, Enabled = false,
            });
            db.SaveChanges();
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        var svc = BuildService(dbName, channel.Object, BaseConfig());

        await svc.RunTickAsync(CancellationToken.None);

        channel.Verify(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()), Times.Never);
        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync();
        Assert.Equal(NotificationOutboxStatus.Skipped, row.Status);
        Assert.Equal("User preference disabled", row.LastError);
    }

    [Fact]
    public async Task KillSwitch_LeavesRowsPending_NeverInvokesSendAsync()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId);
            SeedOutboxRow(db, tenantId, user.Id);
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        var config = BaseConfig();
        config["Notifications:Enabled"] = "false";
        var svc = BuildService(dbName, channel.Object, config);

        await svc.RunTickAsync(CancellationToken.None);

        channel.Verify(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()), Times.Never);
        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync();
        Assert.Equal(NotificationOutboxStatus.Pending, row.Status);
    }

    [Fact]
    public async Task TransientFailure_IncrementsAttempts_SetsNextAttemptPerBackoffSchedule()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        Guid rowId;
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId);
            rowId = SeedOutboxRow(db, tenantId, user.Id).Id;
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        channel.Setup(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ChannelSendResult(ChannelSendOutcome.TransientFailure, null, "SMTP down"));
        var svc = BuildService(dbName, channel.Object, BaseConfig());

        var before = DateTime.UtcNow;
        await svc.RunTickAsync(CancellationToken.None);

        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync(o => o.Id == rowId);
        Assert.Equal(1, row.Attempts);
        Assert.Equal(NotificationOutboxStatus.Pending, row.Status);
        // backoff[1] = 1 minute
        Assert.InRange(row.NextAttemptAt, before.AddSeconds(50), before.AddSeconds(70));
        Assert.Equal("SMTP down", row.LastError);
    }

    [Fact]
    public async Task FifthTransientFailure_SetsFailedInsteadOfSchedulingASixthAttempt()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        Guid rowId;
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId);
            rowId = SeedOutboxRow(db, tenantId, user.Id, attempts: 4).Id;
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        channel.Setup(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ChannelSendResult(ChannelSendOutcome.TransientFailure, null, "SMTP down"));
        var svc = BuildService(dbName, channel.Object, BaseConfig());

        await svc.RunTickAsync(CancellationToken.None);

        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync(o => o.Id == rowId);
        Assert.Equal(5, row.Attempts);
        Assert.Equal(NotificationOutboxStatus.Failed, row.Status);
    }

    [Fact]
    public async Task PermanentFailure_SetsFailedOnFirstAttempt()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        Guid rowId;
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId);
            rowId = SeedOutboxRow(db, tenantId, user.Id).Id;
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        channel.Setup(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ChannelSendResult(ChannelSendOutcome.PermanentFailure, null, "Mailbox unavailable"));
        var svc = BuildService(dbName, channel.Object, BaseConfig());

        await svc.RunTickAsync(CancellationToken.None);

        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync(o => o.Id == rowId);
        Assert.Equal(0, row.Attempts);
        Assert.Equal(NotificationOutboxStatus.Failed, row.Status);
        Assert.Equal("Mailbox unavailable", row.LastError);
    }

    [Fact]
    public async Task Sent_MarksRowSentAndWritesNotificationLogRow()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        Guid rowId;
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId);
            rowId = SeedOutboxRow(db, tenantId, user.Id).Id;
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        channel.Setup(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ChannelSendResult(ChannelSendOutcome.Sent, "provider-msg-1", null));
        var svc = BuildService(dbName, channel.Object, BaseConfig());

        await svc.RunTickAsync(CancellationToken.None);

        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync(o => o.Id == rowId);
        Assert.Equal(NotificationOutboxStatus.Sent, row.Status);
        Assert.NotNull(row.SentAt);

        var log = await verifyDb.NotificationLogs.SingleAsync(l => l.OutboxId == rowId);
        Assert.Equal("provider-msg-1", log.ProviderMessageId);
        Assert.Equal(NotificationChannelKind.Email, log.Channel);
    }

    [Fact]
    public async Task RecipientNotFound_SkipsWithReason()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        Guid rowId;
        using (var db = SeedDb(dbName))
        {
            // No user seeded for this recipient id — deleted/never-existed edge case.
            rowId = SeedOutboxRow(db, tenantId, Guid.NewGuid()).Id;
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        var svc = BuildService(dbName, channel.Object, BaseConfig());

        await svc.RunTickAsync(CancellationToken.None);

        channel.Verify(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()), Times.Never);
        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync(o => o.Id == rowId);
        Assert.Equal(NotificationOutboxStatus.Skipped, row.Status);
        Assert.Equal("Recipient not found", row.LastError);
    }

    [Fact]
    public async Task RecipientWithNoEmailAddress_SkipsWithReason()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        Guid rowId;
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId, email: "");
            user.Email = string.Empty; // Users.Email is non-nullable — "no email" means empty string
            db.SaveChanges();
            rowId = SeedOutboxRow(db, tenantId, user.Id).Id;
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        var svc = BuildService(dbName, channel.Object, BaseConfig());

        await svc.RunTickAsync(CancellationToken.None);

        channel.Verify(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()), Times.Never);
        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync(o => o.Id == rowId);
        Assert.Equal(NotificationOutboxStatus.Skipped, row.Status);
        Assert.Equal("Recipient has no email address", row.LastError);
    }

    [Fact]
    public async Task An_intake_visit_for_a_name_with_a_line_break_never_throws_out_of_the_tick()
    {
        // Fix round 1, S1: an enquiry name can hold an embedded CR/LF (the API only trims). Through the real SMTP channel the tick must finish.
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId, "sam.lee@provider.example");
            var payload = new IntakeVisitStaffPayload(IntakeWording.Booked, "sam.lee@provider.example", "Sam Lee", "Noah\r\nFitzgerald",
                new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc), 90, "Australia/Sydney", "12 Smith St", null, null, null, "Dana Smith",
                "dana@provider.example", "Sample Support Co", null, null, "abc@odip", 0, DateTime.UtcNow);
            db.NotificationOutbox.Add(new NotificationOutbox
            {
                Id = Guid.NewGuid(), TenantId = tenantId, EventType = NotificationEventType.IntakeBooked, EntityType = "IntakeVisit", EntityId = Guid.NewGuid(),
                RecipientUserId = user.Id, PayloadJson = System.Text.Json.JsonSerializer.Serialize(payload),
                Status = NotificationOutboxStatus.Pending, NextAttemptAt = DateTime.UtcNow.AddMinutes(-1), CreatedAt = DateTime.UtcNow.AddMinutes(-1),
            });
            db.SaveChanges();
        }
        var smtpConfig = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Notifications:Smtp:Host"] = "127.0.0.1", ["Notifications:Smtp:Port"] = "1",
        }).Build();
        var channel = new SmtpEmailChannel(smtpConfig, NullLogger<SmtpEmailChannel>.Instance);

        await BuildService(dbName, channel, BaseConfig()).RunTickAsync(CancellationToken.None);

        // The tick finished and saved: the row was tried once and backs off (no SMTP listens on port 1), instead of the batch going unsaved.
        using var verifyDb = SeedDb(dbName);
        var row = await verifyDb.NotificationOutbox.SingleAsync();
        Assert.Equal(1, row.Attempts);
        Assert.True(row.NextAttemptAt > DateTime.UtcNow);
    }

    [Fact]
    public async Task An_intake_visit_row_renders_with_its_calendar_invite_and_is_sent()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        using (var db = SeedDb(dbName))
        {
            var user = SeedUser(db, tenantId, "sam.lee@provider.example");
            var payload = new IntakeVisitStaffPayload(IntakeWording.Booked, "sam.lee@provider.example", "Sam Lee", "Noah Fitzgerald",
                new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc), 90, "Australia/Sydney", "12 Smith St", null, null, null, "Dana Smith",
                "dana@provider.example", "Sample Support Co", null, null, "abc@odip", 0, DateTime.UtcNow);
            db.NotificationOutbox.Add(new NotificationOutbox
            {
                Id = Guid.NewGuid(), TenantId = tenantId, EventType = NotificationEventType.IntakeBooked, EntityType = "IntakeVisit", EntityId = Guid.NewGuid(),
                RecipientUserId = user.Id, PayloadJson = System.Text.Json.JsonSerializer.Serialize(payload),
                Status = NotificationOutboxStatus.Pending, NextAttemptAt = DateTime.UtcNow.AddMinutes(-1), CreatedAt = DateTime.UtcNow.AddMinutes(-1),
            });
            db.SaveChanges();
        }
        NotificationMessage? sent = null;
        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        channel.Setup(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()))
            .Callback<NotificationMessage, CancellationToken>((m, _) => sent = m)
            .ReturnsAsync(new ChannelSendResult(ChannelSendOutcome.Sent, null, null));

        await BuildService(dbName, channel.Object, BaseConfig()).RunTickAsync(CancellationToken.None);

        using var verifyDb = SeedDb(dbName);
        Assert.Equal(NotificationOutboxStatus.Sent, (await verifyDb.NotificationOutbox.SingleAsync()).Status);
        Assert.Equal("Intake visit booked: Noah Fitzgerald, Fri 16 Oct at 10:00 am", sent!.Subject);
        Assert.Equal("REQUEST", sent.Ics!.Method);
    }
}
