using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Compliance;

/// <summary>A compliance date is hard-deleted, so the audit interceptor must record who removed it (and who added it).</summary>
public class ComplianceItemAuditTests
{
    [Fact]
    public async Task Adding_and_deleting_a_date_each_write_an_audit_row_naming_the_actor()
    {
        var actor = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, actor.ToString()), new Claim("fullName", "Jane Admin")], "Test");
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(accessor.Object)).Options;
        await using var db = new OdipDbContext(options, tenant.Object);
        var item = new ComplianceItem { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), Kind = ComplianceKind.Registration, Label = "NDIS registration", ExpiresOn = new DateOnly(2027, 2, 4) };

        db.ComplianceItems.Add(item);
        await db.SaveChangesAsync();
        db.ComplianceItems.Remove(item);
        await db.SaveChangesAsync();

        var rows = await db.AuditLogs.Where(a => a.EntityId == item.Id).OrderBy(a => a.ChangedAt).ToListAsync();
        Assert.Equal([AuditAction.Created, AuditAction.Deleted], rows.Select(r => r.Action));
        Assert.All(rows, r => Assert.Equal(actor, r.ChangedById));
    }
}
