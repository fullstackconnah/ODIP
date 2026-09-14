using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// NotificationsController — self-service preferences (design spec §2). GET/PUT
/// api/v1/notifications/preferences.
/// </summary>
public class NotificationsControllerTests
{
    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static NotificationsController MakeController(OdipDbContext db, Guid callerUserId)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
        return new NotificationsController(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
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

    [Fact]
    public async Task GetPreferences_NoRowsExist_ReturnsEveryEventTimesChannel_AllEnabledByDefault()
    {
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        var user = SeedUser(db, tenantId);
        var controller = MakeController(db, user.Id);

        var result = await controller.GetPreferences(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<NotificationPreferenceGridDto>>(ok.Value);
        var expectedRowCount = Enum.GetValues<NotificationEventType>().Length * Enum.GetValues<NotificationChannelKind>().Length;
        Assert.Equal(expectedRowCount, body.Data!.Rows.Count);
        Assert.All(body.Data.Rows, r => Assert.True(r.Enabled));
    }

    [Fact]
    public async Task PutPreferences_UpsertsCallersOwnRow_AndReflectsInSubsequentGet()
    {
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        var user = SeedUser(db, tenantId);
        var controller = MakeController(db, user.Id);

        var putResult = await controller.UpdatePreferences(
            new List<UpdateNotificationPreferenceDto>
            {
                new() { EventType = nameof(NotificationEventType.LeaveRequestSubmitted), Channel = nameof(NotificationChannelKind.Email), Enabled = false },
            },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(putResult.Result);
        var body = Assert.IsType<ApiResponse<NotificationPreferenceGridDto>>(ok.Value);
        var row = body.Data!.Rows.Single(r => r.EventType == NotificationEventType.LeaveRequestSubmitted && r.Channel == NotificationChannelKind.Email);
        Assert.False(row.Enabled);

        // Persisted, not just echoed — a fresh GET reflects it too.
        var getResult = await controller.GetPreferences(CancellationToken.None);
        var getOk = Assert.IsType<OkObjectResult>(getResult.Result);
        var getBody = Assert.IsType<ApiResponse<NotificationPreferenceGridDto>>(getOk.Value);
        var getRow = getBody.Data!.Rows.Single(r => r.EventType == NotificationEventType.LeaveRequestSubmitted && r.Channel == NotificationChannelKind.Email);
        Assert.False(getRow.Enabled);

        // The audit allow-list includes NotificationPreference — proves the row is a real
        // tracked entity, not some in-memory-only projection.
        var savedRow = await db.NotificationPreferences.SingleAsync(p => p.UserId == user.Id);
        Assert.False(savedRow.Enabled);
    }

    [Fact]
    public async Task PutPreferences_UnknownEventType_Returns400()
    {
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        var user = SeedUser(db, tenantId);
        var controller = MakeController(db, user.Id);

        var result = await controller.UpdatePreferences(
            new List<UpdateNotificationPreferenceDto> { new() { EventType = "NotARealEvent", Channel = "Email", Enabled = true } },
            CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<NotificationPreferenceGridDto>>(bad.Value);
        Assert.Contains("Unknown event type or channel.", body.Errors!);
    }

    [Fact]
    public async Task PutPreferences_UnknownChannel_Returns400()
    {
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        var user = SeedUser(db, tenantId);
        var controller = MakeController(db, user.Id);

        var result = await controller.UpdatePreferences(
            new List<UpdateNotificationPreferenceDto> { new() { EventType = "ShiftAssigned", Channel = "Fax", Enabled = true } },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    /// <summary>Mandatory cross-tenant negative test: tenant B's user setting their own preference must never be visible from, or overwritten by, tenant A's caller.</summary>
    [Fact]
    public async Task Preferences_AreScopedPerUser_TenantBsCustomisationNeverLeaksToTenantA()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantAId); // ambient context is tenant A throughout this test

        var userA = SeedUser(db, tenantAId);
        var userB = SeedUser(db, tenantBId);

        // Tenant B's own preference row exists directly in the store (as if written earlier by
        // B's own request) with a distinctive disabled value.
        db.NotificationPreferences.Add(new NotificationPreference
        {
            Id = Guid.NewGuid(), TenantId = tenantBId, UserId = userB.Id,
            EventType = NotificationEventType.LeaveRequestSubmitted, Channel = NotificationChannelKind.Email, Enabled = false,
        });
        await db.SaveChangesAsync();

        var controllerA = MakeController(db, userA.Id);
        var result = await controllerA.GetPreferences(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<NotificationPreferenceGridDto>>(ok.Value);
        // Tenant A's caller has no row of their own — sees the default (ON), never B's disabled override.
        var row = body.Data!.Rows.Single(r => r.EventType == NotificationEventType.LeaveRequestSubmitted && r.Channel == NotificationChannelKind.Email);
        Assert.True(row.Enabled);
    }
}
