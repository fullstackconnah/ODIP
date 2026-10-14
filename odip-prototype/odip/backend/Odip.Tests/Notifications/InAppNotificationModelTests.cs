using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Audit;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>The bell's table (dashboard spec 2026-10-14): own rows newest first, scoped to the organisation, and not audited.</summary>
public class InAppNotificationModelTests
{
    private static InAppNotification Row(Guid tenantId) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, RecipientUserId = Guid.NewGuid(), EventType = NotificationEventType.ShiftAssigned,
        EntityType = "Shift", EntityId = Guid.NewGuid(), Title = "You're rostered.", LinkTo = "/portal",
    };

    [Fact]
    public void TheBellIndex_IsRecipientThenNewestFirst_TheTitleIsUnbounded_AndTheTableIsFiltered()
    {
        using var db = TestDb.Create();
        // IsDescending is design-time only: the runtime model drops it.
        var entity = db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(InAppNotification))!;

        var index = Assert.Single(entity.GetIndexes(),
            i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { "RecipientUserId", "CreatedAt" }));
        Assert.Equal(new[] { false, true }, index.IsDescending);
        Assert.Null(entity.FindProperty(nameof(InAppNotification.Title))!.GetMaxLength());
        Assert.Null(entity.FindProperty(nameof(InAppNotification.LinkTo))!.GetMaxLength());
        Assert.NotNull(entity.GetQueryFilter());
    }

    /// <summary>Fix round 1 (deep review S1): the badge count has a partial index over unread rows only.</summary>
    [Fact]
    public void TheUnreadCount_HasAPartialIndexOverUnreadRows()
    {
        using var db = TestDb.Create();
        var entity = db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(InAppNotification))!;

        var index = Assert.Single(entity.GetIndexes(), i => i.GetDatabaseName() == "IX_InAppNotifications_Unread");
        Assert.Equal(new[] { "RecipientUserId" }, index.Properties.Select(p => p.Name));
        Assert.Equal("\"ReadAt\" IS NULL", index.GetFilter());
    }

    [Fact]
    public async Task ATenantScopedContext_SeesOnlyItsOwnOrganisationsRows()
    {
        var name = Guid.NewGuid().ToString();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        using (var admin = TestDb.Create(name))
        {
            admin.InAppNotifications.AddRange(Row(a), Row(b));
            await admin.SaveChangesAsync();
        }

        using var scoped = TestDb.ForTenant(name, a);
        Assert.Equal(a, (await scoped.InAppNotifications.SingleAsync()).TenantId);
    }

    [Fact]
    public void TheBell_IsNotAudited() => Assert.DoesNotContain(typeof(InAppNotification), AuditedEntities.Types);
}
