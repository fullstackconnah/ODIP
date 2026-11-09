using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>The Deleted records list: one organisation's deletions, newest first, and nothing for a caller with no organisation in scope.</summary>
public class DeletedRecordsTests
{
    private static readonly Guid A = Guid.NewGuid();
    private static readonly Guid B = Guid.NewGuid();
    private static readonly DateTimeOffset T0 = new(2026, 11, 1, 3, 0, 0, TimeSpan.Zero);

    private static OdipDbContext Db(string name, Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin); // a scoped caller by default; no tenant query filter touches AuditLogs
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static AuditLog Row(Guid? tenant, string type = "Shift", AuditAction action = AuditAction.Deleted, int minutes = 0, string changes = "[]") => new()
    {
        Id = Guid.NewGuid(), EntityType = type, EntityId = Guid.NewGuid(), Action = action, ChangedAt = T0.AddMinutes(minutes), ChangedByName = "Sam Lee", TenantId = tenant, Changes = changes,
    };

    private static async Task<JsonElement> ListAsync(string name, Guid? tenantId, string? type = null, int page = 1, int pageSize = 50, bool superAdmin = false)
    {
        await using var db = Db(name, tenantId, superAdmin);
        var result = await new AuditController(db, NullLogger<AuditController>.Instance).GetDeleted(type, page, pageSize, CancellationToken.None);
        var json = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result).Value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return JsonDocument.Parse(json).RootElement.GetProperty("data").Clone();
    }

    private static async Task<string> SeedAsync(params AuditLog[] rows)
    {
        var name = Guid.NewGuid().ToString();
        await using var db = Db(name, A);
        db.AuditLogs.AddRange(rows);
        await db.SaveChangesAsync();
        return name;
    }

    [Fact]
    public async Task An_organisation_sees_only_its_own_deletions()
    {
        var mine = Row(A);
        var name = await SeedAsync(mine, Row(B));

        var all = await ListAsync(name, A);
        Assert.Equal(1, all.GetProperty("totalCount").GetInt32());
        Assert.Equal(mine.EntityId, all.GetProperty("items")[0].GetProperty("entityId").GetGuid());

        Assert.Equal(1, (await ListAsync(name, A, "Shift")).GetProperty("totalCount").GetInt32());
        Assert.Equal(1, (await ListAsync(name, B)).GetProperty("totalCount").GetInt32());
        Assert.Equal(0, (await ListAsync(name, A, "Routine")).GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task A_row_with_no_organisation_is_hidden_from_everyone()
    {
        var mine = Row(A);
        var name = await SeedAsync(mine, Row(null));

        var list = await ListAsync(name, A);
        Assert.Equal(1, list.GetProperty("totalCount").GetInt32());
        Assert.Equal(mine.EntityId, list.GetProperty("items")[0].GetProperty("entityId").GetGuid());
    }

    // The guard that matters: comparing a row's TenantId to a null tenant would match every row from before the column existed.
    [Fact]
    public async Task A_caller_with_no_organisation_in_scope_gets_an_empty_list()
    {
        var name = await SeedAsync(Row(null), Row(A));

        var list = await ListAsync(name, tenantId: null);

        Assert.Equal(0, list.GetProperty("totalCount").GetInt32());
        Assert.Equal(0, list.GetProperty("items").GetArrayLength());
    }

    // An unscoped SuperAdmin's token still carries a home tenant; they must not read that organisation's deletions.
    [Fact]
    public async Task An_unscoped_SuperAdmin_with_a_home_tenant_gets_an_empty_list()
    {
        var name = await SeedAsync(Row(A), Row(B));

        var list = await ListAsync(name, A, superAdmin: true);

        Assert.Equal(0, list.GetProperty("totalCount").GetInt32());
        Assert.Equal(0, list.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task The_list_holds_deletions_only_newest_first_with_the_values_they_held_and_pages()
    {
        var changes = """[{"Field":"Description","Old":"Choking risk","New":null}]""";
        var (oldest, middle, newest) = (Row(A, minutes: 0), Row(A, "ParticipantRiskEntry", minutes: 5, changes: changes), Row(A, minutes: 9));
        var name = await SeedAsync(oldest, middle, newest, Row(A, action: AuditAction.Updated, minutes: 20), Row(A, action: AuditAction.Created, minutes: 30));

        var first = await ListAsync(name, A, pageSize: 2);
        Assert.Equal(3, first.GetProperty("totalCount").GetInt32());
        var items = first.GetProperty("items");
        Assert.Equal([newest.EntityId, middle.EntityId], items.EnumerateArray().Select(i => i.GetProperty("entityId").GetGuid()));
        Assert.Equal("ParticipantRiskEntry", items[1].GetProperty("entityType").GetString());
        Assert.Equal("Sam Lee", items[1].GetProperty("deletedByName").GetString());
        Assert.Equal(T0.AddMinutes(5), items[1].GetProperty("deletedAt").GetDateTimeOffset());
        var field = items[1].GetProperty("fields")[0];
        Assert.Equal(("Description", "Choking risk"), (field.GetProperty("field").GetString(), field.GetProperty("old").GetString()));

        var second = await ListAsync(name, A, page: 2, pageSize: 2);
        Assert.Equal([oldest.EntityId], second.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("entityId").GetGuid()));
    }

    private static async Task<(int Status, int Entries)> HistoryAsync(string name, Guid? tenantId, string type, Guid id, bool superAdmin = false)
    {
        await using var db = Db(name, tenantId, superAdmin);
        var result = await new AuditController(db, NullLogger<AuditController>.Instance).GetAuditHistory(type, id, ct: CancellationToken.None);
        if (result is not OkObjectResult ok) return (Assert.IsType<NotFoundObjectResult>(result).StatusCode ?? 404, 0);
        return (200, JsonDocument.Parse(JsonSerializer.Serialize(ok.Value, new JsonSerializerOptions(JsonSerializerDefaults.Web))).RootElement.GetProperty("entries").GetArrayLength());
    }

    private static AuditLog Hist(Guid id, string type, AuditAction action, int minutes, Guid? tenant = null) =>
        new() { Id = Guid.NewGuid(), EntityType = type, EntityId = id, Action = action, ChangedAt = T0.AddMinutes(minutes), TenantId = tenant ?? A, Changes = "[]" };

    private static AuditLog[] Life(Guid id, string type) =>
        [Hist(id, type, AuditAction.Created, 0), Hist(id, type, AuditAction.Updated, 5), Hist(id, type, AuditAction.Deleted, 9)];

    // A hard-deleted shift or pattern is gone from its table; its history stays readable to its own organisation while the newest row says Deleted.
    [Theory]
    [InlineData("Shift"), InlineData("ShiftPattern")]
    public async Task A_deleted_records_history_is_readable_by_an_admin_of_its_organisation(string type)
    {
        var id = Guid.NewGuid();
        var name = await SeedAsync(Life(id, type));

        Assert.Equal((200, 3), await HistoryAsync(name, A, type, id));
    }

    [Fact]
    public async Task A_deleted_records_history_is_hidden_from_another_organisation_and_an_unscoped_SuperAdmin_but_open_to_a_SuperAdmin_viewing_the_organisation()
    {
        var id = Guid.NewGuid();
        var name = await SeedAsync(Life(id, "Shift"));

        Assert.Equal(404, (await HistoryAsync(name, B, "Shift", id)).Status);
        Assert.Equal(404, (await HistoryAsync(name, A, "Shift", id, superAdmin: true)).Status);
        Assert.Equal((200, 3), await HistoryAsync(name, A, "Shift", id, superAdmin: false));
    }

    // Written again after the delete: the newest row is not Deleted, so the fallback stays shut. (InMemory, a hand-written newer Created row.)
    [Fact]
    public async Task A_record_written_again_after_its_delete_is_not_a_deleted_history()
    {
        var id = Guid.NewGuid();
        var name = await SeedAsync([.. Life(id, "Shift"), Hist(id, "Shift", AuditAction.Created, 20)]);

        Assert.Equal(404, (await HistoryAsync(name, A, "Shift", id)).Status);
    }

    [Fact]
    public async Task A_deleted_row_with_no_organisation_keeps_its_history_hidden()
    {
        var id = Guid.NewGuid();
        var rows = Life(id, "Shift");
        rows[2].TenantId = null;
        var name = await SeedAsync(rows);

        Assert.Equal(404, (await HistoryAsync(name, A, "Shift", id)).Status);
    }

    [Fact]
    public async Task A_live_shifts_history_takes_the_unchanged_path()
    {
        var id = Guid.NewGuid();
        var name = Guid.NewGuid().ToString();
        await using (var db = Db(name, A))
        {
            db.Shifts.Add(new Shift { Id = id, TenantId = A });
            db.AuditLogs.Add(Hist(id, "Shift", AuditAction.Created, 0));
            await db.SaveChangesAsync();
        }

        Assert.Equal((200, 1), await HistoryAsync(name, A, "Shift", id));
        Assert.Equal(404, (await HistoryAsync(name, B, "Shift", id)).Status);
    }
}
