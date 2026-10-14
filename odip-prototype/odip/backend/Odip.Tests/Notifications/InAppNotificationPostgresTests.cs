using Microsoft.EntityFrameworkCore;
using Npgsql;
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
}
