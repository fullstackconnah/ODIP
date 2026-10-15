using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Notifications;

/// <summary>
/// AdminNotificationsController — api/v1/admin/notifications (design spec §2). GET/retry/test-email.
/// </summary>
public class AdminNotificationsControllerTests
{
    private static OdipDbContext TenantScopedDb(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static OdipDbContext SuperAdminDb(string dbName) => TestDb.Create(dbName);

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

    private static NotificationOutbox SeedOutboxRow(OdipDbContext db, Guid tenantId, Guid recipientId, NotificationOutboxStatus status = NotificationOutboxStatus.Failed)
    {
        var payload = new ShiftAssignedPayload("irrelevant@example.com", "Alice Participant", new DateOnly(2026, 9, 10), new TimeOnly(9, 0), new TimeOnly(17, 0));
        var row = new NotificationOutbox
        {
            Id = Guid.NewGuid(), TenantId = tenantId, EventType = NotificationEventType.ShiftAssigned,
            EntityType = "Shift", EntityId = Guid.NewGuid(), RecipientUserId = recipientId,
            PayloadJson = System.Text.Json.JsonSerializer.Serialize(payload),
            Status = status, Attempts = status == NotificationOutboxStatus.Failed ? 5 : 0,
            LastError = status == NotificationOutboxStatus.Failed ? "SMTP down" : null,
            NextAttemptAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow,
        };
        db.NotificationOutbox.Add(row);
        db.SaveChanges();
        return row;
    }

    private static List<INotificationChannel> NoOpChannels() => new() { new Odip.Infrastructure.Notifications.SmsChannel() };

    [Fact]
    public async Task GetAll_ReturnsRowsForCallersTenant()
    {
        var tenantId = Guid.NewGuid();
        var db = TenantScopedDb(tenantId);
        var user = SeedUser(db, tenantId);
        SeedOutboxRow(db, tenantId, user.Id);

        var controller = new AdminNotificationsController(db, NoOpChannels());
        var result = await controller.GetAll(null, null, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<NotificationOutboxDto>>>(ok.Value);
        var row = Assert.Single(body.Data!);
        Assert.Equal("Ben Turner", row.RecipientName);
    }

    /// <summary>Mandatory cross-tenant negative test: an Admin (non-SuperAdmin) caller in tenant A must never see tenant B's outbox rows.</summary>
    [Fact]
    public async Task GetAll_NeverReturnsAnotherTenantsRows()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        using (var seedDb = SuperAdminDb(dbName))
        {
            var userA = SeedUser(seedDb, tenantA);
            var userB = SeedUser(seedDb, tenantB);
            SeedOutboxRow(seedDb, tenantA, userA.Id);
            SeedOutboxRow(seedDb, tenantB, userB.Id);
        }

        var tenantATenant = new Mock<ICurrentTenant>();
        tenantATenant.Setup(t => t.TenantId).Returns(tenantA);
        tenantATenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        using var dbAsTenantA = new OdipDbContext(options, tenantATenant.Object);

        var controller = new AdminNotificationsController(dbAsTenantA, NoOpChannels());
        var result = await controller.GetAll(null, null, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<NotificationOutboxDto>>>(ok.Value);
        var row = Assert.Single(body.Data!);
        Assert.Equal(tenantA, GetOutboxTenantId(dbAsTenantA, row.Id));
    }

    private static Guid GetOutboxTenantId(OdipDbContext db, Guid id) =>
        db.NotificationOutbox.Single(o => o.Id == id).TenantId;

    /// <summary>Mandatory cross-tenant negative test: retry on a cross-tenant id 404s (never 403) — same idiom as every other tenant-scoped lookup.</summary>
    [Fact]
    public async Task Retry_OnAnotherTenantsRow_Returns404NotFound()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        Guid rowBId;
        using (var seedDb = SuperAdminDb(dbName))
        {
            var userB = SeedUser(seedDb, tenantB);
            rowBId = SeedOutboxRow(seedDb, tenantB, userB.Id).Id;
        }

        var tenantATenant = new Mock<ICurrentTenant>();
        tenantATenant.Setup(t => t.TenantId).Returns(tenantA);
        tenantATenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        using var dbAsTenantA = new OdipDbContext(options, tenantATenant.Object);

        var controller = new AdminNotificationsController(dbAsTenantA, NoOpChannels());
        var result = await controller.Retry(rowBId, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Retry_OnFailedRow_ResetsToPendingAndReturns200()
    {
        var tenantId = Guid.NewGuid();
        var db = TenantScopedDb(tenantId);
        var user = SeedUser(db, tenantId);
        var row = SeedOutboxRow(db, tenantId, user.Id, NotificationOutboxStatus.Failed);

        var controller = new AdminNotificationsController(db, NoOpChannels());
        var result = await controller.Retry(row.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<NotificationOutboxDto>>(ok.Value);
        Assert.Equal(NotificationOutboxStatus.Pending, body.Data!.Status);
        Assert.Equal(0, body.Data.Attempts);
        Assert.Null(body.Data.LastError);

        var saved = await db.NotificationOutbox.SingleAsync(o => o.Id == row.Id);
        Assert.Equal(NotificationOutboxStatus.Pending, saved.Status);
    }

    [Fact]
    public async Task Retry_OnNonFailedRow_Returns409()
    {
        var tenantId = Guid.NewGuid();
        var db = TenantScopedDb(tenantId);
        var user = SeedUser(db, tenantId);
        var row = SeedOutboxRow(db, tenantId, user.Id, NotificationOutboxStatus.Sent);

        var controller = new AdminNotificationsController(db, NoOpChannels());
        var result = await controller.Retry(row.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<NotificationOutboxDto>>(conflict.Value);
        Assert.Contains("Only failed notifications can be retried.", body.Errors!);
    }

    [Fact]
    public async Task Retry_OnMissingId_Returns404()
    {
        var tenantId = Guid.NewGuid();
        var db = TenantScopedDb(tenantId);

        var controller = new AdminNotificationsController(db, NoOpChannels());
        var result = await controller.Retry(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task SendTestEmail_MalformedAddress_Returns400()
    {
        var db = TenantScopedDb(Guid.NewGuid());
        var controller = new AdminNotificationsController(db, NoOpChannels());

        var result = await controller.SendTestEmail(new SendTestEmailDto { To = "not-an-email" }, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<TestEmailResultDto>>(bad.Value);
        Assert.Contains("Enter a valid email address.", body.Errors!);
    }

    [Fact]
    public async Task SendTestEmail_ValidAddress_CallsEmailChannelDirectly_BypassingOutbox()
    {
        var db = TenantScopedDb(Guid.NewGuid());
        var emailChannel = new Mock<INotificationChannel>();
        emailChannel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        emailChannel.Setup(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ChannelSendResult(ChannelSendOutcome.Sent, "test-msg", null));

        var controller = new AdminNotificationsController(db, new List<INotificationChannel> { emailChannel.Object, new Odip.Infrastructure.Notifications.SmsChannel() });
        var result = await controller.SendTestEmail(new SendTestEmailDto { To = "someone@example.com" }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<TestEmailResultDto>>(ok.Value);
        Assert.True(body.Data!.Sent);
        Assert.Null(body.Data.Error);
        Assert.Empty(await db.NotificationOutbox.ToListAsync()); // bypasses the outbox entirely
        emailChannel.Verify(c => c.SendAsync(It.Is<NotificationMessage>(m => m.RecipientAddress == "someone@example.com"), It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>Not a 500 — a failed test is the endpoint's expected outcome, not a server error.</summary>
    [Fact]
    public async Task SendTestEmail_ChannelFails_Returns200WithSentFalse()
    {
        var db = TenantScopedDb(Guid.NewGuid());
        var emailChannel = new Mock<INotificationChannel>();
        emailChannel.SetupGet(c => c.Kind).Returns(NotificationChannelKind.Email);
        emailChannel.Setup(c => c.SendAsync(It.IsAny<NotificationMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ChannelSendResult(ChannelSendOutcome.Skipped, null, "SMTP is not configured"));

        var controller = new AdminNotificationsController(db, new List<INotificationChannel> { emailChannel.Object, new Odip.Infrastructure.Notifications.SmsChannel() });
        var result = await controller.SendTestEmail(new SendTestEmailDto { To = "someone@example.com" }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<TestEmailResultDto>>(ok.Value);
        Assert.False(body.Data!.Sent);
        Assert.Equal("SMTP is not configured", body.Data.Error);
    }
}
