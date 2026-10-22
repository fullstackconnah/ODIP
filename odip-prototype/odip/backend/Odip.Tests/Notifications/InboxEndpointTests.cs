using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// The bell's endpoints (dashboard spec 2026-10-14): GET api/v1/notifications/inbox, POST .../inbox/{id}/read and
/// POST .../inbox/read-all. Own rows only, by the JWT subject, inside the tenant filter, and never X-View-As-User's.
/// </summary>
public class InboxEndpointTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    /// <summary>One InMemory store, seen through a context scoped as the caller's request would be.</summary>
    private static OdipDbContext Context(string store, Guid? tenantId, bool superAdmin = false, Guid? viewAsUserId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        tenant.Setup(t => t.ViewAsUserId).Returns(viewAsUserId);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(store).Options, tenant.Object);
    }

    private static NotificationsController Controller(OdipDbContext db, Guid? callerId)
    {
        var claims = callerId is null ? Array.Empty<Claim>() : new[] { new Claim(ClaimTypes.NameIdentifier, callerId.Value.ToString()) };
        return new NotificationsController(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")) },
            },
        };
    }

    private static InAppNotification Row(Guid tenantId, Guid recipientId, int minutesAgo, bool read = false) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, RecipientUserId = recipientId, EventType = NotificationEventType.ShiftAssigned,
        EntityType = "Shift", EntityId = Guid.NewGuid(), Title = $"{minutesAgo} min", LinkTo = "/portal",
        CreatedAt = DateTime.UtcNow.AddMinutes(-minutesAgo), ReadAt = read ? DateTime.UtcNow.AddMinutes(-minutesAgo + 1) : null,
    };

    private static string Seed(params InAppNotification[] rows)
    {
        var store = Guid.NewGuid().ToString();
        using var admin = Context(store, null, superAdmin: true);
        admin.InAppNotifications.AddRange(rows);
        admin.SaveChanges();
        return store;
    }

    private static InboxDto Body(ActionResult<ApiResponse<InboxDto>> result) =>
        Assert.IsType<ApiResponse<InboxDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [Fact]
    public async Task GetInbox_IsTheCallersOwnRows_NewestFirst_WithTheUnreadCountOverAllOfThem()
    {
        var me = Guid.NewGuid();
        var colleague = Guid.NewGuid();
        var newest = Row(TenantA, me, 1);
        var middle = Row(TenantA, me, 5, read: true);
        var oldest = Row(TenantA, me, 60);
        using var db = Context(Seed(oldest, newest, middle, Row(TenantA, colleague, 2), Row(TenantA, colleague, 3)), TenantA);

        var inbox = Body(await Controller(db, me).GetInbox(30, CancellationToken.None));

        Assert.Equal(new[] { newest.Id, middle.Id, oldest.Id }, inbox.Items.Select(i => i.Id));
        Assert.Equal(2, inbox.UnreadCount);
        Assert.False(inbox.HasMore);
        Assert.Equal("1 min", inbox.Items[0].Title);
        Assert.Equal("/portal", inbox.Items[0].LinkTo);
        Assert.Null(inbox.Items[0].ReadAt);
        Assert.NotNull(inbox.Items[1].ReadAt);
    }

    /// <summary>Mandatory cross-tenant negative test: another organisation's row is never returned, even one keyed to the same user id.</summary>
    [Fact]
    public async Task GetInbox_NeverReturnsAnotherOrganisationsRow()
    {
        var me = Guid.NewGuid();
        var mine = Row(TenantA, me, 1);
        using var db = Context(Seed(mine, Row(TenantB, me, 2), Row(TenantB, Guid.NewGuid(), 3)), TenantA);

        var inbox = Body(await Controller(db, me).GetInbox(30, CancellationToken.None));

        Assert.Equal(mine.Id, Assert.Single(inbox.Items).Id);
        Assert.Equal(1, inbox.UnreadCount);
    }

    /// <summary>Review Focus 4: "Showing the latest 30." appears only when there are more than 30.</summary>
    [Fact]
    public async Task GetInbox_HasMoreIsFalseAtExactlyTake_AndTrueAtTakePlusOne_AndTakeIsClamped()
    {
        var me = Guid.NewGuid();
        InAppNotification[] Rows(int n) => Enumerable.Range(1, n).Select(i => Row(TenantA, me, i)).ToArray();

        using (var db = Context(Seed(Rows(30)), TenantA))
        {
            var inbox = Body(await Controller(db, me).GetInbox(30, CancellationToken.None));
            Assert.Equal(30, inbox.Items.Count);
            Assert.False(inbox.HasMore);
        }

        using (var db = Context(Seed(Rows(31)), TenantA))
        {
            var controller = Controller(db, me);
            var inbox = Body(await controller.GetInbox(30, CancellationToken.None));
            Assert.Equal(30, inbox.Items.Count);
            Assert.True(inbox.HasMore);
            Assert.Equal(31, inbox.UnreadCount);
            Assert.Single(Body(await controller.GetInbox(0, CancellationToken.None)).Items);            // clamped up to 1
            Assert.Equal(31, Body(await controller.GetInbox(500, CancellationToken.None)).Items.Count);  // clamped to 50; all 31 fit
        }
    }

    [Fact]
    public async Task GetInbox_ForASuperAdminWithNoTenantFilter_IsStillOnlyTheirOwnRows()
    {
        using var db = Context(Seed(Row(TenantA, Guid.NewGuid(), 1), Row(TenantB, Guid.NewGuid(), 2)), null, superAdmin: true);

        var inbox = Body(await Controller(db, Guid.NewGuid()).GetInbox(30, CancellationToken.None));

        Assert.Empty(inbox.Items);
        Assert.Equal(0, inbox.UnreadCount);
    }

    /// <summary>Lead decision 1: under X-View-As-User the inbox is still the JWT subject's, and the viewed user's rows can't be marked.</summary>
    [Fact]
    public async Task UnderViewAs_TheInboxIsTheCallersOwn_AndTheViewedUsersRowCannotBeMarked()
    {
        var viewed = Guid.NewGuid();
        var theirs = Row(TenantA, viewed, 1);
        var store = Seed(theirs);
        // X-View-As-Tenant plus X-View-As-User: IsSuperAdmin is false and TenantId is the viewed organisation (CurrentTenant).
        using (var db = Context(store, TenantA, viewAsUserId: viewed))
        {
            var controller = Controller(db, Guid.NewGuid());
            Assert.Empty(Body(await controller.GetInbox(30, CancellationToken.None)).Items);
            Assert.IsType<NotFoundObjectResult>(await controller.MarkInboxRead(theirs.Id, CancellationToken.None));
            Assert.IsType<NoContentResult>(await controller.MarkAllInboxRead(null, CancellationToken.None));
        }

        using var check = Context(store, null, superAdmin: true);
        Assert.Null((await check.InAppNotifications.SingleAsync()).ReadAt);
    }

    [Fact]
    public async Task MarkInboxRead_MarksTheCallersRow_AndKeepsTheFirstReadAt()
    {
        var me = Guid.NewGuid();
        var row = Row(TenantA, me, 5);
        var store = Seed(row);
        DateTime? first;
        using (var db = Context(store, TenantA))
        {
            Assert.IsType<NoContentResult>(await Controller(db, me).MarkInboxRead(row.Id, CancellationToken.None));
            first = (await db.InAppNotifications.SingleAsync()).ReadAt;
            Assert.NotNull(first);
        }

        using (var db = Context(store, TenantA))
        {
            Assert.IsType<NoContentResult>(await Controller(db, me).MarkInboxRead(row.Id, CancellationToken.None));
            Assert.Equal(first, (await db.InAppNotifications.SingleAsync()).ReadAt);
        }
    }

    [Fact]
    public async Task MarkInboxRead_IsNotFound_ForAColleaguesRow_AndForAnotherOrganisationsRow()
    {
        var me = Guid.NewGuid();
        var colleagues = Row(TenantA, Guid.NewGuid(), 1);
        var otherOrganisation = Row(TenantB, me, 2);
        var store = Seed(colleagues, otherOrganisation);
        using (var db = Context(store, TenantA))
        {
            var controller = Controller(db, me);
            Assert.IsType<NotFoundObjectResult>(await controller.MarkInboxRead(colleagues.Id, CancellationToken.None));
            Assert.IsType<NotFoundObjectResult>(await controller.MarkInboxRead(otherOrganisation.Id, CancellationToken.None));
        }

        using var check = Context(store, null, superAdmin: true);
        Assert.All(await check.InAppNotifications.ToListAsync(), r => Assert.Null(r.ReadAt));
    }

    [Fact]
    public async Task MarkAllInboxRead_MarksOnlyTheCallersUnreadRows()
    {
        var me = Guid.NewGuid();
        var alreadyRead = Row(TenantA, me, 30, read: true);
        var readAtBefore = alreadyRead.ReadAt;
        var store = Seed(Row(TenantA, me, 1), Row(TenantA, me, 2), alreadyRead, Row(TenantA, Guid.NewGuid(), 3), Row(TenantB, me, 4));
        using (var db = Context(store, TenantA))
            Assert.IsType<NoContentResult>(await Controller(db, me).MarkAllInboxRead(null, CancellationToken.None));

        using var check = Context(store, null, superAdmin: true);
        var rows = await check.InAppNotifications.ToListAsync();
        Assert.All(rows.Where(r => r.TenantId == TenantA && r.RecipientUserId == me), r => Assert.NotNull(r.ReadAt));
        Assert.Equal(readAtBefore, rows.Single(r => r.Id == alreadyRead.Id).ReadAt);
        Assert.All(rows.Where(r => r.TenantId == TenantB || r.RecipientUserId != me), r => Assert.Null(r.ReadAt));
    }

    [Fact]
    public async Task MarkAllInboxRead_WithIds_MarksOnlyThoseRows_SoUnseenOnesStayUnread()
    {
        var me = Guid.NewGuid();
        var rows = Enumerable.Range(1, 45).Select(i => Row(TenantA, me, i)).ToArray();   // 45 unread, newest first
        var someoneElses = Row(TenantA, Guid.NewGuid(), 1);
        var store = Seed(rows.Append(someoneElses).ToArray());
        var shown = rows.Take(30).Select(r => r.Id).Append(someoneElses.Id).ToArray();   // the panel shows 30; a foreign id rides along
        using (var db = Context(store, TenantA))
            Assert.IsType<NoContentResult>(await Controller(db, me).MarkAllInboxRead(new MarkInboxReadRequest { Ids = shown }, CancellationToken.None));

        using var check = Context(store, null, superAdmin: true);
        var all = await check.InAppNotifications.ToListAsync();
        Assert.Equal(15, all.Count(r => r.RecipientUserId == me && r.ReadAt == null));
        Assert.All(rows.Take(30), r => Assert.NotNull(all.Single(x => x.Id == r.Id).ReadAt));
        Assert.Null(all.Single(x => x.Id == someoneElses.Id).ReadAt);
    }

    [Fact]
    public async Task MarkAllInboxRead_WithMoreThan100Ids_Is400_AndChangesNothing()
    {
        var me = Guid.NewGuid();
        var row = Row(TenantA, me, 1);
        var store = Seed(row);
        using (var db = Context(store, TenantA))
            Assert.IsType<BadRequestObjectResult>(await Controller(db, me).MarkAllInboxRead(
                new MarkInboxReadRequest { Ids = Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray() }, CancellationToken.None));

        using var check = Context(store, null, superAdmin: true);
        Assert.Null((await check.InAppNotifications.SingleAsync()).ReadAt);
    }

    [Fact]
    public async Task TheInbox_WithNoResolvableCaller_Is401()
    {
        using var db = Context(Seed(), TenantA);
        var controller = Controller(db, null);
        Assert.IsType<UnauthorizedObjectResult>((await controller.GetInbox(30, CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>(await controller.MarkInboxRead(Guid.NewGuid(), CancellationToken.None));
        Assert.IsType<UnauthorizedObjectResult>(await controller.MarkAllInboxRead(null, CancellationToken.None));
    }
}
