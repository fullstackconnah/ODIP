using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>The stored changes are Field/Old/New; the History tab reads field/old/new, so the response must re-case them.</summary>
public class AuditHistoryResponseTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static async Task<JsonElement> HistoryChangesAsync(string stored)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantId);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var p = new Participant { Id = Guid.NewGuid(), TenantId = TenantId };
        db.Add(p);
        db.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "Participant", EntityId = p.Id, Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow, Changes = stored });
        db.SaveChanges();

        var result = await new AuditController(db, NullLogger<AuditController>.Instance).GetAuditHistory("Participant", p.Id, ct: CancellationToken.None);

        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        var json = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result).Value, options);
        return JsonDocument.Parse(json).RootElement.GetProperty("entries")[0].GetProperty("changes").Clone();
    }

    [Fact]
    public async Task GetAuditHistory_returns_changes_as_field_old_new()
    {
        var change = (await HistoryChangesAsync("""[{"Field":"LastName","Old":"A","New":"B"}]"""))[0];

        Assert.Equal("LastName", change.GetProperty("field").GetString());
        Assert.Equal("A", change.GetProperty("old").GetString());
        Assert.Equal("B", change.GetProperty("new").GetString());
        Assert.False(change.TryGetProperty("Field", out _));
    }

    [Fact]
    public async Task GetAuditHistory_keeps_null_and_non_string_values_readable()
    {
        var change = (await HistoryChangesAsync("""[{"Field":"Age","Old":null,"New":42}]""")).EnumerateArray().Single();

        // The API leaves nulls out of the JSON; the tab shows a missing value as a dash.
        Assert.False(change.TryGetProperty("old", out _));
        Assert.Equal(42, change.GetProperty("new").GetInt32());
    }

    [Fact]
    public async Task GetAuditHistory_gives_an_empty_list_for_malformed_changes()
    {
        Assert.Equal(0, (await HistoryChangesAsync("not json")).GetArrayLength());
    }

    // H44-5: rows that share a ChangedAt page in a fixed order (newest Id first), so no row repeats or goes missing between pages.
    [Fact]
    public async Task GetAuditHistory_TiedChangedAt_PagesInStableIdOrder()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantId);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var p = new Participant { Id = Guid.NewGuid(), TenantId = TenantId };
        db.Add(p);
        var at = DateTimeOffset.UtcNow;
        // Inserted in ascending Id order, so an unordered tie would come back ascending.
        var ids = Enumerable.Range(1, 3).Select(n => new Guid(n, 0, 0, new byte[8])).ToList();
        foreach (var id in ids) db.Add(new AuditLog { Id = id, EntityType = "Participant", EntityId = p.Id, Action = AuditAction.Updated, ChangedAt = at });
        db.SaveChanges();
        var controller = new AuditController(db, NullLogger<AuditController>.Instance);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);

        var seen = new List<Guid>();
        foreach (var page in new[] { 1, 2 })
        {
            var json = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(await controller.GetAuditHistory("Participant", p.Id, page: page, pageSize: 2, ct: CancellationToken.None)).Value, options);
            seen.AddRange(JsonDocument.Parse(json).RootElement.GetProperty("entries").EnumerateArray().Select(e => e.GetProperty("id").GetGuid()));
        }

        Assert.Equal(ids.OrderByDescending(i => i).ToList(), seen);
    }
}
