using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// A tick processing two tenants' rows tags NotificationOutbox/NotificationLog rows correctly
/// per tenant, and a normal tenant-scoped context never sees the other tenant's rows — proves
/// ScopedTenantOverride isolates rather than leaking superadmin visibility into written rows.
/// docs/specs/2026-09-08-notifications-design.md §3/Testing.
/// </summary>
public class ScopedTenantContextTests
{
    private static OdipDbContext SuperAdminDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static OdipDbContext TenantScopedDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static NotificationOutbox SeedOutboxRow(OdipDbContext db, Guid tenantId, Guid recipientId)
    {
        var payload = new ShiftAssignedPayload("irrelevant@example.com", "Alice Participant", new DateOnly(2026, 9, 10), new TimeOnly(9, 0), new TimeOnly(17, 0));
        var row = new NotificationOutbox
        {
            Id = Guid.NewGuid(), TenantId = tenantId, EventType = NotificationEventType.ShiftAssigned,
            EntityType = "Shift", EntityId = Guid.NewGuid(), RecipientUserId = recipientId,
            PayloadJson = System.Text.Json.JsonSerializer.Serialize(payload),
            Status = NotificationOutboxStatus.Pending, NextAttemptAt = DateTime.UtcNow.AddMinutes(-1),
            CreatedAt = DateTime.UtcNow.AddMinutes(-1),
        };
        db.NotificationOutbox.Add(row);
        db.SaveChanges();
        return row;
    }

    [Fact]
    public async Task Tick_ProcessingTwoTenants_TagsRowsToTheirOwnTenant_AndTenantScopedContextNeverSeesTheOther()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        Guid rowAId, rowBId;

        using (var db = SuperAdminDb(dbName))
        {
            var userA = SeedUser(db, tenantA);
            var userB = SeedUser(db, tenantB);
            rowAId = SeedOutboxRow(db, tenantA, userA.Id).Id;
            rowBId = SeedOutboxRow(db, tenantB, userB.Id).Id;
        }

        var channel = new Mock<INotificationChannel>();
        channel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        channel.Setup(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ChannelSendResult(ChannelSendOutcome.Sent, "msg-1", null));

        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(dbName));
        services.AddSingleton<INotificationChannel>(channel.Object);
        services.AddSingleton<INotificationChannel>(new SmsChannel());
        var provider = services.BuildServiceProvider();
        var scopeFactory = provider.GetRequiredService<IServiceScopeFactory>();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Notifications:Enabled"] = "true",
            ["Notifications:BatchSize"] = "50",
            ["Notifications:PublicBaseUrl"] = "https://odip.test",
        }).Build();
        var svc = new NotificationDispatchBackgroundService(scopeFactory, config, NullLogger<NotificationDispatchBackgroundService>.Instance);

        await svc.RunTickAsync(CancellationToken.None);

        // Verify via the superadmin-bypass context first — both rows sent, tagged to their own tenant.
        using (var verifyDb = SuperAdminDb(dbName))
        {
            var rowA = await verifyDb.NotificationOutbox.SingleAsync(o => o.Id == rowAId);
            var rowB = await verifyDb.NotificationOutbox.SingleAsync(o => o.Id == rowBId);
            Assert.Equal(NotificationOutboxStatus.Sent, rowA.Status);
            Assert.Equal(NotificationOutboxStatus.Sent, rowB.Status);
            Assert.Equal(tenantA, rowA.TenantId);
            Assert.Equal(tenantB, rowB.TenantId);

            var logA = await verifyDb.NotificationLogs.SingleAsync(l => l.OutboxId == rowAId);
            var logB = await verifyDb.NotificationLogs.SingleAsync(l => l.OutboxId == rowBId);
            Assert.Equal(tenantA, logA.TenantId);
            Assert.Equal(tenantB, logB.TenantId);
        }

        // A genuine tenant-A-scoped context sees only tenant A's outbox row and log, never tenant B's.
        using (var tenantADb = TenantScopedDb(dbName, tenantA))
        {
            var outboxRows = await tenantADb.NotificationOutbox.ToListAsync();
            Assert.Single(outboxRows);
            Assert.Equal(rowAId, outboxRows[0].Id);

            var logs = await tenantADb.NotificationLogs.ToListAsync();
            Assert.Single(logs);
            Assert.Equal(rowAId, logs[0].OutboxId);
        }
    }
}
