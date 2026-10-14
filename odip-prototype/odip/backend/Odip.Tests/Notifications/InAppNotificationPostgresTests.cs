using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// The bell's table on a real PostgreSQL (EF InMemory has no indexes, no length limits and no ExecuteDelete). Each test works on
/// its own rows: the fixture's one database is shared by the class.
/// </summary>
public class InAppNotificationPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public InAppNotificationPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static InAppNotification Row(Guid tenantId, Guid recipientId, DateTime createdAt, string title = "Item") => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, RecipientUserId = recipientId, EventType = NotificationEventType.ShiftAssigned,
        EntityType = "Shift", EntityId = Guid.NewGuid(), Title = title, LinkTo = "/portal", CreatedAt = createdAt,
    };

    [SkippableFact]
    public async Task TheMigration_MakesTheTable_AndTheBellIndexIsRecipientThenCreatedAtDescending()
    {
        RequirePostgres();
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        Assert.Contains(await db.Database.GetAppliedMigrationsAsync(), m => m.EndsWith("_AddInAppNotifications"));
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());

        await using var conn = new NpgsqlConnection(_pg.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'InAppNotifications' " +
            "AND indexname = 'IX_InAppNotifications_RecipientUserId_CreatedAt'", conn);
        var def = (string?)await cmd.ExecuteScalarAsync();
        Assert.NotNull(def);
        Assert.Contains(@"(""RecipientUserId"", ""CreatedAt"" DESC)", def);
    }

    [SkippableFact]
    public async Task ALongTitle_Saves_SoANameCanNeverFailTheWriteItRidesOn()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using (db)
        {
            db.InAppNotifications.Add(Row(tenantId, Guid.NewGuid(), DateTime.UtcNow, new string('x', 5000)));
            await db.SaveChangesAsync();
        }

        await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
        Assert.Equal(5000, (await check.InAppNotifications.SingleAsync(n => n.TenantId == tenantId)).Title.Length);
    }

    private static NotificationsController Caller(OdipDbContext db, Guid userId) => new(db)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "Test")),
            },
        },
    };

    private static InboxDto Inbox(ActionResult<ApiResponse<InboxDto>> result) =>
        ((ApiResponse<InboxDto>)((OkObjectResult)result.Result!).Value!).Data!;

    [SkippableFact]
    public async Task TheInbox_TranslatesToSql_OwnRowsNewestFirst_ThenReadAllEmptiesTheCount()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using (db)
        {
            var me = Guid.NewGuid();
            var now = DateTime.UtcNow;
            var oldest = Row(tenantId, me, now.AddMinutes(-30));
            var newest = Row(tenantId, me, now.AddMinutes(-1));
            var middle = Row(tenantId, me, now.AddMinutes(-10));
            db.InAppNotifications.AddRange(oldest, newest, middle, Row(tenantId, Guid.NewGuid(), now));
            await db.SaveChangesAsync();
            var controller = Caller(db, me);

            var inbox = Inbox(await controller.GetInbox(30, CancellationToken.None));
            Assert.Equal(new[] { newest.Id, middle.Id, oldest.Id }, inbox.Items.Select(i => i.Id));
            Assert.Equal(3, inbox.UnreadCount);

            Assert.IsType<NoContentResult>(await controller.MarkAllInboxRead(CancellationToken.None));
            Assert.Equal(0, Inbox(await controller.GetInbox(30, CancellationToken.None)).UnreadCount);
        }
    }
}
