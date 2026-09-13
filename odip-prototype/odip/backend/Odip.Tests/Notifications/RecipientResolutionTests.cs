using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// LeaveRequestSubmitted's recipient resolution (PortalController.CreateMyLeaveRequest):
/// every Admin/Coordinator in the tenant, no SupportWorker/ReadOnly, no cross-tenant user.
/// Moq'd ICurrentTenant, same pattern StaffAssignmentGateTests.CreateDb uses.
/// </summary>
public class RecipientResolutionTests
{
    private static readonly DateOnly Today = new(2026, 9, 7);

    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static PortalController MakeController(OdipDbContext db, ICurrentTenant tenant, Guid callerUserId)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
        return new PortalController(db, tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId, UserRole role, bool isActive = true)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = role.ToString(), LastName = "User",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = role, IsActive = isActive,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task LeaveRequestSubmitted_RaisesForEveryAdminAndCoordinator_NotSupportWorkerOrReadOnly_NotCrossTenant()
    {
        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var (db, tenant) = CreateDb(tenantId);

        var requester = SeedUser(db, tenantId, UserRole.SupportWorker);
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        var coordinator = SeedUser(db, tenantId, UserRole.Coordinator);
        var readOnly = SeedUser(db, tenantId, UserRole.ReadOnly);
        var inactiveAdmin = SeedUser(db, tenantId, UserRole.Admin, isActive: false);
        var otherTenantAdmin = SeedUser(db, otherTenantId, UserRole.Admin);

        var controller = MakeController(db, tenant.Object, requester.Id);

        await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);

        var rows = await db.NotificationOutbox.ToListAsync();
        var recipientIds = rows.Select(r => r.RecipientUserId).ToList();

        Assert.Contains(admin.Id, recipientIds);
        Assert.Contains(coordinator.Id, recipientIds);
        Assert.DoesNotContain(readOnly.Id, recipientIds);
        Assert.DoesNotContain(requester.Id, recipientIds); // the requester isn't notified of their own request
        Assert.DoesNotContain(inactiveAdmin.Id, recipientIds);
        Assert.DoesNotContain(otherTenantAdmin.Id, recipientIds);
        Assert.All(rows, r => Assert.Equal(NotificationEventType.LeaveRequestSubmitted, r.EventType));
        Assert.Equal(2, rows.Count);
    }
}
