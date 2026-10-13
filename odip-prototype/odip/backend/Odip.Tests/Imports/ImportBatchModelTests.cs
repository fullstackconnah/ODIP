using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Audit;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportBatchModelTests
{
    [Fact]
    public void Batches_are_tenant_filtered_audited_and_keyed_once_per_organisation()
    {
        using var db = TestDb.Create();
        var batch = db.Model.FindEntityType(typeof(ImportBatch))!;
        Assert.NotNull(batch.GetQueryFilter());
        var key = Assert.Single(batch.GetIndexes(), i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { "TenantId", "IdempotencyKey" }));
        Assert.True(key.IsUnique);
        Assert.Contains(typeof(ImportBatch), AuditedEntities.Types);
        Assert.Contains(typeof(ImportBatchItem), AuditedEntities.Types);
    }

    [Fact]
    public async Task An_organisation_sees_only_its_own_batches()
    {
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        var name = Guid.NewGuid().ToString();
        using (var admin = TestDb.Create(name))
        {
            admin.ImportBatches.AddRange(
                new ImportBatch { Id = Guid.NewGuid(), TenantId = a, FileName = "a.csv", FileSha256 = "x", IdempotencyKey = "k1", CreatedByName = "A" },
                new ImportBatch { Id = Guid.NewGuid(), TenantId = b, FileName = "b.csv", FileSha256 = "y", IdempotencyKey = "k1", CreatedByName = "B" });
            await admin.SaveChangesAsync();
        }
        using var db = TestDb.ForTenant(name, a);
        Assert.Equal("a.csv", (await db.ImportBatches.SingleAsync()).FileName);
    }
}
