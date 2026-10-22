using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
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

    /// <summary>
    /// Fix round 1 (deep review S1): the badge's unread count reads only unread rows, through a partial index, instead of the
    /// recipient's whole 90-day history. The plan is checked with EXPLAIN on the count the endpoint runs (tenant filter included).
    /// </summary>
    [SkippableFact]
    public async Task TheUnreadCount_UsesThePartialUnreadIndex()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        var me = Guid.NewGuid();
        await using (db)
        {
            var now = DateTime.UtcNow;
            for (var i = 0; i < 400; i++)
            {
                var row = Row(tenantId, me, now.AddMinutes(-i));
                if (i >= 3) row.ReadAt = now; // a long read history, three unread
                db.InAppNotifications.Add(row);
            }
            await db.SaveChangesAsync();
        }

        await using var conn = new NpgsqlConnection(_pg.ConnectionString);
        await conn.OpenAsync();
        await using (var analyze = new NpgsqlCommand("ANALYZE \"InAppNotifications\"", conn)) await analyze.ExecuteNonQueryAsync();
        // The test table is tiny, so the planner would rightly scan it whole; with sequential scans off it must choose between
        // the indexes, and the partial one (three unread rows) has to be the cheapest way to the count.
        await using (var noSeq = new NpgsqlCommand("SET enable_seqscan = off", conn)) await noSeq.ExecuteNonQueryAsync();

        await using var def = new NpgsqlCommand(
            "SELECT indexdef FROM pg_indexes WHERE tablename = 'InAppNotifications' AND indexname = 'IX_InAppNotifications_Unread'", conn);
        Assert.Contains(@"WHERE (""ReadAt"" IS NULL)", (string?)await def.ExecuteScalarAsync() ?? "");

        await using var explain = new NpgsqlCommand(
            "EXPLAIN SELECT count(*)::int FROM \"InAppNotifications\" AS i " +
            "WHERE i.\"TenantId\" = @tenant AND i.\"RecipientUserId\" = @me AND i.\"ReadAt\" IS NULL", conn);
        explain.Parameters.AddWithValue("tenant", tenantId);
        explain.Parameters.AddWithValue("me", me);
        var plan = new List<string>();
        await using (var reader = await explain.ExecuteReaderAsync())
            while (await reader.ReadAsync()) plan.Add(reader.GetString(0));
        Assert.Contains(plan, line => line.Contains("IX_InAppNotifications_Unread"));
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

            Assert.IsType<NoContentResult>(await controller.MarkAllInboxRead(null, CancellationToken.None));
            Assert.Equal(0, Inbox(await controller.GetInbox(30, CancellationToken.None)).UnreadCount);
        }
    }

    private static NotificationDispatchBackgroundService Dispatcher(string connectionString, bool enabled)
    {
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseNpgsql(connectionString));
        var email = new Mock<INotificationChannel>();
        email.Setup(c => c.Kind).Returns(NotificationChannelKind.Email);
        services.AddSingleton<INotificationChannel>(email.Object);
        services.AddSingleton<INotificationChannel>(new SmsChannel());
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Notifications:Enabled"] = enabled ? "true" : "false",
            ["Notifications:DispatchIntervalSeconds"] = "3600",
        }).Build();
        return new NotificationDispatchBackgroundService(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(), config,
            NullLogger<NotificationDispatchBackgroundService>.Instance);
    }

    [SkippableFact]
    public async Task ThePurge_DeletesRowsOlderThan90Days_InEveryOrganisation_AndKeepsTheRest()
    {
        RequirePostgres();
        var now = DateTime.UtcNow;
        var (setupA, a) = await _pg.NewTenantContextAsync();
        var (setupB, b) = await _pg.NewTenantContextAsync();
        await setupA.DisposeAsync();
        await setupB.DisposeAsync();
        var expiredA = Row(a, Guid.NewGuid(), now.AddDays(-91));
        var keptA = Row(a, Guid.NewGuid(), now.AddDays(-89));
        var expiredB = Row(b, Guid.NewGuid(), now.AddDays(-91));
        var keptB = Row(b, Guid.NewGuid(), now.AddDays(-89));
        await using (var admin = PostgresFixture.NewContext(_pg.ConnectionString))
        {
            admin.InAppNotifications.AddRange(expiredA, keptA, expiredB, keptB);
            await admin.SaveChangesAsync();
        }

        var deleted = await Dispatcher(_pg.ConnectionString, enabled: false).PurgeExpiredInAppNotificationsAsync(now, CancellationToken.None);

        Assert.True(deleted >= 2);
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
        var left = await check.InAppNotifications.Where(n => n.TenantId == a || n.TenantId == b).Select(n => n.Id).ToListAsync();
        Assert.Equal(new[] { keptA.Id, keptB.Id }.OrderBy(x => x), left.OrderBy(x => x));
    }

    private static NotificationOutbox Outbox(Guid tenantId, DateTime createdAt, NotificationOutboxStatus status) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, RecipientUserId = Guid.NewGuid(), EventType = NotificationEventType.ShiftAssigned,
        EntityType = "Shift", EntityId = Guid.NewGuid(), PayloadJson = "{}", Status = status, NextAttemptAt = createdAt, CreatedAt = createdAt,
    };

    /// <summary>Outbox rows older than 90 days go whatever their status (live never sends, so Pending rows pile up); the delivery log is not touched.</summary>
    [SkippableFact]
    public async Task ThePurge_AlsoDeletesOutboxRowsOlderThan90Days_AnyStatus_AndKeepsTheRest_AndTheLoggedOnes_AndTheBellPurgeIsUnchanged()
    {
        RequirePostgres();
        var now = DateTime.UtcNow;
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await setup.DisposeAsync();
        var oldPending = Outbox(tenantId, now.AddDays(-91), NotificationOutboxStatus.Pending);
        var oldFailed = Outbox(tenantId, now.AddDays(-91), NotificationOutboxStatus.Failed);
        var oldSent = Outbox(tenantId, now.AddDays(-91), NotificationOutboxStatus.Sent);   // has a delivery-log row: stays with it
        var recent = Outbox(tenantId, now.AddDays(-89), NotificationOutboxStatus.Pending);
        var oldBell = Row(tenantId, Guid.NewGuid(), now.AddDays(-91));
        var keptBell = Row(tenantId, Guid.NewGuid(), now.AddDays(-89));
        await using (var admin = PostgresFixture.NewContext(_pg.ConnectionString))
        {
            admin.NotificationOutbox.AddRange(oldPending, oldFailed, oldSent, recent);
            admin.NotificationLogs.Add(new NotificationLog { Id = Guid.NewGuid(), TenantId = tenantId, OutboxId = oldSent.Id, Channel = NotificationChannelKind.Email, RecipientAddress = "a@example.com" });
            admin.InAppNotifications.AddRange(oldBell, keptBell);
            await admin.SaveChangesAsync();
        }

        var service = Dispatcher(_pg.ConnectionString, enabled: false);
        Assert.True(await service.PurgeExpiredOutboxAsync(now, CancellationToken.None) >= 2);   // pending + failed
        Assert.True(await service.PurgeExpiredInAppNotificationsAsync(now, CancellationToken.None) >= 1);

        await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
        var ids = new[] { oldPending.Id, oldFailed.Id, oldSent.Id, recent.Id };
        Assert.Equal(new[] { oldSent.Id, recent.Id }.OrderBy(x => x), (await check.NotificationOutbox.Where(o => ids.Contains(o.Id)).Select(o => o.Id).ToListAsync()).OrderBy(x => x));
        Assert.Equal(new[] { keptBell.Id }, await check.InAppNotifications.Where(n => n.Id == oldBell.Id || n.Id == keptBell.Id).Select(n => n.Id).ToListAsync());
    }

    [SkippableFact]
    public async Task TheOutboxDedupeIndex_LeadsWithEntityRecipientCreatedAt()
    {
        RequirePostgres();
        await using var conn = new NpgsqlConnection(_pg.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'NotificationOutbox' " +
            "AND indexdef LIKE '%(\"EntityId\", \"RecipientUserId\", \"CreatedAt\")%'", conn);
        Assert.NotNull(await cmd.ExecuteScalarAsync());
    }

    /// <summary>Review Focus 3: live has Notifications:Enabled=false and usually an empty outbox; the purge must still run.</summary>
    [SkippableFact]
    public async Task ThePurge_RunsFromTheServiceLoop_WithNotificationsDisabledAndAnEmptyOutbox()
    {
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await setup.DisposeAsync();
        var expired = Row(tenantId, Guid.NewGuid(), DateTime.UtcNow.AddDays(-91));
        await using (var admin = PostgresFixture.NewContext(_pg.ConnectionString))
        {
            admin.InAppNotifications.Add(expired);
            await admin.SaveChangesAsync();
        }

        var service = Dispatcher(_pg.ConnectionString, enabled: false);
        await service.StartAsync(CancellationToken.None);
        try
        {
            var gone = false;
            for (var i = 0; i < 150 && !gone; i++) // up to 15 s: the first loop pass purges before its first delay
            {
                await Task.Delay(100);
                await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
                gone = !await check.InAppNotifications.AnyAsync(n => n.Id == expired.Id);
            }
            Assert.True(gone, "the loop did not purge an expired bell row while Notifications:Enabled was false");
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }
    }
}
