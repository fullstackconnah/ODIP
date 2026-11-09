using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>The Deleted records list: one organisation's deletions, newest first, and nothing for a caller with no organisation in scope.</summary>
public class DeletedRecordsTests
{
    private static readonly Guid A = Guid.NewGuid();
    private static readonly Guid B = Guid.NewGuid();
    private static readonly DateTimeOffset T0 = new(2026, 11, 1, 3, 0, 0, TimeSpan.Zero);

    private static OdipDbContext Db(string name, Guid? tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true); // sees every row, so the controller's own tenant filter is what is under test
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static AuditLog Row(Guid? tenant, string type = "Shift", AuditAction action = AuditAction.Deleted, int minutes = 0, string changes = "[]") => new()
    {
        Id = Guid.NewGuid(), EntityType = type, EntityId = Guid.NewGuid(), Action = action, ChangedAt = T0.AddMinutes(minutes), ChangedByName = "Sam Lee", TenantId = tenant, Changes = changes,
    };

    private static async Task<JsonElement> ListAsync(string name, Guid? tenantId, string? type = null, int page = 1, int pageSize = 50)
    {
        await using var db = Db(name, tenantId);
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
}
