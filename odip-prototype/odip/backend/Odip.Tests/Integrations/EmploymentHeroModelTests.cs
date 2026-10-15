using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Integrations;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Tests.Imports;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>The three Employment Hero tables: tenant-filtered, and never in AuditLog (the connection holds the encrypted key).</summary>
public class EmploymentHeroModelTests
{
    private static EmploymentHeroConnection Connection(Guid tenantId) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = "777", BusinessName = "Acme Care", ApiKeyCiphertext = [1, 2, 3], ApiKeyNonce = new byte[12],
        ConnectedAt = DateTime.UtcNow, ConnectedByName = "Ada Admin",
    };

    [Fact]
    public async Task The_connection_items_and_log_are_never_audited()
    {
        Assert.DoesNotContain(typeof(EmploymentHeroConnection), AuditedEntities.Types);
        Assert.DoesNotContain(typeof(EmploymentHeroAttention), AuditedEntities.Types);
        Assert.DoesNotContain(typeof(EmploymentHeroSyncLog), AuditedEntities.Types);
        var tenantId = Guid.NewGuid();
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(new HttpContextAccessor())).Options;
        await using var db = new OdipDbContext(options, ImportTestSupport.Tenant(tenantId));

        db.EmploymentHeroConnections.Add(Connection(tenantId));
        await db.SaveChangesAsync();

        Assert.Empty(db.AuditLogs);
    }

    [Fact]
    public async Task Each_organisation_sees_only_its_own_connection_items_and_log()
    {
        var name = Guid.NewGuid().ToString();
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        await using (var setup = TestDb.Create(name))
        {
            foreach (var t in new[] { a, b })
            {
                setup.EmploymentHeroConnections.Add(Connection(t));
                setup.EmploymentHeroAttentions.Add(new EmploymentHeroAttention { Id = Guid.NewGuid(), TenantId = t, Key = "NotLinked:x", Name = "Sam Lee", Reason = "r" });
                setup.EmploymentHeroSyncLogs.Add(new EmploymentHeroSyncLog { Id = Guid.NewGuid(), TenantId = t, BusinessId = "777" });
            }
            await setup.SaveChangesAsync();
        }

        await using var db = TestDb.ForTenant(name, a);
        Assert.Equal(a, (await db.EmploymentHeroConnections.SingleAsync()).TenantId);
        Assert.Equal(a, (await db.EmploymentHeroAttentions.SingleAsync()).TenantId);
        Assert.Equal(a, (await db.EmploymentHeroSyncLogs.SingleAsync()).TenantId);
    }
}
